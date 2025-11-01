import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import logger from '../logger/index.js';
import { chatCompletion } from '../openai/client.js';
import { HistoryStore } from '../history/store.js';
import { ok, fail } from '../utils/result.js';
import { summarizeToolHistory } from './summarizer.js';
import { clip } from '../utils/text.js';
import { timeParser, sleep } from '../utils/timing.js';
// 规划期与工具清单相关的辅助函数
import { buildPlanningManifest, manifestToBulletedText, buildToolContextSystem } from './plan/manifest.js';
import { buildDependentContextText } from './plan/history.js';
import { loadPrompt, renderTemplate, composeSystem } from './prompts/loader.js';
// 向量记忆：规划/工具检索与写入
import { upsertPlanMemory, upsertToolMemory, searchPlanMemories } from '../memory/index.js';
// 消息和事件工具
import { compactMessages, normalizeConversation } from './utils/messages.js';
import { emitRunEvent, wait, normKey } from './utils/events.js';
import { RunEvents } from '../bus/runEvents.js';
import { generatePlanViaFC } from './plan/plan_fc.js';
import { rerankManifest } from './plan/router.js';
// 各阶段逻辑
import { judgeToolNecessity } from './stages/judge.js';
import { getPreThought } from './stages/prethought.js';
import { generateToolArgs, validateArgs, fixToolArgs } from './stages/arggen.js';
import { evaluateRun } from './stages/evaluate.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolDef } from './tools/loader.js';

function now() { return Date.now(); }

// 清理 context 以供日志记录：省略 promptOverlays 等大字段
function sanitizeContextForLog(context) {
  if (!context || typeof context !== 'object') return context;
  const { promptOverlays, overlays, ...rest } = context;
  const sanitized = { ...rest };
  if (promptOverlays || overlays) {
    sanitized.promptOverlays = '<omitted>';
  }
  return sanitized;
}

// 多计划生成（native tools 模式）——单次生成一个候选
async function generateSingleNativePlan({ messages, tools, allowedAiNames, temperature }) {
  const res = await chatCompletion({
    messages,
    tools,
    tool_choice: { type: 'function', function: { name: 'emit_plan' } },
    temperature
  });
  const call = res.choices?.[0]?.message?.tool_calls?.[0];
  let parsed; try { parsed = call?.function?.arguments ? JSON.parse(call.function.arguments) : {}; } catch { parsed = {}; }
  let steps = Array.isArray(parsed?.plan?.steps) ? parsed.plan.steps.map((s) => ({
    aiName: s?.aiName,
    reason: s?.reason || '',
    nextStep: s?.nextStep || '',
    draftArgs: s?.draftArgs || {},
    dependsOn: Array.isArray(s?.dependsOn) ? s.dependsOn : undefined
  })) : [];
  // 过滤未知工具
  const validNames = new Set(allowedAiNames || []);
  steps = (validNames.size ? steps.filter((s) => s.aiName && validNames.has(s.aiName)) : steps);
  return { steps };
}

// 候选计划审核与选择（使用 reasoner 模型 + JSON 提示）
async function selectBestNativePlan({ objective, manifest, candidates, context }) {
  try {
    const pa = await loadPrompt('plan_audit');
    const overlays = (context?.promptOverlays || context?.overlays || {});
    const overlayGlobal = overlays.global?.system || overlays.global || '';
    const overlayAudit = overlays.audit?.system || overlays.plan_audit?.system || overlays.audit || overlays.plan_audit || '';
    const sys = composeSystem(pa.system, [overlayGlobal, overlayAudit].filter(Boolean).join('\n\n'));
    const manifestText = manifestToBulletedText(Array.isArray(manifest) ? manifest : []);
    const candidatesList = candidates.map((c, i) => `#${i}: ${clip(c.steps, 1200)}`).join('\n');
    const baseMsgs = compactMessages([
      { role: 'system', content: sys },
      { role: 'user', content: renderTemplate(pa.user_goal, { objective }) },
      { role: 'assistant', content: renderTemplate(pa.assistant_manifest, { manifestBulleted: manifestText }) },
      { role: 'user', content: renderTemplate(pa.user_candidates, { candidatesList }) },
      { role: 'user', content: pa.user_request },
    ]);

    // 审核开关：关闭时直接选择 #0
    if (!config.planner?.auditEnable) {
      return { index: 0, audit: 'audit disabled' };
    }

    // 定义 select_plan 工具（Native tools 模式）
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const selectPlanTool = await loadToolDef({
      baseDir: __dirname,
      toolPath: './tools/internal/select_plan.tool.json',
      schemaPath: './tools/internal/select_plan.schema.json',
      fallbackTool: {
        type: 'function',
        function: {
          name: 'select_plan',
          description: '从多份候选计划中选出最佳方案并说明理由',
          parameters: { type: 'object', properties: {} }
        }
      },
      fallbackSchema: {
        type: 'object',
        properties: {
          best: { type: 'integer', minimum: 0 },
          reason: { type: 'string' }
        },
        required: ['best'],
        additionalProperties: true
      }
    });
    const tools = [selectPlanTool];
    const temperature = Math.max(0.1, (config.llm.temperature ?? 0.2) - 0.1);
    const res = await chatCompletion({
      messages: baseMsgs,
      tools,
      tool_choice: { type: 'function', function: { name: 'select_plan' } },
      temperature
    });
    const call = res.choices?.[0]?.message?.tool_calls?.[0];
    let parsed; try { parsed = call?.function?.arguments ? JSON.parse(call.function.arguments) : {}; } catch { parsed = {}; }
    let idx = Number(parsed?.best);
    let reason = String(parsed?.reason || '');
    if (!Number.isFinite(idx)) idx = 0;
    idx = Math.max(0, Math.min(candidates.length - 1, idx));
    return { index: idx, audit: reason };
  } catch (e) {
    logger.warn?.('Native 多计划审核失败，回退到候选#0', { label: 'PLAN', error: String(e) });
    return { index: 0, audit: '' };
  }
}

