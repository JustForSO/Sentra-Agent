import logger from '../../logger/index.js';
import { config } from '../../config/index.js';
import { chatCompletion } from '../../openai/client.js';
import { buildPlanningManifest, manifestToBulletedText } from './manifest.js';
import { getPreThought } from '../stages/prethought.js';
import { upsertPlanMemory, searchPlanMemories } from '../../memory/index.js';
import { loadPrompt, renderTemplate, composeSystem } from '../prompts/loader.js';
import { compactMessages } from '../utils/messages.js';
import { clip } from '../../utils/text.js';
import { buildPlanFunctionCallInstruction, parseFunctionCalls, buildFCPolicy, buildFunctionCallInstruction } from '../../utils/fc.js';
import { HistoryStore } from '../../history/store.js';
import { rerankManifest } from './router.js';

function now() { return Date.now(); }

// no bootstrap fallback; rely on retries

async function generateSinglePlan({
  baseMessages,
  allowedAiNames,
  fc,
  planningTemp,
  top_p,
  maxRetries,
  policyText,
  planInstrText,
}) {
  const validNames = new Set(allowedAiNames || []);
  let steps = [];
  let lastContent = '';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let reinforce = '';
    if (attempt > 1) {
      try {
        const pfRe = await loadPrompt('fc_reinforce_plan');
        const tplRe = pfRe.zh;
        reinforce = renderTemplate(tplRe, {
          allowed_list: (allowedAiNames || []).join(', ') || '(无)',
          attempt: String(attempt),
          max_retries: String(maxRetries)
        });
      } catch {}
    }
    const attemptMessages = attempt === 1
      ? baseMessages
      : compactMessages([
          ...baseMessages,
          { role: 'user', content: reinforce },
          { role: 'user', content: [policyText, planInstrText].join('\n\n') },
        ]);

    const resp = await chatCompletion({
      messages: attemptMessages,
      temperature: planningTemp,
      top_p,
      apiKey: fc.apiKey,
      baseURL: fc.baseURL,
      model: fc.model,
      ...(Number.isFinite(fc.maxTokens) && fc.maxTokens > 0 ? { max_tokens: fc.maxTokens } : { omitMaxTokens: true })
    });
    const content = resp?.choices?.[0]?.message?.content || '';
    lastContent = content;
    const calls = parseFunctionCalls(String(content), {});
    const call = calls.find((c) => String(c.name) === 'emit_plan') || calls[0];
    let candidate = [];
    try {
      const parsed = call?.arguments || {};
      const arr = Array.isArray(parsed?.plan?.steps) ? parsed.plan.steps : [];
      candidate = arr.map((s) => ({
        aiName: s?.aiName,
        reason: s?.reason || '',
        nextStep: s?.nextStep || '',
        draftArgs: s?.draftArgs || {},
        dependsOn: Array.isArray(s?.dependsOn) ? s.dependsOn : undefined
      }));
    } catch {}

    const filtered = validNames.size ? candidate.filter((s) => s.aiName && validNames.has(s.aiName)) : candidate;
    if (filtered.length > 0 || (allowedAiNames || []).length === 0) {
      steps = filtered;
      break;
    }
  }
  return { steps, raw: lastContent };
}

