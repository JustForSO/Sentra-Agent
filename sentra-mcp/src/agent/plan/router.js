import { config } from '../../config/index.js';
import { embedTexts } from '../../openai/client.js';
import logger from '../../logger/index.js';

/**
 * 构造用于重排序的插件“文档文本”
 * - 严格只用 meta.realWorldAction（真实能力描述）
 * - 可选兜底：当 realWorldAction 为空时，是否回退到 description（受 RERANK_USE_DESC_FALLBACK 控制）
 */
export function buildToolDoc(t) {
  const rw = String(t?.meta?.realWorldAction || '').trim();
  if (rw) return rw;
  const useFallback = (config.rerank?.useDescFallback !== false)
    || String(process.env.RERANK_USE_DESC_FALLBACK || '').toLowerCase() === 'true';
  return useFallback ? String(t?.description || '').trim() : '';
}

/**
 * 调用 SiliconFlow 在线重排序
 * 仅关注 results: [{ index, relevance_score }]
 */
function buildRerankUrl(baseURL) {
  const root = String(baseURL || 'https://api.siliconflow.cn').replace(/\/+$/, '');
  if (/\/rerank$/i.test(root)) return root;                // e.g. https://yuanplus.cloud/v1/rerank
  if (/\/v\d+$/i.test(root)) return root + '/rerank';     // e.g. https://yuanplus.cloud/v1 -> +/rerank
  return root + '/v1/rerank';                               // e.g. https://yuanplus.cloud -> +/v1/rerank
}

// 中文：从 judge.reason 中提取用于重排序的子查询
// 仅使用英文分号 ';' 进行分割，不做任何其它归一化或动词过滤。
function extractSubQueriesFromReason(jr, fallbackQuery, maxSubqueries = 5) {
  const src = String(jr || '').trim();
  const fq = String(fallbackQuery || '').trim();
  let parts = src.split(';').map(s => s.trim()).filter(Boolean);
  if (Number.isFinite(maxSubqueries) && maxSubqueries > 0) {
    parts = parts.slice(0, maxSubqueries);
  }
  if (!parts.length && fq) return [fq];
  return parts;
}