export async function generatePlan(objective, mcpcore, context = {}, conversation) {
  const strategy = String(config.llm?.toolStrategy || 'auto');
  if (strategy === 'fc') {
    return generatePlanViaFC(objective, mcpcore, context, conversation);
  }
  let manifest = buildPlanningManifest(mcpcore);

  // 先进行一次“预思考”，可配置关闭该步骤
  const usePT = !!config.flags?.planUsePreThought;
  const preThought = usePT ? (await getPreThought(objective, manifest, conversation)) : '';

  // 重排序：仅使用 judgeReason 作为查询，文档只用 meta.realWorldAction
  try {
    const judgeReason = String(context?.judge?.reason || context?.judgeReason || '').trim();
    if ((judgeReason || objective) && (config.rerank?.enable !== false)) {
      const ranked = await rerankManifest({ manifest, judgeReason, objective, candidateK: config.rerank?.candidateK, topN: config.rerank?.topN });
      if (Array.isArray(ranked?.manifest) && ranked.manifest.length) {
        manifest = ranked.manifest;
        if (config.flags.enableVerboseSteps) {
          const tops = manifest.slice(0, Math.min(5, manifest.length)).map(x => x.aiName);
          logger.info('规划前重排序Top工具', { label: 'RERANK', top: tops });
        }
      }
    }
  } catch (e) {
    logger.warn?.('规划前重排序失败（忽略并继续）', { label: 'RERANK', error: String(e) });
  }

  // 枚举合法 aiName，限制模型只能选择清单内工具（此时 manifest 已是 Top-N）
  const allowedAiNames = (manifest || []).map((m) => m.aiName).filter(Boolean);

  // force LLM to emit a plan via function call (schema/tool loaded from JSON via loader)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const emitPlanTool = await loadToolDef({
    baseDir: __dirname,
    toolPath: './tools/internal/emit_plan.tool.json',
    schemaPath: './tools/internal/emit_plan.schema.json',
    mutateSchema: (schema) => {
      const aiNameProp = schema?.properties?.plan?.properties?.steps?.items?.properties?.aiName;
      if (aiNameProp && Array.isArray(allowedAiNames)) aiNameProp.enum = allowedAiNames;
    },
    fallbackTool: { type: 'function', function: { name: 'emit_plan', description: '产出工具执行顺序的 JSON 计划。每一步仅包含一个工具(aiName)与draftArgs(仅需包含必填字段)。', parameters: { type: 'object', properties: {} } } },
    fallbackSchema: { type: 'object', properties: { plan: { type: 'object', properties: { steps: { type: 'array', items: { type: 'object', properties: { aiName: { type: 'string' } }, required: ['aiName'] } } }, required: ['steps'], additionalProperties: true } }, required: ['plan'] },
  });
  const tools = [emitPlanTool];
  // 加载 emit_plan 提示模板，构造消息
  const ep = await loadPrompt('emit_plan');
  const overlays = (context?.promptOverlays || context?.overlays || {});
  const overlayGlobal = overlays.global?.system || overlays.global || '';
  const overlayPlan = overlays.plan?.system || overlays.emit_plan?.system || overlays.plan || overlays.emit_plan || '';
  const sys = composeSystem(ep.system, [overlayGlobal, overlayPlan].filter(Boolean).join('\n\n'));
  // 检索历史规划记忆（相似目标的成功计划），作为参考上下文
  let planMemoryMsgs = [];
  if (config.memory?.enable) {
    const mems = await searchPlanMemories({ objective });
    if (Array.isArray(mems) && mems.length) {
      const lines = mems.map((m, idx) => `#${idx + 1} (score=${m.score.toFixed(2)}):\n${m.text}`).join('\n\n');
      planMemoryMsgs.push({ role: 'assistant', content: `历史规划参考:\n${lines}` });
      if (config.flags.enableVerboseSteps) {
        logger.info('检索到历史规划参考', { label: 'MEM', hits: mems.length, topScore: Number(mems[0]?.score?.toFixed?.(2) || 0), minScore: config.memory.minScore });
      }
    }
  }
  const conv = normalizeConversation(conversation);
  // 生成 base messages（供单/多候选共用）
  const baseMessages = compactMessages([
    { role: 'system', content: sys },
    ...conv,
    { role: 'user', content: renderTemplate(ep.user_goal, { objective }) },
    ...(usePT ? [
      { role: 'assistant', content: renderTemplate(ep.assistant_thought, { preThought: preThought || '' }) },
    ] : []),
    { role: 'assistant', content: renderTemplate(ep.assistant_manifest, { manifestBulleted: manifestToBulletedText(manifest) }) },
    ...planMemoryMsgs,
    { role: 'user', content: ep.user_request }
  ]);

  // allowedAiNames 已在上文声明，直接复用
  const enableMulti = !!config.planner?.multiEnable && Number(config.planner?.multiCandidates || 0) > 1;
  let steps = [];
  if (enableMulti) {
    const K = Math.max(2, Math.min(5, Number(config.planner.multiCandidates || 3)));
    const tasks = [];
    for (let i = 0; i < K; i++) {
      const diversifyHint = `多方案生成：这是变体 #${i + 1}。请提供与其它变体差异明显且可执行的计划，步骤不超过 ${Math.max(1, Number(config.planner?.maxSteps || 8))} 步。`;
      const msgs = compactMessages([...baseMessages, { role: 'user', content: diversifyHint }]);
      tasks.push(generateSingleNativePlan({ messages: msgs, tools, allowedAiNames, temperature: Math.max(0.1, (config.llm.temperature ?? 0.2) - 0.1 + Math.min(0.3, 0.03 * i)) }));
    }
    const cand = await Promise.allSettled(tasks);
    const candidates = cand
      .map((p) => (p.status === 'fulfilled' ? p.value : null))
      .filter((c) => c && Array.isArray(c.steps) && c.steps.length > 0);
    if (config.flags.enableVerboseSteps) {
      logger.info('Native 多计划：生成候选数量', { label: 'PLAN', count: candidates.length });
    }
    if (candidates.length === 0) {
      // 回退到单次生成
      const one = await generateSingleNativePlan({ messages: baseMessages, tools, allowedAiNames, temperature: Math.max(0.1, (config.llm.temperature ?? 0.2) - 0.1) });
      steps = one.steps || [];
    } else if (candidates.length === 1) {
      steps = candidates[0].steps || [];
    } else {
      const pick = await selectBestNativePlan({ objective, manifest, candidates, context });
      const idx = Math.max(0, Math.min(candidates.length - 1, Number(pick.index) || 0));
      steps = candidates[idx].steps || [];
      if (config.flags.enableVerboseSteps) {
        logger.info('Native 多计划：选择候选', { label: 'PLAN', index: idx, audit: clip(String(pick.audit || ''), 360) });
      }
      try {
        if (context?.runId) {
          await HistoryStore.append(context.runId, { type: 'plan_audit', mode: 'native', candidates: candidates.length, chosenIndex: idx, reason: String(pick.audit || '') });
        }
      } catch {}
    }
  } else {
    // 原有单计划路径
    const one = await generateSingleNativePlan({ messages: baseMessages, tools, allowedAiNames, temperature: Math.max(0.1, (config.llm.temperature ?? 0.2) - 0.1) });
    steps = one.steps || [];
  }
  // Auto fallback to function_call planning when native tool-call produced empty plan
  if (strategy === 'auto' && steps.length === 0) {
    try {
      const alt = await generatePlanViaFC(objective, mcpcore, context, conversation);
      if (Array.isArray(alt?.steps) && alt.steps.length) {
        steps = alt.steps;
      }
    } catch (e) {
      logger.warn?.('FC 规划回退失败（忽略）', { label: 'PLAN', error: String(e) });
    }
  }

  // 若剔除未知工具后为空或发生剔除，触发一次严格重规划（仅允许 allowedAiNames）
  if (steps.length === 0 || removedUnknown) {
    try {
      if (config.flags.enableVerboseSteps) {
        const dropped = (parsed?.plan?.steps || []).filter((s) => !validNames.has(s?.aiName)).map((s) => s?.aiName);
        logger.warn?.('触发严格重规划：上次计划包含未知工具或为空', { label: 'PLAN', dropped, allowedAiNames });
      }
      const replanMessages2 = compactMessages([
        { role: 'system', content: sys },
        { role: 'user', content: renderTemplate(ep.user_goal, { objective }) },
        ...(usePT ? [
          { role: 'assistant', content: renderTemplate(ep.assistant_thought, { preThought: preThought || '' }) },
        ] : []),
        { role: 'assistant', content: renderTemplate(ep.assistant_manifest, { manifestBulleted: manifestToBulletedText(manifest) }) },
        { role: 'assistant', content: '严格约束：只能从以下 aiName 中选择，并且每步仅包含一个工具。若无合适工具可输出空计划。可选 aiName 列表:\n' + (allowedAiNames.join(', ')) },
        { role: 'user', content: ep.user_request }
      ]);
      const re2 = await chatCompletion({ messages: replanMessages2, tools, tool_choice: { type: 'function', function: { name: 'emit_plan' } }, temperature: Math.max(0.1, (config.llm.temperature ?? 0.2) - 0.1) });
      const rcall2 = re2.choices?.[0]?.message?.tool_calls?.[0];
      let reparsed2; try { reparsed2 = rcall2?.function?.arguments ? JSON.parse(rcall2.function.arguments) : {}; } catch { reparsed2 = {}; }
      let rsteps2 = Array.isArray(reparsed2?.plan?.steps) ? reparsed2.plan.steps.map((s) => ({ aiName: s?.aiName, reason: s?.reason || '', nextStep: s?.nextStep || '', draftArgs: s?.draftArgs || {}, dependsOn: Array.isArray(s?.dependsOn) ? s.dependsOn : undefined })) : [];
      const rfiltered2 = rsteps2.filter((s) => s.aiName && validNames.has(s.aiName));
      steps = rfiltered2;
    } catch (e) {
      logger.warn?.('严格重规划异常（忽略）', { label: 'PLAN', error: String(e) });
    }
  }

  // 依赖校验：越界/自依赖/环
  const validateDepends = (arr) => {
    const n = arr.length;
    const edges = new Map();
    const indeg = Array(n).fill(0);
    let invalid = false;
    for (let i = 0; i < n; i++) {
      const deps = Array.isArray(arr[i].dependsOn) ? arr[i].dependsOn : [];
      const cleaned = [];
      for (const d of deps) {
        const k = Number(d);
        if (!Number.isInteger(k) || k < 0 || k >= n || k === i) { invalid = true; continue; }
        cleaned.push(k);
      }
      arr[i].dependsOn = cleaned.length ? cleaned : undefined;
      for (const d of (arr[i].dependsOn || [])) {
        if (!edges.has(d)) edges.set(d, []);
        edges.get(d).push(i);
        indeg[i]++;
      }
    }
    // Kahn 拓扑
    const q = [];
    for (let i = 0; i < n; i++) if (indeg[i] === 0) q.push(i);
    let visited = 0;
    while (q.length) {
      const u = q.shift();
      visited++;
      for (const v of (edges.get(u) || [])) { if (--indeg[v] === 0) q.push(v); }
    }
    const hasCycle = visited !== n;
    return { ok: !hasCycle && !invalid, hasCycle, invalidRefs: invalid };
  };

  let vres = validateDepends(steps);
  if (!vres.ok) {
    logger.warn?.('规划依赖校验未通过，尝试一次重规划', { label: 'PLAN', hasCycle: vres.hasCycle, invalidRefs: vres.invalidRefs });
    // 一次性重规划：追加严格依赖约束
    const replanMessages = compactMessages([
      { role: 'system', content: sys },
      { role: 'user', content: renderTemplate(ep.user_goal, { objective }) },
      ...(usePT ? [
        { role: 'assistant', content: renderTemplate(ep.assistant_thought, { preThought: preThought || '' }) },
      ] : []),
      { role: 'assistant', content: renderTemplate(ep.assistant_manifest, { manifestBulleted: manifestToBulletedText(manifest) }) },
      { role: 'assistant', content: '上一个计划的 dependsOn 存在越界/环/自依赖问题。请重新生成一个满足以下严格约束的计划：\n1) 每一步的 dependsOn 仅引用小于当前步索引的步骤；\n2) 禁止任何形式的环；\n3) 避免自依赖；\n4) 若不需要依赖请省略 dependsOn 字段；\n5) 仅输出必需字段并符合 emit_plan 的 JSON 结构。' },
      { role: 'user', content: ep.user_request }
    ]);
    const re = await chatCompletion({ messages: replanMessages, tools, tool_choice: { type: 'function', function: { name: 'emit_plan' } }, temperature: Math.max(0.1, (config.llm.temperature ?? 0.2) - 0.1) });
    const rcall = re.choices?.[0]?.message?.tool_calls?.[0];
    let reparsed; try { reparsed = rcall?.function?.arguments ? JSON.parse(rcall.function.arguments) : {}; } catch { reparsed = {}; }
    let rsteps = Array.isArray(reparsed?.plan?.steps) ? reparsed.plan.steps.map((s) => ({ aiName: s?.aiName, reason: s?.reason || '', nextStep: s?.nextStep || '', draftArgs: s?.draftArgs || {}, dependsOn: Array.isArray(s?.dependsOn) ? s.dependsOn : undefined })) : [];
    // 过滤未知工具
    const rfiltered = rsteps.filter((s) => s.aiName && validNames.has(s.aiName));
    rsteps = rfiltered;
    const v2 = validateDepends(rsteps);
    if (v2.ok) {
      steps = rsteps;
      logger.info('重规划成功，依赖校验通过', { label: 'PLAN', steps: steps.length });
    } else {
      logger.warn?.('重规划仍未通过依赖校验，将执行兜底修正', { label: 'PLAN' });
      // 兜底修正：移除全部 dependsOn，避免运行期死锁
      steps = (steps || []).map((s) => ({ ...s, dependsOn: undefined }));
    }
  }

  if (config.flags.enableVerboseSteps) {
    logger.info(`规划生成: 共 ${steps.length} 步`, { label: 'PLAN', stepsPreview: clip(steps) });
  }

  // 记忆：保存本次规划（目标与步骤概览），供后续相似任务参考
  if (config.memory?.enable) {
    try { await upsertPlanMemory({ runId: context?.runId || 'unknown', objective, plan: { steps } }); } catch {}
  }

  return { manifest, steps };
}