async function selectBestPlan({ objective, manifest, candidates, context }) {
  try {
    const pa = await loadPrompt('plan_audit');
    const overlays = (context?.promptOverlays || context?.overlays || {});
    const overlayGlobal = overlays.global?.system || overlays.global || '';
    const overlayAudit = overlays.audit?.system || overlays.plan_audit?.system || overlays.audit || overlays.plan_audit || '';
    const sys = composeSystem(pa.system, [overlayGlobal, overlayAudit].filter(Boolean).join('\n\n'));
    const manifestText = manifestToBulletedText(Array.isArray(manifest) ? manifest : []);
    const candidatesList = candidates.map((c, i) => `#${i}: ${clip(c.steps, 1200)}`).join('\n');
    const base = compactMessages([
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
    // 构造 select_plan 函数调用指令（FC sentra-tools）
    const selectPlanSchema = {
      type: 'object',
      properties: {
        best: { type: 'integer', minimum: 0 },
        reason: { type: 'string' },
        scores: {
          type: 'object',
          properties: {
            executability: { type: 'number', minimum: 0, maximum: 1 },
            robustness: { type: 'number', minimum: 0, maximum: 1 },
            goal_fit: { type: 'number', minimum: 0, maximum: 1 },
            minimality: { type: 'number', minimum: 0, maximum: 1 },
            dependency_clarity: { type: 'number', minimum: 0, maximum: 1 },
            efficiency: { type: 'number', minimum: 0, maximum: 1 }
          },
          additionalProperties: true
        },
        notes: { type: 'string' }
      },
      required: ['best'],
      additionalProperties: true
    };
    const policyText = await buildFCPolicy({ locale: 'zh-CN' });
    const instr = await buildFunctionCallInstruction({ name: 'select_plan', parameters: selectPlanSchema, locale: 'zh-CN' });
    const messages = compactMessages([...base, { role: 'user', content: [policyText, instr].join('\n\n') }]);

    const fc = config.fcLlm || {};
    const omit = !(Number.isFinite(fc.maxTokens) && fc.maxTokens > 0);
    const resp = await chatCompletion({
      messages,
      temperature: Number.isFinite(fc.planTemperature) ? fc.planTemperature : Math.max(0.1, ((Number.isFinite(fc.temperature) ? fc.temperature : (config.llm.temperature ?? 0.2)) - 0.1)),
      apiKey: fc.apiKey,
      baseURL: fc.baseURL,
      model: fc.model,
      ...(omit ? { omitMaxTokens: true } : { max_tokens: fc.maxTokens })
    });
    const content = resp?.choices?.[0]?.message?.content || '';
    const calls = parseFunctionCalls(String(content), {});
    const call = calls.find((c) => String(c.name) === 'select_plan') || calls[0];
    let idx = 0; let reason = '';
    try {
      const parsed = call?.arguments || {};
      idx = Number(parsed?.best);
      reason = String(parsed?.reason || '');
    } catch {}
    if (!Number.isFinite(idx)) idx = 0;
    idx = Math.max(0, Math.min(candidates.length - 1, idx));
    return { index: idx, audit: reason };
  } catch (e) {
    logger.warn?.('FC 多计划审核失败，回退到候选#0', { label: 'PLAN', error: String(e) });
    return { index: 0, audit: '' };
  }
}

export async function generatePlanViaFC(objective, mcpcore, context = {}, conversation) {
  let manifest = buildPlanningManifest(mcpcore);
  const usePT = !!config.flags?.planUsePreThought;
  const preThought = usePT ? (await getPreThought(objective, manifest, conversation)) : '';
  // 中文：在 FC 规划前执行工具重排序（优先使用 judgeReason；为空则使用 objective）
  try {
    const judgeReason = String(context?.judge?.reason || context?.judgeReason || '').trim();
    if ((judgeReason || objective) && (config.rerank?.enable !== false)) {
      const ranked = await rerankManifest({ manifest, judgeReason, objective, candidateK: config.rerank?.candidateK, topN: config.rerank?.topN });
      if (Array.isArray(ranked?.manifest) && ranked.manifest.length) {
        manifest = ranked.manifest;
        if (config.flags.enableVerboseSteps) {
          const tops = manifest.slice(0, Math.min(5, manifest.length)).map(x => x.aiName);
          logger.info('FC 规划前重排序Top工具', { label: 'RERANK', top: tops });
        }
      }
    }
  } catch (e) {
    logger.warn?.('FC 规划前重排序失败（忽略并继续）', { label: 'RERANK', error: String(e) });
  }
  const allowedAiNames = (manifest || []).map((m) => m.aiName).filter(Boolean);
  if (config.flags.enableVerboseSteps) {
    logger.info('FC 规划：允许工具数量', { label: 'PLAN', allowedCount: allowedAiNames.length });
  }

  // 历史规划参考
  let planMemoryMsgs = [];
  if (config.memory?.enable) {
    try {
      const mems = await searchPlanMemories({ objective });
      if (Array.isArray(mems) && mems.length) {
        const lines = mems.map((m, idx) => `#${idx + 1} (score=${m.score.toFixed(2)}):\n${m.text}`).join('\n\n');
        planMemoryMsgs.push({ role: 'assistant', content: `历史规划参考:\n${lines}` });
        if (config.flags.enableVerboseSteps) {
          logger.info('检索到历史规划参考', { label: 'MEM', hits: mems.length, topScore: Number(mems[0]?.score?.toFixed?.(2) || 0), minScore: config.memory.minScore });
        }
      }
    } catch {}
  }

  const ep = await loadPrompt('emit_plan');
  const overlays = (context?.promptOverlays || context?.overlays || {});
  const overlayGlobal = overlays.global?.system || overlays.global || '';
  const overlayPlan = overlays.plan?.system || overlays.emit_plan?.system || overlays.plan || overlays.emit_plan || '';
  const sys = composeSystem(ep.system, [overlayGlobal, overlayPlan].filter(Boolean).join('\n\n'));
  const policyText = await buildFCPolicy({ locale: 'zh-CN' });
  const planInstrText = await buildPlanFunctionCallInstruction({ allowedAiNames, locale: 'zh-CN' });
  const messages = compactMessages([
    { role: 'system', content: sys },
    ...(Array.isArray(conversation) ? conversation : []),
    { role: 'user', content: renderTemplate(ep.user_goal, { objective }) },
    ...(usePT ? [{ role: 'assistant', content: renderTemplate(ep.assistant_thought, { preThought: preThought || '' }) }] : []),
    { role: 'assistant', content: renderTemplate(ep.assistant_manifest, { manifestBulleted: manifestToBulletedText(manifest) }) },
    ...planMemoryMsgs,
    { role: 'user', content: ep.user_request },
    { role: 'user', content: [policyText, planInstrText].join('\n\n') },
  ]);

  const fc = config.fcLlm || {};
  const planningTemp = Number.isFinite(config.fcLlm?.planTemperature)
    ? config.fcLlm.planTemperature
    : Math.max(0.1, ((Number.isFinite(fc.temperature) ? fc.temperature : (config.llm.temperature ?? 0.2)) - 0.1));
  const omit = !(Number.isFinite(fc.maxTokens) && fc.maxTokens > 0);
  const maxRetries = Math.max(1, Number(fc.planMaxRetries ?? 3));
  const top_p = Number.isFinite(config.fcLlm?.planTopP) ? config.fcLlm.planTopP : undefined;

  let steps = [];
  let lastContent = '';
  const enableMulti = !!config.planner?.multiEnable && Number(config.planner?.multiCandidates || 0) > 1;
  if (enableMulti) {
    // 多计划生成：并行生成 K 份候选
    const K = Math.max(2, Math.min(5, Number(config.planner.multiCandidates || 3)));
    const tasks = [];
    for (let i = 0; i < K; i++) {
      const diversifyHint = `多方案生成：这是变体 #${i + 1}。请提供与其它变体差异明显且可执行的计划，步骤不超过 ${Math.max(1, Number(config.planner?.maxSteps || 8))} 步。`;
      const msg = compactMessages([
        ...messages,
        { role: 'user', content: diversifyHint },
      ]);
      tasks.push(generateSinglePlan({
        baseMessages: msg,
        allowedAiNames,
        fc,
        planningTemp: planningTemp + Math.min(0.3, 0.03 * i),
        top_p,
        maxRetries,
        policyText,
        planInstrText,
      }));
    }
    const cand = await Promise.all(tasks);
    const candidates = cand
      .map((c) => ({ steps: Array.isArray(c.steps) ? c.steps : [], raw: c.raw || '' }))
      .filter((c) => c.steps.length > 0);
    if (config.flags.enableVerboseSteps) {
      logger.info('FC 多计划：生成候选数量', { label: 'PLAN', count: candidates.length });
    }
    if (candidates.length === 0) {
      // 回退到单计划路径
      const one = await generateSinglePlan({ baseMessages: messages, allowedAiNames, fc, planningTemp, top_p, maxRetries, policyText, planInstrText });
      steps = Array.isArray(one.steps) ? one.steps : [];
      lastContent = one.raw || '';
    } else if (candidates.length === 1) {
      steps = candidates[0].steps;
      lastContent = candidates[0].raw;
    } else {
      const pick = await selectBestPlan({ objective, manifest, candidates, context });
      const best = candidates[Math.max(0, Math.min(candidates.length - 1, Number(pick.index) || 0))];
      if (config.flags.enableVerboseSteps) {
        logger.info('FC 多计划：选择候选', { label: 'PLAN', index: pick.index, audit: clip(String(pick.audit || ''), 360) });
      }
      steps = best.steps;
      lastContent = best.raw;
      try {
        if (context?.runId) {
          await HistoryStore.append(context.runId, { type: 'plan_audit', mode: 'fc', candidates: candidates.length, chosenIndex: Number(pick.index) || 0, reason: String(pick.audit || '') });
        }
      } catch {}
    }
  } else {
    // 单计划路径（保持原有行为）
    const one = await generateSinglePlan({ baseMessages: messages, allowedAiNames, fc, planningTemp, top_p, maxRetries, policyText, planInstrText });
    steps = Array.isArray(one.steps) ? one.steps : [];
    lastContent = one.raw || '';
  }

  if (steps.length === 0) {
    const raw = String(lastContent || '');
    const rawSlice = raw.length > 4000 ? `${raw.slice(0, 4000)}…[truncated ${raw.length - 4000}]` : raw;
    logger.warn?.('规划生成(FC)为空，已达到最大重试次数', {
      label: 'PLAN',
      retries: maxRetries,
      allowedCount: allowedAiNames.length,
      provider: { baseURL: fc.baseURL, model: fc.model },
      contentRaw: rawSlice,
    });
  }
  if (config.flags.enableVerboseSteps) {
    logger.info(`规划生成(FC): 共 ${steps.length} 步`, { label: 'PLAN', stepsPreview: clip(steps) });
  }

  // 记忆
  if (config.memory?.enable) {
    try { await upsertPlanMemory({ runId: context?.runId || 'unknown', objective, plan: { steps } }); } catch {}
  }

  return { manifest, steps };
}

export default { generatePlanViaFC };
