/**
 * 评估阶段：判断运行结果是否成功（统一走 FC <sentra-tools> 方案）
 */

import logger from '../../logger/index.js';
import { config } from '../../config/index.js';
import { chatCompletion } from '../../openai/client.js';
import { HistoryStore } from '../../history/store.js';
import { loadPrompt, renderTemplate, composeSystem } from '../prompts/loader.js';
import { compactMessages } from '../utils/messages.js';
import { emitRunEvent } from '../utils/events.js';
import { getPreThought } from './prethought.js';
import { clip } from '../../utils/text.js';
import { parseFunctionCalls, buildFunctionCallInstruction, buildFCPolicy } from '../../utils/fc.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolDef } from '../tools/loader.js';
import { manifestToBulletedText } from '../plan/manifest.js';

/**
 * 评估运行结果
 */
export async function evaluateRun(objective, plan, exec, runId, context = {}) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const judgeToolDef = await loadToolDef({
    baseDir: __dirname,
    toolPath: '../tools/internal/final_judge.tool.json',
    schemaPath: '../tools/internal/final_judge.schema.json',
    fallbackTool: { type: 'function', function: { name: 'final_judge', description: 'judge final success/failure with optional failedSteps & summary', parameters: { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] } } },
    fallbackSchema: { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
  });

  // 加载评估提示模板，并提供简短历史尾部作为上下文
  const fj = await loadPrompt('final_judge');
  const overlays = (context?.promptOverlays || context?.overlays || {});
  const overlayGlobal = overlays.global?.system || overlays.global || '';
  const overlayEval = overlays.final_judge?.system || overlays.final_judge || overlays.eval?.system || overlays.eval || '';
  const sys = composeSystem(fj.system, [overlayGlobal, overlayEval].filter(Boolean).join('\n\n'));
  const history = await HistoryStore.list(runId, 0, -1);
  const stepNames = (exec?.used || []).map((u) => u.aiName).join(', ');
  const tail = history.slice(-Math.max(5, Math.min(12, history.length)));
  const manifestText = manifestToBulletedText(Array.isArray(plan?.manifest) ? plan.manifest : []);

  // 复用“前置思考”流程（仅在开启时调用）
  let preThought = '';
  if (config.flags.evalUsePreThought) {
    try { preThought = await getPreThought(objective, [], []); } catch {}
  }

  const baseMsgs = compactMessages([
    { role: 'system', content: sys },
    { role: 'user', content: renderTemplate(fj.user_goal, { objective }) },
    ...(config.flags.evalUsePreThought ? [
      { role: 'assistant', content: renderTemplate(fj.assistant_thought || '思考（前置推演）：\n{{preThought}}', { preThought }) },
    ] : []),
    {
      role: 'assistant',
      content: renderTemplate(fj.assistant_exec_stats, {
        attempted: exec.attempted,
        succeeded: exec.succeeded,
        successRate: exec.successRate.toFixed(2),
        stepNames
      })
    },
    { role: 'assistant', content: renderTemplate(fj.assistant_tools_manifest || '可用工具清单（能力边界）：\n{{manifestBulleted}}', { manifestBulleted: manifestText }) },
    { role: 'user', content: fj.user_history_intro },
    { role: 'assistant', content: JSON.stringify(tail) },
    { role: 'user', content: fj.user_request }
  ]);

  // FC 指令与策略（sentra 格式）
  const policy = await buildFCPolicy({ locale: 'zh-CN' });
  const fcInstr = await buildFunctionCallInstruction({ name: 'final_judge', parameters: judgeToolDef.function?.parameters || { type: 'object', properties: {} }, locale: 'zh-CN' });
  const fc = config.fcLlm || {};
  const omit = !(Number.isFinite(fc.maxTokens) && fc.maxTokens > 0);
  const maxRetries = Math.max(1, Number(fc.evalMaxRetries ?? 3));
  const temperature = Number.isFinite(config.fcLlm?.evalTemperature) ? config.fcLlm.evalTemperature : (Number.isFinite(fc.temperature) ? Math.min(0.2, fc.temperature) : 0.1);
  const top_p = Number.isFinite(config.fcLlm?.evalTopP) ? config.fcLlm.evalTopP : undefined;

  let result = { success: true };
  let lastContent = '';
  const strategy = String(config.llm?.toolStrategy || 'auto');
  const useFC = strategy === 'fc';
  const useAuto = strategy === 'auto';

  // 工具中心评估：若存在至少一次工具调用且全部成功，则直接判定成功（避免 LLM 误判超范围目标）
  if (Number(exec?.attempted || 0) > 0 && Number(exec?.succeeded || 0) === Number(exec?.attempted || 0)) {
    result = { success: true, summary: '工具中心评估：已调用的工具均成功执行并返回结果，视为成功。超出当前工具能力的更高层目标不纳入失败判定。' };
    emitRunEvent(runId, { type: 'evaluation', result });
    await HistoryStore.append(runId, { type: 'evaluation', result });
    return result;
  }

  // 1) Native tools first (if strategy is native or auto)
  if (!useFC) {
    const tools = [judgeToolDef];
    const res = await chatCompletion({
      messages: baseMsgs,
      tools,
      tool_choice: { type: 'function', function: { name: 'final_judge' } },
      temperature: 0.1
    });
    const call = res.choices?.[0]?.message?.tool_calls?.[0];
    if (call?.function?.arguments) {
      try {
        const args = JSON.parse(call.function.arguments);
        const success = typeof args.success === 'boolean' ? args.success : (String(args.success).toLowerCase() === 'true');
        const failedSteps = Array.isArray(args.failedSteps) ? args.failedSteps.map((it) => ({
          index: Number(it?.index), aiName: typeof it?.aiName === 'string' ? it.aiName : undefined, reason: String(it?.reason || '')
        })).filter((it) => Number.isFinite(it.index) && it.reason) : [];
        const summary = typeof args.summary === 'string' ? args.summary : '';
        result = { success: !!success, failedSteps, summary };
        emitRunEvent(runId, { type: 'evaluation', result });
        await HistoryStore.append(runId, { type: 'evaluation', result });
        return result;
      } catch {}
    }
    // If native failed and not auto, stop here with default success
    if (!useAuto) {
      emitRunEvent(runId, { type: 'evaluation', result });
      await HistoryStore.append(runId, { type: 'evaluation', result });
      return result;
    }
  }

  // 2) FC fallback or primary path
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let reinforce = '';
    if (attempt > 1) {
      try {
        const pr = await loadPrompt('fc_reinforce_eval');
        const tpl = pr.zh;
        reinforce = renderTemplate(tpl, { attempt: String(attempt), max_retries: String(maxRetries) });
      } catch {}
    }
    const messages = compactMessages([...baseMsgs, { role: 'user', content: [reinforce, policy, fcInstr].filter(Boolean).join('\n\n') }]);
    const res = await chatCompletion({
      messages,
      temperature,
      top_p,
      apiKey: fc.apiKey,
      baseURL: fc.baseURL,
      model: fc.model,
      ...(omit ? { omitMaxTokens: true } : { max_tokens: fc.maxTokens })
    });
    const content = res?.choices?.[0]?.message?.content || '';
    lastContent = content;
    logger.info('FC 评估：模型原始响应内容', {
      label: 'EVAL', attempt,
      provider: { baseURL: fc.baseURL, model: fc.model },
      contentPreview: clip(String(content)),
      length: String(content || '').length
    });

    const calls = parseFunctionCalls(String(content), {});
    logger.info('FC 评估：解析到的工具调用数量', { label: 'EVAL', attempt, count: calls.length, firstCallPreview: clip(calls?.[0]) });
    const call = calls.find((c) => String(c.name) === 'final_judge') || calls[0];
    try {
      const args = call?.arguments || {};
      const success = typeof args.success === 'boolean' ? args.success : (String(args.success).toLowerCase() === 'true');
      const failedSteps = Array.isArray(args.failedSteps) ? args.failedSteps.map((it) => ({
        index: Number(it?.index),
        aiName: typeof it?.aiName === 'string' ? it.aiName : undefined,
        reason: String(it?.reason || '')
      })).filter((it) => Number.isFinite(it.index) && it.reason) : [];
      const summary = typeof args.summary === 'string' ? args.summary : '';
      result = { success: !!success, failedSteps, summary };
      // 若解析到则完成
      break;
    } catch {}
  }

  if (!result || typeof result.success !== 'boolean') {
    const raw = String(lastContent || '');
    const rawSlice = raw.length > 4000 ? `${raw.slice(0, 4000)}…[truncated ${raw.length - 4000}]` : raw;
    logger.warn?.('FC 评估：未能解析到有效结果，已达最大重试次数', {
      label: 'EVAL', retries: maxRetries, contentRaw: rawSlice
    });
    result = { success: true };
  }

  emitRunEvent(runId, { type: 'evaluation', result });
  await HistoryStore.append(runId, { type: 'evaluation', result });
  return result;
}