export async function rerankDocumentsSiliconFlow({ query, documents, baseURL, apiKey, model, topN, timeoutMs }) {
  const url = buildRerankUrl(baseURL);
  const docsClean = (documents || [])
    .map((d) => (typeof d === 'string' ? d : String(d?.text || '')))
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const q = String(query || '').trim();
  if (!q || docsClean.length === 0) {
    throw new Error(`Invalid rerank inputs: query='${q}', docs=${docsClean.length}`);
  }
  const payload = { model: model || 'BAAI/bge-reranker-v2-m3', query: q, documents: docsClean };
  // -1 或 <=0 代表不限制：为确保服务端全量返回，直接设置为文档总数
  if (!Number.isFinite(topN) || Number(topN) <= 0) {
    payload.top_n = docsClean.length;
  } else if (Number.isFinite(topN) && topN > 0) {
    const tn = Math.max(1, Math.min(Number(topN), docsClean.length));
    payload.top_n = tn;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(3000, Number(timeoutMs || 12000)));
  try {
    logger.debug?.('Rerank request', { label: 'RERANK', url, model: payload.model, docs: docsClean.length, top_n: payload.top_n });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const preview = text ? ` ${text.slice(0, 200)}` : '';
      throw new Error(`Rerank HTTP ${res.status}:${preview}`);
    }
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map(r => ({ index: Number(r.index), score: Number(r.relevance_score || 0) }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 对 manifest 执行“余弦粗排 + 在线精排（可选）”
 * - query: 使用 judgeReason（避免被 objective 误导）
 * - 文档：仅使用 meta.realWorldAction（可选兜底 description）
 * - 返回：{ manifest: rankedManifest, indices, scores }
 */
export async function rerankManifest({ manifest, judgeReason, objective, candidateK, topN }) {
  try {
    const docs = (manifest || []).map(buildToolDoc);
    const jr = String(judgeReason || '').trim();
    const qo = String(objective || '').trim();
    const query = jr || qo; // 当 judgeReason 为空时，回退到 objective
    if (!docs.length || !query) {
      return { manifest, indices: manifest.map((_, i) => i), scores: [] };
    }

    // 1) 余弦粗排（快速）：取前 candidateK 个候选
    const embs = await embedTexts({ texts: [query, ...docs] });
    const qv = embs[0] || [];
    const dvs = embs.slice(1);
    const sims = dvs.map((v) => {
      let dot = 0, na = 0, nb = 0;
      const L = Math.min(v.length, qv.length);
      for (let i = 0; i < L; i++) { const x = qv[i]; const y = v[i]; dot += x * y; na += x * x; nb += y * y; }
      if (na === 0 || nb === 0) return 0;
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    });
    const orderByCos = sims.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s);
    // -1 或 <=0 代表不过滤：直接全量进入精排
    const Kraw = Number.isFinite(candidateK) ? Number(candidateK) : Number(config.rerank?.candidateK ?? 50);
    const K = (Kraw <= 0) ? orderByCos.length : Math.max(1, Kraw);
    const preIdx = orderByCos.slice(0, Math.min(K, orderByCos.length)).map((x) => x.i);
    // 仅对在线精排阶段清洗空文档：记录 (原索引, 文本)
    const prePairs = preIdx.map((i) => ({ i, text: String(docs[i] || '').trim() })).filter(p => !!p.text);
    const preDocs = prePairs.map(p => p.text);

    // 2) 在线精排（可选，多段查询聚合）
    const enable = (config.rerank?.enable !== false) && String(process.env.RERANK_ENABLE || 'true').toLowerCase() !== 'false';
    const apiKey = process.env.RERANK_API_KEY || config.rerank?.apiKey || '';
    const tnRaw = Number.isFinite(topN) ? Number(topN) : Number(process.env.RERANK_TOP_N) || Number(config.rerank?.topN) || preDocs.length;
    const finalTopN = (tnRaw <= 0) ? preDocs.length : Math.max(1, Math.min(tnRaw, preDocs.length));
    if (enable && apiKey) {
      try {
        // 允许 RERANK_MAX_SUBQUERIES<=0 表示不限制：不要用 `|| 5` 覆盖 0
        const maxSubsCfg = Number(config.rerank?.maxSubqueries);
        const subQueries = extractSubQueriesFromReason(jr, query, maxSubsCfg);
        if (config.flags.enableVerboseSteps) {
          // 打印全部子查询，避免误解为只支持前5个
          logger.info('重排序子查询', { label: 'RERANK', count: subQueries.length, items: subQueries });
        }

        // 并发执行所有子查询的在线精排，并在全部完成后聚合
        const combined = new Map(); // 原索引 -> { freq, sumScore, sumRR }
        const calls = subQueries.map((sq) => rerankDocumentsSiliconFlow({
          query: sq,
          documents: preDocs,
          baseURL: process.env.RERANK_BASE_URL || config.rerank?.baseURL,
          apiKey,
          model: process.env.RERANK_MODEL || config.rerank?.model,
          topN: finalTopN,
          timeoutMs: Number(process.env.RERANK_TIMEOUT_MS || config.rerank?.timeoutMs || 12000),
        }));
        const settled = await Promise.allSettled(calls);
        let okCount = 0, failCount = 0;
        for (const st of settled) {
          if (st.status === 'fulfilled' && Array.isArray(st.value)) {
            okCount += 1;
            st.value.forEach((r, rankIdx) => {
              const orig = prePairs[r.index]?.i;
              if (!Number.isInteger(orig)) return;
              const rr = 1 / (rankIdx + 1); // reciprocal rank
              const prev = combined.get(orig) || { freq: 0, sumScore: 0, sumRR: 0 };
              prev.freq += 1;
              prev.sumScore += Number.isFinite(r.score) ? r.score : 0;
              prev.sumRR += rr;
              combined.set(orig, prev);
            });
          } else {
            failCount += 1;
          }
        }
        if ((failCount > 0) && config.flags.enableVerboseSteps) {
          logger.warn?.('部分子查询在线重排失败（已忽略失败项）', { label: 'RERANK', okCount, failCount });
        }

        // 计算综合得分并排序
        const alpha = Number.isFinite(config.rerank?.aggAlpha) ? config.rerank.aggAlpha : 0.1;
        const beta = Number.isFinite(config.rerank?.aggBeta) ? config.rerank.aggBeta : 0.5;
        const gamma = Number.isFinite(config.rerank?.aggGamma) ? config.rerank.aggGamma : 0.4; // freq/score/rr 权重
        const idxScore = Array.from(combined.entries())
          .map(([i, agg]) => ({ i, s: alpha * agg.freq + beta * agg.sumScore + gamma * agg.sumRR }))
          .sort((a, b) => b.s - a.s);
        const rankedIndices = idxScore.slice(0, finalTopN).map((x) => x.i);
        const rankedScores = idxScore.slice(0, finalTopN).map((x) => x.s);
        const rankedManifest = rankedIndices.map((i) => manifest[i]);
        logger.info?.('重排序完成', { label: 'RERANK', topN: rankedIndices.length, topAi: rankedManifest?.[0]?.aiName, topScore: rankedScores?.[0] });
        return { manifest: rankedManifest, indices: rankedIndices, scores: rankedScores };
      } catch (e) {
        logger.warn?.('在线重排序失败，回退到余弦粗排', {
          label: 'RERANK',
          error: String(e),
          query,
          preDocs: preDocs.length,
          finalTopN,
        });
      }
    }

    // 3) 无在线重排或失败：沿用余弦粗排，并限制到 finalTopN
    const fallbackRequestedTopN = Number.isFinite(topN) ? Number(topN) : (Number(process.env.RERANK_TOP_N) || Number(config.rerank?.topN) || preDocs.length);
    const fallbackTopN = (fallbackRequestedTopN <= 0)
      ? (prePairs.length || preIdx.length)
      : Math.max(1, Math.min(Number(fallbackRequestedTopN), prePairs.length || preIdx.length));
    const rankedIndices = (prePairs.length ? prePairs.map(p => p.i) : preIdx).slice(0, fallbackTopN);
    const rankedManifest = rankedIndices.map((i) => manifest[i]);
    const rankedScores = rankedIndices.map((i) => sims[i] ?? 0);
    logger.info?.('重排序(仅粗排)完成', { label: 'RERANK', topN: rankedIndices.length, topAi: rankedManifest?.[0]?.aiName, topScore: rankedScores?.[0] });
    return { manifest: rankedManifest, indices: rankedIndices, scores: rankedScores };
  } catch (e) {
    logger.warn?.('重排序异常，使用原始清单', { label: 'RERANK', error: String(e) });
    return { manifest, indices: manifest.map((_, i) => i), scores: [] };
  }
}

export default { buildToolDoc, rerankDocumentsSiliconFlow, rerankManifest };