export async function executePlan(runId, objective, mcpcore, plan, opts = {}) {
  // We'll build a per-step tool schema to reduce ambiguity
  const recentResults = Array.isArray(opts.seedRecent) ? [...opts.seedRecent] : [];
  const context = opts.context || {};
  const startIndex = Math.max(0, Number(opts.startIndex) || 0);
  const used = [];
  let succeeded = 0;
  const conv = normalizeConversation(opts.conversation);

  const total = plan.steps.length;
  const maxConc = Math.max(1, Number(config.planner?.maxConcurrency ?? 3));
  const finished = new Set();
  const started = new Set();
  const delayUntil = new Map(); // stepIndex -> epochMs when it becomes schedulable
  const runningByTool = new Map(); // aiName -> count
  const runningByProvider = new Map(); // providerKey -> count

  // 工具元信息（provider 等）及并发上限
  const toolList = mcpcore.getAvailableTools();
  const toolMeta = new Map(toolList.map((t) => [t.aiName, { provider: t.provider || 'local' }]));
  // 中文：详细工具表（含 meta），用于在事件中继承插件 meta
  const toolMetaMap = new Map((mcpcore.getAvailableToolsDetailed?.() || []).map((t) => [t.aiName, t.meta || {}]));
  const toolConcDefault = Math.max(1, Number(config.planner?.toolConcurrencyDefault || 1));
  const provConcDefault = Math.max(1, Number(config.planner?.providerConcurrencyDefault || 4));
  const toolOverride = config.planner?.toolConcurrency || {};
  const provOverride = config.planner?.providerConcurrency || {};
  const getToolLimit = (aiName) => Number(toolOverride[normKey(aiName)] ?? toolConcDefault);
  const getProvLimit = (provLabel) => Number(provOverride[normKey(provLabel)] ?? provConcDefault);

  // ========= 实时通讯优化：基于依赖关系的“组”缓冲与按序发送 =========
  // 中文：预计算依赖、反向依赖、连通分量（存在依赖边的连通子图视为一组）。
  // - 若某步既不依赖他人，也没有被他人依赖，则为“孤立”步骤：实时结果即时发送（优先反馈）。
  // - 若存在依赖关系（直接/间接），归入对应“依赖组”。组内结果先缓冲；当组所有步骤执行完毕后，按拓扑顺序统一发送。
  const depsArr = plan.steps.map((s, idx) => {
    const raw = Array.isArray(s?.dependsOn) ? s.dependsOn : [];
    const norm = [];
    for (const d of raw) {
      const k = Number(d);
      if (Number.isInteger(k) && k >= 0 && k < total && k !== idx) norm.push(k);
    }
    return norm;
  });
  const revDepsArr = Array.from({ length: total }, () => []);
  for (let i = 0; i < total; i++) {
    for (const d of depsArr[i]) revDepsArr[d].push(i);
  }
  const isIsolated = Array.from({ length: total }, (_, i) => (depsArr[i].length === 0 && revDepsArr[i].length === 0));
  // 构造无向邻接用于识别连通分量
  const undirected = Array.from({ length: total }, () => new Set());
  for (let i = 0; i < total; i++) {
    for (const d of depsArr[i]) { undirected[i].add(d); undirected[d].add(i); }
  }
  const groupOf = new Array(total).fill(null); // 步骤 -> 组ID（null 表示孤立步）
  const groups = []; // { id, nodes: number[], flushed }
  for (let i = 0; i < total; i++) {
    if (isIsolated[i] || groupOf[i] !== null) continue;
    const gid = groups.length;
    const nodes = [];
    const q = [i];
    groupOf[i] = gid;
    while (q.length) {
      const u = q.shift();
      nodes.push(u);
      for (const v of undirected[u]) {
        if (!isIsolated[v] && groupOf[v] === null) {
          groupOf[v] = gid;
          q.push(v);
        }
      }
    }
    groups.push({ id: gid, nodes, flushed: false });
  }
  const groupPending = new Map(groups.map((g) => [g.id, g.nodes.length])); // 组内尚未完成的步数
  const groupBuffers = new Map(); // gid -> Map(stepIndex -> event)
  const topoOrderForGroup = (gid) => {
    const nodes = groups[gid]?.nodes || [];
    const inSet = new Set(nodes);
    const indeg = new Map();
    for (const u of nodes) indeg.set(u, 0);
    for (const u of nodes) {
      for (const d of depsArr[u]) if (inSet.has(d)) indeg.set(u, indeg.get(u) + 1);
    }
    const q = nodes.filter((u) => indeg.get(u) === 0).sort((a, b) => a - b);
    const out = [];
    while (q.length) {
      const u = q.shift();
      out.push(u);
      for (const v of revDepsArr[u]) {
        if (inSet.has(v)) {
          indeg.set(v, indeg.get(v) - 1);
          if (indeg.get(v) === 0) { q.push(v); q.sort((a, b) => a - b); }
        }
      }
    }
    if (out.length !== nodes.length) {
      const seen = new Set(out);
      const remain = nodes.filter((x) => !seen.has(x)).sort((a, b) => a - b);
      return out.concat(remain);
    }
    return out;
  };
  const buildDependsNote = (i) => {
    const depOn = depsArr[i] || [];
    const depBy = revDepsArr[i] || [];
    if (depOn.length === 0 && depBy.length === 0) return '无依赖关系';
    const parts = [];
    if (depOn.length) parts.push(`依赖步骤: ${depOn.map((x) => `#${x + 1}`).join(', ')}`);
    if (depBy.length) parts.push(`被步骤依赖: ${depBy.map((x) => `#${x + 1}`).join(', ')}`);
    return parts.join('；');
  };
  const emitToolResultGrouped = (ev, stepIndex) => {
    const gid = groupOf[stepIndex];
    if (gid === null || gid === undefined) {
      // 孤立步骤：即时发送（优先反馈）
      emitRunEvent(runId, ev);
      return;
    }
    if (!groupBuffers.has(gid)) groupBuffers.set(gid, new Map());
    // 若同一步骤多次重试，仅保留最新一次结果
    groupBuffers.get(gid).set(stepIndex, ev);
  };
  const flushGroupIfReady = (gid) => {
    if (gid === null || gid === undefined) return;
    const g = groups.find((x) => x.id === gid);
    if (!g || g.flushed) return;
    const left = groupPending.get(gid) || 0;
    if (left > 0) return;
    const order = topoOrderForGroup(gid);
    const buf = groupBuffers.get(gid) || new Map();
    for (const idx of order) {
      const ev = buf.get(idx);
      if (ev) emitRunEvent(runId, ev);
    }
    groupBuffers.delete(gid);
    g.flushed = true;
  };
  // 认为 startIndex 之前的步骤已完成（用于依赖判断，不会重复执行）
  for (let i = 0; i < Math.min(startIndex, total); i++) finished.add(i);
  // 对于已视为完成的历史步骤，若其位于某个依赖组，减少该组待完成计数，避免阻塞后续刷新
  for (let i = 0; i < Math.min(startIndex, total); i++) {
    const gid = groupOf[i];
    if (gid !== null && gid !== undefined && groupPending.has(gid)) {
      groupPending.set(gid, Math.max(0, (groupPending.get(gid) || 0) - 1));
    }
  }

  // 单步执行器：保持原有逻辑
  const executeSingleStep = async (i) => {
    const step = plan.steps[i];
    const aiName = step.aiName;
    const draftArgs = step.draftArgs || {};
    const stepStart = now();

    const manifestItem = plan.manifest?.find((m) => m.aiName === aiName);
    if (!manifestItem) {
      const elapsed = now() - stepStart;
      const res = { success: false, code: 'NOT_FOUND', data: null, message: `Unknown aiName: ${aiName}` };
      // 中文：未知工具也参与“组”缓冲；事件携带依赖说明与组信息
      const depOn = depsArr[i] || [];
      const depBy = revDepsArr[i] || [];
      const gid = groupOf[i];
      const ev = {
        type: 'tool_result',
        stepIndex: i,
        aiName,
        reason: step.reason || '',
        nextStep: step.nextStep || '',
        args: step.draftArgs || {},
        result: res,
        elapsedMs: elapsed,
        dependsOn: depOn,
        dependedBy: depBy,
        dependsNote: buildDependsNote(i),
        groupId: (gid ?? null),
        groupSize: (gid != null && groups[gid]?.nodes?.length) ? groups[gid].nodes.length : 1,
        toolMeta: {},
      };
      emitToolResultGrouped(ev, i);
      await HistoryStore.append(runId, ev);
      if (config.flags.enableVerboseSteps) logger.warn?.('跳过未知工具步骤', { label: 'STEP', aiName });
      return { usedEntry: { aiName, elapsedMs: elapsed, success: res.success, code: res.code }, succeeded: 0 };
    }

    if (config.flags.enableVerboseSteps) {
      logger.info(`执行第${i + 1}/${plan.steps.length}步`, { label: 'STEP', aiName, reason: step.reason || '', nextStep: step.nextStep || '', draftArgs: clip(draftArgs) });
    }

    // 获取工具完整定义
    let currentToolFull = mcpcore.getAvailableTools().find((t) => t.aiName === aiName) || {
      description: manifestItem?.description || '',
      inputSchema: manifestItem?.inputSchema || { type: 'object', properties: {} }
    };
    const schema = currentToolFull.inputSchema || manifestItem?.inputSchema || { type: 'object', properties: {} };

    // 生成参数（包含复用逻辑）
    let toolArgs = draftArgs;
    let reused = false;
    try {
      const argsResult = await generateToolArgs({
        runId,
        stepIndex: i,
        objective,
        step,
        currentToolFull,
        manifestItem,
        conv,
        totalSteps: plan.steps.length,
        context
      });
      toolArgs = argsResult.toolArgs;
      reused = argsResult.reused;
    } catch (e) {
      emitRunEvent(runId, { type: 'arggen_error', stepIndex: i, aiName, error: String(e) });
      await HistoryStore.append(runId, { type: 'arggen_error', stepIndex: i, aiName, error: String(e) });
      logger.warn?.('参数生成失败，使用草案参数', { label: 'ARGGEN', aiName, error: String(e) });
    }

    // 参数校验
    const validateResult = await validateArgs({ schema, toolArgs, aiName });
    let ajvValid = validateResult.valid;
    let ajvErrors = validateResult.errors;
    toolArgs = validateResult.args;

    // 参数纠错（如果校验失败）
    if (!ajvValid) {
      toolArgs = await fixToolArgs({
        runId,
        stepIndex: i,
        objective,
        step,
        currentToolFull,
        schema,
        ajvErrors,
        toolArgs,
        totalSteps: plan.steps.length,
        context
      });
    }

    if (config.flags.enableVerboseSteps) logger.info(`参数确定`, { label: 'ARGS', aiName, toolArgsPreview: clip(toolArgs) });
    // 将最终用于调用的参数写入历史，并通过事件总线实时分发
    try {
      emitRunEvent(runId, { type: 'args', stepIndex: i, aiName, args: toolArgs, reused });
      await HistoryStore.append(runId, { type: 'args', stepIndex: i, aiName, args: toolArgs, reused });
    } catch {}

    // === schedule 延迟反馈机制：仅当插件 schema 中定义了 schedule 参数时启用 ===
    let delayMs = 0;
    let scheduleDetected = false;
    const schemaHasSchedule = !!(currentToolFull?.inputSchema?.properties?.schedule);
    
    if (schemaHasSchedule && toolArgs && Object.prototype.hasOwnProperty.call(toolArgs, 'schedule') && toolArgs.schedule) {
      scheduleDetected = true;
      try {
        const scheduleText = typeof toolArgs.schedule === 'string' ? toolArgs.schedule : (toolArgs.schedule.when || toolArgs.schedule.text || '');
        const lang = typeof toolArgs.schedule === 'object' ? toolArgs.schedule.language : undefined;
        const parsed = timeParser.parseTimeExpression(scheduleText, { language: lang || (scheduleText.match(/[\u4e00-\u9fa5]/) ? 'zh' : 'en') });
        if (parsed.success && parsed.parsedDateTime) {
          const nowMs = Date.now();
          const targetMs = parsed.parsedDateTime.toMillis ? parsed.parsedDateTime.toMillis() : Date.parse(parsed.parsedDateTime);
          delayMs = Math.max(0, targetMs - nowMs);
          if (delayMs > 0) {
            logger.info?.('Schedule 延迟反馈启用', { label: 'SCHEDULE', aiName, scheduleText, delayMs, targetISO: parsed.parsedISO });
          }
        }
      } catch (e) {
        logger.warn?.('Schedule 解析失败，忽略延迟反馈', { label: 'SCHEDULE', aiName, error: String(e) });
      }
    }

    let res;
    let elapsed;
    if (scheduleDetected && delayMs > 0) {
      // 启动工具执行（异步，不等待）
      const toolPromise = mcpcore.callByAIName(aiName, toolArgs, { runId, stepIndex: i });
      let toolCompleted = false;
      let toolResult = null;
      let toolCompletedAt = 0;

      // 监听工具完成
      toolPromise.then(r => {
        toolResult = r;
        toolCompleted = true;
        toolCompletedAt = Date.now();
      }).catch(e => {
        toolResult = { success: false, code: 'ERROR', error: String(e), data: null };
        toolCompleted = true;
        toolCompletedAt = Date.now();
      });

      // 等待延迟时间
      await sleep(delayMs);

      if (toolCompleted) {
        // 工具已完成，但时间还没到（已经等待了）
        res = toolResult;
        elapsed = toolCompletedAt - stepStart;
        logger.info?.('Schedule 延迟反馈: 工具已提前完成，延迟后反馈', { label: 'SCHEDULE', aiName, delayMs, actualMs: toolCompletedAt - stepStart });
      } else {
        // 时间到了但工具未完成：生成人性化的进度消息（继承 overlays 品牌语气）
        let progressMessage = `工具正在执行中，规定时间 ${Math.round(delayMs / 1000)}s 内未完成，继续等待...`;
        try {
          const overlays = (context?.promptOverlays || context?.overlays || {});
          const overlayGlobal = overlays.global?.system || overlays.global || '';
          const overlayProgress = overlays.schedule_progress?.system || overlays.schedule_progress || '';
          
          if (overlayGlobal || overlayProgress) {
            const sp = await loadPrompt('schedule_progress');
            const systemContent = composeSystem(sp.system, [overlayGlobal, overlayProgress].filter(Boolean).join('\n\n'));
            const userContent = renderTemplate(sp.user, {
              aiName,
              reason: step.reason || '完成任务',
              delaySeconds: String(Math.round(delayMs / 1000))
            });

            const progressPrompt = [
              { role: 'system', content: systemContent },
              { role: 'user', content: userContent }
            ];
            const progressResp = await chatCompletion({
              messages: progressPrompt,
              temperature: 0.7,
              max_tokens: 100
            });
            const generatedMsg = progressResp?.choices?.[0]?.message?.content?.trim();
            if (generatedMsg && generatedMsg.length > 0 && generatedMsg.length < 300) {
              progressMessage = generatedMsg;
            }
          }
        } catch (e) {
          logger.warn?.('生成人性化进度消息失败，使用默认消息', { label: 'SCHEDULE', error: String(e) });
        }

        const intermediateEvent = {
          type: 'tool_choice',
          stepIndex: i,
          aiName,
          reason: step.reason || '',
          status: 'in_progress',
          message: progressMessage,
          elapsedMs: Date.now() - stepStart
        };
        try {
          emitRunEvent(runId, intermediateEvent);
          await HistoryStore.append(runId, intermediateEvent);
          logger.info?.('Schedule 延迟反馈: 发送中间状态', { label: 'SCHEDULE', aiName, delayMs, message: progressMessage });
        } catch {}

        // 继续等待工具完成
        res = await toolPromise;
        elapsed = Date.now() - stepStart;
        logger.info?.('Schedule 延迟反馈: 工具延迟完成', { label: 'SCHEDULE', aiName, totalMs: elapsed });
      }
    } else {
      // 无 schedule 或延迟时间为 0：正常执行
      res = await mcpcore.callByAIName(aiName, toolArgs, { runId, stepIndex: i });
      elapsed = now() - stepStart;
    }
    // update rolling context and Redis history
    recentResults.push({ aiName, args: toolArgs, result: res, data: res.data });
    const limit = Math.max(1, Number(config.flags?.recentContextLimit ?? 5));
    if (recentResults.length > limit) recentResults.shift();

    // 中文：结果事件携带依赖信息与插件 meta；组内缓冲，组完成后按拓扑序统一发送
    const depOn = depsArr[i] || [];
    const depBy = revDepsArr[i] || [];
    const gid = groupOf[i];
    const toolMetaInherited = (toolMetaMap.get(aiName) || manifestItem?.meta || currentToolFull?.meta || {});
    const ev = {
      type: 'tool_result',
      stepIndex: i,
      aiName,
      reason: step.reason || '',
      nextStep: step.nextStep || '',
      args: toolArgs,
      result: res,
      elapsedMs: elapsed,
      dependsOn: depOn,
      dependedBy: depBy,
      dependsNote: buildDependsNote(i),
      groupId: (gid ?? null),
      groupSize: (gid != null && groups[gid]?.nodes?.length) ? groups[gid].nodes.length : 1,
      toolMeta: toolMetaInherited,
    };
    emitToolResultGrouped(ev, i);
    await HistoryStore.append(runId, ev);
    if (config.memory?.enable) {
      await upsertToolMemory({ runId, stepIndex: i, aiName, objective, reason: step.reason, args: toolArgs, result: res, success: !!res.success });
    }
    if (config.flags.enableVerboseSteps) logger.info('执行结果', { label: 'RESULT', aiName, success: res.success, code: res.code, dataPreview: clip(res?.data) });

    // 冷却命中：返回调度级延迟重排信息
    if (!res.success && res.code === 'COOLDOWN_ACTIVE') {
      const remainMs = Number(res.remainMs || (res.ttl ? res.ttl * 1000 : (config.planner?.cooldownDefaultMs || 1000)));
      const jitter = Math.floor(100 + Math.random() * 200);
      const requeueMs = Math.max(200, remainMs + jitter);
      return { usedEntry: { aiName, elapsedMs: elapsed, success: res.success, code: res.code }, succeeded: 0, requeueMs };
    }

    return { usedEntry: { aiName, elapsedMs: elapsed, success: res.success, code: res.code }, succeeded: res.success ? 1 : 0 };
  };

  const isReady = (i) => {
    if (i < startIndex) return false; // 不执行起点之前的步骤
    if (started.has(i) || finished.has(i)) return false;
    const due = delayUntil.get(i) || 0; if (due && now() < due) return false;
    const aiName = plan.steps[i]?.aiName;
    const prov = toolMeta.get(aiName)?.provider || 'local';
    const toolLim = getToolLimit(aiName);
    const provLim = getProvLimit(prov);
    const tRun = runningByTool.get(aiName) || 0;
    const pRun = runningByProvider.get(normKey(prov)) || 0;
    if (tRun >= toolLim) return false;
    if (pRun >= provLim) return false;
    const deps = Array.isArray(plan.steps[i]?.dependsOn) ? plan.steps[i].dependsOn : [];
    if (!deps.length) return true;
    for (const d of deps) {
      const idx = Number(d);
      if (!Number.isFinite(idx)) continue;
      if (!finished.has(idx)) return false;
    }
    return true;
  };

  const inFlight = new Map(); // i -> Promise
  const track = (i, p) => p.finally(() => { inFlight.delete(i); });

  while (finished.size < total) {
    // 尝试补满并发槽位
    for (let i = startIndex; i < total && inFlight.size < maxConc; i++) {
      if (isReady(i)) {
        started.add(i);
        const aiName = plan.steps[i]?.aiName;
        const prov = toolMeta.get(aiName)?.provider || 'local';
        runningByTool.set(aiName, (runningByTool.get(aiName) || 0) + 1);
        const provKey = normKey(prov);
        runningByProvider.set(provKey, (runningByProvider.get(provKey) || 0) + 1);

        const p = track(i, executeSingleStep(i).then((r) => {
          // 释放并发占位
          runningByTool.set(aiName, Math.max(0, (runningByTool.get(aiName) || 1) - 1));
          runningByProvider.set(provKey, Math.max(0, (runningByProvider.get(provKey) || 1) - 1));

          if (r?.requeueMs > 0) {
            // 调度级延迟重排：不标记完成，设置最早可调度时间
            delayUntil.set(i, now() + r.requeueMs);
            started.delete(i);
            if (r?.usedEntry) used.push(r.usedEntry);
            return;
          }
          finished.add(i);
          // 中文：更新组内剩余计数并在组完成时统一刷新实时事件
          const gid2 = groupOf[i];
          if (gid2 !== null && gid2 !== undefined && groupPending.has(gid2)) {
            groupPending.set(gid2, Math.max(0, (groupPending.get(gid2) || 0) - 1));
            flushGroupIfReady(gid2);
          }
          if (r?.usedEntry) used.push(r.usedEntry);
          if (r?.succeeded) succeeded += r.succeeded;
        }).catch((e) => {
          // 释放并发占位
          runningByTool.set(aiName, Math.max(0, (runningByTool.get(aiName) || 1) - 1));
          runningByProvider.set(provKey, Math.max(0, (runningByProvider.get(provKey) || 1) - 1));
          finished.add(i);
          // 中文：异常也视为完成，避免组刷新被阻塞
          const gid2 = groupOf[i];
          if (gid2 !== null && gid2 !== undefined && groupPending.has(gid2)) {
            groupPending.set(gid2, Math.max(0, (groupPending.get(gid2) || 0) - 1));
            flushGroupIfReady(gid2);
          }
          logger.warn?.('并行执行异常', { label: 'STEP', index: i, error: String(e) });
        }));
        inFlight.set(i, p);
      }
    }

    if (inFlight.size === 0) {
      // 若有延迟中的任务，等待最近的到期时间后继续调度
      let minWait = Infinity;
      for (const [idx, ts] of delayUntil.entries()) {
        if (idx < startIndex || finished.has(idx)) continue;
        const w = (ts || 0) - now();
        if (w > 0) minWait = Math.min(minWait, w);
      }
      if (Number.isFinite(minWait) && minWait !== Infinity) {
        await wait(minWait);
        continue;
      }
      // 无可执行项且没有运行中的任务：可能存在循环依赖/无效 dependsOn
      if (finished.size < total) {
        logger.warn?.('无可执行步骤，可能存在循环依赖/无效 dependsOn，强制跳过剩余步骤', { label: 'PLAN' });
        for (let i = startIndex; i < total; i++) {
          if (!finished.has(i)) {
            finished.add(i);
            const gid2 = groupOf[i];
            if (gid2 !== null && gid2 !== undefined && groupPending.has(gid2)) {
              groupPending.set(gid2, Math.max(0, (groupPending.get(gid2) || 0) - 1));
            }
          }
        }
        // 强制刷新所有已无待完成步数的组
        for (const g of groups) flushGroupIfReady(g.id);
      }
      break;
    }

    // 等待任意一个任务结束以继续调度
    await Promise.race([...inFlight.values()]);
  }

  const attempted = used.length;
  const successRate = attempted ? succeeded / attempted : 0;
  // 兜底：循环结束后，若仍有未刷新的组（理论上不应发生），统一刷新
  for (const g of groups) flushGroupIfReady(g.id);
  return { used, attempted, succeeded, successRate };
}

export async function planThenExecute({ objective, context = {}, mcpcore, conversation }) {
  const runId = uuidv4();
  await HistoryStore.append(runId, { type: 'start', objective, context: sanitizeContextForLog(context) });

  // 预判是否需要调用工具
  const manifest0 = buildPlanningManifest(mcpcore);
  const judge = await judgeToolNecessity(objective, manifest0, conversation, context);
  await HistoryStore.append(runId, { type: 'judge', need: judge.need, reason: judge.reason });
  if (!judge.need) {
    const plan = { manifest: manifest0, steps: [] };
    await HistoryStore.setPlan(runId, plan);
    await HistoryStore.append(runId, { type: 'plan', plan });
    const exec = { used: [], attempted: 0, succeeded: 0, successRate: 1 };
    const evalObj = { success: true, summary: '判定无需调用工具，直接完成。' };
    await HistoryStore.append(runId, { type: 'done', exec });
    const summary = '本次任务判定无需调用工具。';
    await HistoryStore.setSummary(runId, summary);
    await HistoryStore.append(runId, { type: 'summary', summary });
    return ok({ runId, plan, exec, eval: evalObj, summary });
  }

  const plan = await generatePlan(objective, mcpcore, { ...context, runId, judge, judgeReason: judge?.reason }, conversation);
  await HistoryStore.setPlan(runId, plan);
  await HistoryStore.append(runId, { type: 'plan', plan });

  let exec = await executePlan(runId, objective, mcpcore, plan, { conversation, context });
  let evalObj = await evaluateRun(objective, plan, exec, runId, context);

  // Global repair loop (circuit breaker): limit the number of repair cycles
  const maxRepairs = Math.max(0, Number(config.runner?.maxRepairs ?? 1));
  let repairs = 0;
  while (!evalObj.success && repairs < maxRepairs) {
    const firstFail = Array.isArray(evalObj.failedSteps) && evalObj.failedSteps.length
      ? evalObj.failedSteps.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0]
      : null;
    if (!firstFail) break;
    const failIndex = Math.max(0, Number(firstFail.index) || 0);
    const history = await HistoryStore.list(runId, 0, -1);
    const prior = history
      .filter((h) => h.type === 'tool_result' && Number(h.result?.success) === 1 && Number(h.stepIndex || 0) < failIndex)
      .map((h) => ({ aiName: h.aiName, args: h.args, result: h.result, data: h.result?.data }));

    await HistoryStore.append(runId, { type: 'retry_begin', after: failIndex, repairIndex: repairs + 1 });
    exec = await executePlan(runId, objective, mcpcore, plan, { startIndex: failIndex, seedRecent: prior, conversation, context });
    await HistoryStore.append(runId, { type: 'retry_done', after: failIndex, repairIndex: repairs + 1, exec });

    evalObj = await evaluateRun(objective, plan, exec, runId, context);
    repairs++;
  }

  await HistoryStore.append(runId, { type: 'done', exec });
  const summary = await summarizeToolHistory(runId, '', context);

  const okres = ok({ runId, plan, exec, eval: evalObj, summary });
  if (config.flags.enableVerboseSteps) {
    logger.info('Run completed', { label: 'RUN', runId, attempted: exec.attempted, succeeded: exec.succeeded, successRate: exec.successRate });
  }
  return okres;
}

// 流式执行：通过 RunEvents 推送（同时持久化到 HistoryStore），以 JSON 事件逐步产出
// 事件类型包括：start, judge, plan, args, tool_result, retry_begin, retry_done, evaluation, done, summary
export async function* planThenExecuteStream({ objective, context = {}, mcpcore, conversation, pollIntervalMs = 200 }) {
  const runId = uuidv4();
  const sub = RunEvents.subscribe(runId);

  // Producer: run the workflow in background while emitting events
  (async () => {
    try {
      // Start
      const sanitizedCtx = sanitizeContextForLog(context);
      emitRunEvent(runId, { type: 'start', objective, context: sanitizedCtx });
      await HistoryStore.append(runId, { type: 'start', objective, context: sanitizedCtx });

      // Judge necessity before planning
      const manifest0 = buildPlanningManifest(mcpcore);
      const judge = await judgeToolNecessity(objective, manifest0, conversation, context);
      emitRunEvent(runId, { type: 'judge', need: judge.need, reason: judge.reason });
      await HistoryStore.append(runId, { type: 'judge', need: judge.need, reason: judge.reason });
      if (!judge.need) {
        const plan = { manifest: manifest0, steps: [] };
        await HistoryStore.setPlan(runId, plan);
        emitRunEvent(runId, { type: 'plan', plan });
        await HistoryStore.append(runId, { type: 'plan', plan });
        const exec = { used: [], attempted: 0, succeeded: 0, successRate: 1 };
        emitRunEvent(runId, { type: 'done', exec });
        await HistoryStore.append(runId, { type: 'done', exec });
        const summary = '本次任务判定无需调用工具。';
        try { await HistoryStore.setSummary(runId, summary); } catch {}
        emitRunEvent(runId, { type: 'summary', summary });
        await HistoryStore.append(runId, { type: 'summary', summary });
        return;
      }

      // Plan (after judge)
      const plan = await generatePlan(objective, mcpcore, { ...context, runId, judge, judgeReason: judge?.reason }, conversation);
      await HistoryStore.setPlan(runId, plan);
      emitRunEvent(runId, { type: 'plan', plan });
      await HistoryStore.append(runId, { type: 'plan', plan });

      // Execute concurrently (existing executor emits args/tool_result events)
      let exec = await executePlan(runId, objective, mcpcore, plan, { conversation, context });

      // Evaluate
      let evalObj = await evaluateRun(objective, plan, exec, runId, context); // evaluation event emitted inside

      // Retry once if failed
      if (!evalObj.success) {
        const firstFail = Array.isArray(evalObj.failedSteps) && evalObj.failedSteps.length
          ? evalObj.failedSteps.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0]
          : null;
        if (firstFail) {
          const failIndex = Math.max(0, Number(firstFail.index) || 0);
          const history = await HistoryStore.list(runId, 0, -1);
          const prior = history
            .filter((h) => h.type === 'tool_result' && Number(h.result?.success) === 1 && Number(h.stepIndex || 0) < failIndex)
            .map((h) => ({ aiName: h.aiName, args: h.args, result: h.result, data: h.result?.data }));

          emitRunEvent(runId, { type: 'retry_begin', after: failIndex });
          await HistoryStore.append(runId, { type: 'retry_begin', after: failIndex });

          exec = await executePlan(runId, objective, mcpcore, plan, { startIndex: failIndex, seedRecent: prior, conversation, context });
          emitRunEvent(runId, { type: 'retry_done', after: failIndex, exec });
          await HistoryStore.append(runId, { type: 'retry_done', after: failIndex, exec });

          evalObj = await evaluateRun(objective, plan, exec, runId, context);
        }
      }

      // Done + summary
      emitRunEvent(runId, { type: 'done', exec });
      await HistoryStore.append(runId, { type: 'done', exec });
      const summary = await summarizeToolHistory(runId, '', context);
      try { await HistoryStore.setSummary(runId, summary); } catch {}
      emitRunEvent(runId, { type: 'summary', summary });
      await HistoryStore.append(runId, { type: 'summary', summary });
    } catch (e) {
      emitRunEvent(runId, { type: 'done', error: String(e) });
      await HistoryStore.append(runId, { type: 'done', error: String(e) });
    } finally {
      // allow consumer to decide when to break (on 'summary'); no explicit close here
    }
  })();

  try {
    for await (const ev of sub) {
      yield ev;
      if (ev?.type === 'summary') break;
    }
  } finally {
    try { await sub.return?.(); } catch {}
    try { RunEvents.close(runId); } catch {}
  }
}

export default { generatePlan, executePlan, evaluateRun, planThenExecute, planThenExecuteStream };
