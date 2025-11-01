import { getRedis } from '../redis/client.js';
import { config } from '../config/index.js';
import logger from '../logger/index.js';
import { clip } from '../utils/text.js';
import { embedTexts } from '../openai/client.js';

// 简单内存向量检索实现：
// - 使用 Redis Hash 保存文档：mem:doc:<id>
// - 使用 ZSET 保存最近文档索引：
//   - 规划：mem:index:plan
//   - 工具：mem:index:tool:<aiName>
// - 不强依赖 RediSearch；先取最近 N 条，在应用层做余弦相似度排序，便于快速落地

const NS = config.memory.namespace;
const PREFIX = config.memory.prefix || 'sentra:mcp:mem';
const K_DOC = (id) => `${PREFIX}:doc:${id}`;
const K_IDX_PLAN = () => `${PREFIX}:index:plan`;
const K_IDX_TOOL = (aiName) => `${PREFIX}:index:tool:${aiName}`;
const RS_INDEX = String(config.memory.rsIndex || 'mem_idx');
const RS_DIM = Number(config.memory.rsDim || 0);
const RS_ENABLED = !!config.memory.enableRediSearch;

// Cache RediSearch capability to avoid repeated FT.* attempts and warnings
let __RS_CAP = 'unknown'; // 'available' | 'missing' | 'error'
let __RS_WARNED = false;
function __rsWarnOnce(msg, meta = {}) {
  if (!__RS_WARNED) {
    logger.warn?.(msg, { label: 'MEM', ...meta });
    __RS_WARNED = true;
  } else {
    logger.debug?.(msg, { label: 'MEM', ...meta });
  }
}

function now() { return Date.now(); }

function cosineSim(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i]; const y = b[i]; dot += x * y; na += x * x; nb += y * y; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function genId(prefix) { return `${prefix}:${now()}:${Math.random().toString(36).slice(2, 10)}`; }

function sanitizeText(str, max = 1200) {
  const s = String(str || '');
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...[截断 ${s.length - max} 字符]`;
}

async function embedQuery(text) {
  const [vec] = await embedTexts({
    texts: [text],
    apiKey: config.embedding.apiKey,
    baseURL: config.embedding.baseURL,
    model: config.embedding.model,
  });
  return vec;
}

function toFloat32Buffer(vec = []) {
  try {
    const f = new Float32Array(vec);
    return Buffer.from(f.buffer);
  } catch {
    return null;
  }
}

async function ensureRSIndex(dim) {
  if (!RS_ENABLED) return false;
  if (__RS_CAP === 'missing') return false;
  try {
    const r = getRedis();
    // Check index exists
    try {
      await r.call('FT.INFO', RS_INDEX);
      __RS_CAP = 'available';
      return true;
    } catch {}
    const d = Number.isFinite(RS_DIM) && RS_DIM > 0 ? RS_DIM : Number(dim) || 0;
    if (!d) {
      logger.warn?.('RediSearch 索引创建失败：未知向量维度', { label: 'MEM', index: RS_INDEX });
      return false;
    }
    const metric = String(config.memory.rsDistance || 'COSINE');
    const m = Number(config.memory.rsM || 16);
    const efc = Number(config.memory.rsEfConstruction || 200);
    // FT.CREATE mem_idx ON HASH PREFIX 1 <PREFIX>:doc: SCHEMA ns TAG type TAG aiName TAG stepIndex NUMERIC success TAG embedding_bin VECTOR HNSW 6 TYPE FLOAT32 DIM d DISTANCE_METRIC COSINE M m EF_CONSTRUCTION efc
    const prefix = `${PREFIX}:doc:`;
    await r.call(
      'FT.CREATE', RS_INDEX,
      'ON', 'HASH',
      'PREFIX', '1', prefix,
      'SCHEMA',
        'ns', 'TAG',
        'type', 'TAG',
        'aiName', 'TAG',
        'stepIndex', 'NUMERIC',
        'success', 'TAG',
        'embedding_bin', 'VECTOR', 'HNSW', '6',
          'TYPE', 'FLOAT32', 'DIM', String(d), 'DISTANCE_METRIC', metric, 'M', String(m), 'EF_CONSTRUCTION', String(efc)
    );
    logger.info('RediSearch 索引已创建', { label: 'MEM', index: RS_INDEX, dim: d, metric });
    __RS_CAP = 'available';
    return true;
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('unknown command') && msg.includes('FT.')) {
      __RS_CAP = 'missing';
      __rsWarnOnce('RediSearch 不可用（回退应用层相似度）', { index: RS_INDEX, error: msg });
    } else {
      __RS_CAP = 'error';
      logger.warn?.('RediSearch 索引创建/检查失败（回退应用层相似度）', { label: 'MEM', index: RS_INDEX, error: msg });
    }
    return false;
  }
}

// 写入：规划记忆
export async function upsertPlanMemory({ runId, objective, plan }) {
  if (!config.memory.enable) return;
  try {
    const r = getRedis();
    const id = genId('plan');
    const text = sanitizeText([
      `目标: ${objective}`,
      `计划步骤(概览): ${clip(Array.isArray(plan?.steps) ? plan.steps.map(s => s.aiName).join(' -> ') : '')}`,
    ].join('\n'));
    const emb = await embedQuery(`${objective}`);
    await r.hset(K_DOC(id), {
      ns: NS,
      type: 'plan',
      runId,
      objective: String(objective || ''),
      aiName: '',
      text,
      embedding: JSON.stringify(emb),
      ts: String(now()),
      success: '1',
    });
    if (RS_ENABLED) {
      const buf = toFloat32Buffer(emb);
      if (buf) {
        try {
          await ensureRSIndex(emb.length);
          await r.hset(K_DOC(id), { embedding_bin: buf });
        } catch (e) {
          logger.warn?.('写入 RediSearch 向量失败（忽略）', { label: 'MEM', e: String(e) });
        }
      }
    }
    await r.zadd(K_IDX_PLAN(), now(), id);
    logger.debug?.('Memory upsert plan', { label: 'MEM', id });
  } catch (e) {
    logger.warn?.('Memory upsert plan failed', { label: 'MEM', e: String(e) });
  }
}

// 写入：工具记忆
export async function upsertToolMemory({ runId, stepIndex, aiName, objective, reason, args, result, success }) {
  if (!config.memory.enable) return;
  try {
    const r = getRedis();
    const id = genId('tool');
    const argsPreview = clip(args || {});
    const resultPreview = clip(result && (result.data ?? result));
    const text = sanitizeText([
      `目标: ${objective}`,
      `工具: ${aiName}`,
      reason ? `原因: ${clip(reason)}` : undefined,
      `参数要点: ${argsPreview}`,
      `结果摘要: ${resultPreview}`,
    ].filter(Boolean).join('\n'));
    // 仅使用“提示词（reason优先，其次objective）”作为向量键，避免被参数/结果污染
    const emb = await embedQuery(String(reason || objective || ''));
    await r.hset(K_DOC(id), {
      ns: NS,
      type: 'tool',
      runId,
      stepIndex: String(stepIndex ?? -1),
      aiName: String(aiName || ''),
      objective: String(objective || ''),
      reason: String(reason || ''),
      text,
      args: JSON.stringify(args ?? {}),
      embedding: JSON.stringify(emb),
      ts: String(now()),
      success: success ? '1' : '0',
    });
    if (RS_ENABLED) {
      const buf = toFloat32Buffer(emb);
      if (buf) {
        try {
          await ensureRSIndex(emb.length);
          await r.hset(K_DOC(id), { embedding_bin: buf });
        } catch (e) {
          logger.warn?.('写入 RediSearch 向量失败（忽略）', { label: 'MEM', e: String(e) });
        }
      }
    }
    await r.zadd(K_IDX_TOOL(aiName), now(), id);
    logger.debug?.('Memory upsert tool', { label: 'MEM', id, aiName, success });
  } catch (e) {
    logger.warn?.('Memory upsert tool failed', { label: 'MEM', e: String(e) });
  }
}

async function fetchDocs(r, ids = []) {
  if (!ids.length) return [];
  const pipeline = r.pipeline();
  for (const id of ids) pipeline.hgetall(K_DOC(id));
  const res = await pipeline.exec();
  return res.map(([, v]) => v || {}).filter(Boolean);
}

// 读取：相似规划记忆
export async function searchPlanMemories({ objective, topK = config.memory.topK, minScore = config.memory.minScore }) {
  if (!config.memory.enable) return [];
  try {
    const r = getRedis();
    const qvec = await embedQuery(objective);
    if (RS_ENABLED && __RS_CAP !== 'missing') {
      try {
        const ok = await ensureRSIndex(qvec.length);
        if (ok && __RS_CAP === 'available') {
          const buf = toFloat32Buffer(qvec);
          if (buf) {
            // FT.SEARCH mem_idx "@ns:{<NS>} @type:{plan}=>[KNN k embedding_bin $B AS score]" PARAMS 2 B <blob> SORTBY score DIALECT 2
            const k = Math.max(1, Number(topK || 3));
            const query = `@ns:{${NS}} @type:{plan}=>[KNN ${k} embedding_bin $VEC AS score]`;
            const resp = await r.call('FT.SEARCH', RS_INDEX, query, 'PARAMS', '2', 'VEC', buf, 'SORTBY', 'score', 'DIALECT', '2', 'RETURN', '2', 'runId', 'text');
            // Parse: [total, key, [field, value, ...], key2, [...], ...]
            const out = [];
            for (let i = 2; i < resp.length; i += 2) {
              const fields = resp[i + 1];
              const obj = {};
              for (let j = 0; j < fields.length; j += 2) obj[fields[j]] = fields[j + 1];
              out.push({ score: 0, runId: obj.runId, text: obj.text });
            }
            return out.slice(0, k);
          }
        }
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (msg.includes('unknown command') && msg.includes('FT.')) {
          __RS_CAP = 'missing';
          __rsWarnOnce('RediSearch 不可用（回退应用层）', { error: msg });
        } else {
          logger.warn?.('RediSearch 规划检索失败（回退应用层）', { label: 'MEM', error: msg });
        }
      }
    }
    const poolN = Math.max(10, Number(config.memory.candidatePool || 200));
    const ids = await r.zrevrange(K_IDX_PLAN(), 0, poolN - 1);
    const docs = await fetchDocs(r, ids);
    const scored = [];
    for (const d of docs) {
      if (d?.type !== 'plan') continue;
      const vec = JSON.parse(d.embedding || '[]');
      const score = cosineSim(qvec, vec);
      if (score >= (minScore ?? 0)) scored.push({ score, d });
    }
    scored.sort((a, b) => b.score - a.score);
    const sel = scored.slice(0, Math.max(1, Number(topK || 3)));
    return sel.map(({ score, d }) => ({
      score,
      runId: d.runId,
      text: d.text,
    }));
  } catch (e) {
    logger.warn?.('Memory search plan failed', { label: 'MEM', e: String(e) });
    return [];
  }
}

// 读取：相似工具记忆
export async function searchToolMemories({ objective, reason, aiName, topK = config.memory.toolTopK, minScore = config.memory.minScore }) {
  if (!config.memory.enable) return [];
  try {
    if (!aiName) return [];
    const r = getRedis();
    // 使用与写入端一致的向量键：reason 优先，其次 objective
    const qvec = await embedQuery(String(reason || objective || ''));
    if (RS_ENABLED && __RS_CAP !== 'missing') {
      try {
        const ok = await ensureRSIndex(qvec.length);
        if (ok && __RS_CAP === 'available') {
          const buf = toFloat32Buffer(qvec);
          if (buf) {
            const k = Math.max(1, Number(topK || 3));
            // 仅成功案例时：添加 success 过滤
            const successFilter = config.memory.onlySuccessful ? ' @success:{1}' : '';
            const query = `@ns:{${NS}} @type:{tool} @aiName:{${aiName}}${successFilter}=>[KNN ${k} embedding_bin $VEC AS score]`;
            const resp = await r.call('FT.SEARCH', RS_INDEX, query, 'PARAMS', '2', 'VEC', buf, 'SORTBY', 'score', 'DIALECT', '2', 'RETURN', '4', 'runId', 'text', 'args', 'stepIndex');
            const out = [];
            for (let i = 2; i < resp.length; i += 2) {
              const fields = resp[i + 1];
              const obj = {};
              for (let j = 0; j < fields.length; j += 2) obj[fields[j]] = fields[j + 1];
              out.push({ score: 0, runId: obj.runId, stepIndex: Number(obj.stepIndex || -1), success: true, text: obj.text, args: (() => { try { return JSON.parse(obj.args || '{}'); } catch { return undefined; } })() });
            }
            return out.slice(0, k);
          }
        }
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (msg.includes('unknown command') && msg.includes('FT.')) {
          __RS_CAP = 'missing';
          __rsWarnOnce('RediSearch 不可用（回退应用层）', { error: msg });
        } else {
          logger.warn?.('RediSearch 工具检索失败（回退应用层）', { label: 'MEM', error: msg });
        }
      }
    }
    const poolN = Math.max(10, Number(config.memory.candidatePool || 200));
    const ids = await r.zrevrange(K_IDX_TOOL(aiName), 0, poolN - 1);
    const docs = await fetchDocs(r, ids);
    const scored = [];
    for (const d of docs) {
      if (d?.type !== 'tool' || d?.aiName !== aiName) continue;
      if (config.memory.onlySuccessful && d?.success !== '1') continue;
      const vec = JSON.parse(d.embedding || '[]');
      const score = cosineSim(qvec, vec);
      if (score >= (minScore ?? 0)) scored.push({ score, d });
    }
    scored.sort((a, b) => b.score - a.score);
    const sel = scored.slice(0, Math.max(1, Number(topK || 3)));
    return sel.map(({ score, d }) => ({
      score,
      runId: d.runId,
      stepIndex: Number(d.stepIndex || -1),
      success: d.success === '1',
      text: d.text,
      args: (() => { try { return JSON.parse(d.args || '{}'); } catch { return undefined; } })(),
    }));
  } catch (e) {
    logger.warn?.('Memory search tool failed', { label: 'MEM', e: String(e) });
    return [];
  }
}

export default {
  upsertPlanMemory,
  upsertToolMemory,
  searchPlanMemories,
  searchToolMemories,
};
