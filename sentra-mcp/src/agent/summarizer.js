import { config } from '../config/index.js';
import logger from '../logger/index.js';
import { HistoryStore } from '../history/store.js';
import { chatCompletion } from '../openai/client.js';
import { loadPrompt, renderTemplate, composeSystem } from './prompts/loader.js';
import { getPreThought } from './stages/prethought.js';
import { clip } from '../utils/text.js';
import { parseFunctionCalls, buildFunctionCallInstruction, buildFCPolicy } from '../utils/fc.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 最终总结：统一走 FC <sentra-tools> 方案
 */
export async function summarizeToolHistory(runId, objective = '', context = {}) {
  try {
    const history = await HistoryStore.list(runId, 0, -1);
    const fsPrompt = await loadPrompt('final_summary');
    const overlays = (context?.promptOverlays || context?.overlays || {});
    const overlayGlobal = overlays.global?.system || overlays.global || '';
    const overlaySum = overlays.final_summary?.system || overlays.final_summary || overlays.summary?.system || overlays.summary || '';
    const sys = composeSystem(fsPrompt.system, [overlayGlobal, overlaySum].filter(Boolean).join('\n\n'));
    let preThought = '';
    if (config.flags.summaryUsePreThought) {
      preThought = await getPreThought(objective || '总结工具调用与执行结果', [], []);
    }

    const baseMsgs = [
      { role: 'system', content: sys },
      { role: 'user', content: renderTemplate(fsPrompt.user_goal, { objective: objective || '总结工具调用与执行结果' }) },
      ...(config.flags.summaryUsePreThought ? [
        { role: 'assistant', content: renderTemplate(fsPrompt.assistant_thought || '思考（前置推演）：\n{{preThought}}', { preThought }) },
      ] : []),
      { role: 'user', content: fsPrompt.user_history_intro },
      { role: 'assistant', content: JSON.stringify({ runId, history }) },
      { role: 'user', content: fsPrompt.user_request }
    ];

    // 读取 final_summary 的 schema
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const schemaPath = path.resolve(__dirname, './tools/internal/final_summary.schema.json');
    let summarySchema = { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] };
    try {
      const rawSchema = await fs.readFile(schemaPath, 'utf-8');
      summarySchema = JSON.parse(rawSchema);
    } catch {}

    const policy = await buildFCPolicy({ locale: 'zh-CN' });
    const instr = await buildFunctionCallInstruction({ name: 'final_summary', parameters: summarySchema, locale: 'zh-CN' });

    const fc = config.fcLlm || {};
    const omit = !(Number.isFinite(fc.maxTokens) && fc.maxTokens > 0);
    const maxRetries = Math.max(1, Number(fc.summaryMaxRetries ?? 3));
    const temperature = Number.isFinite(config.fcLlm?.summaryTemperature) ? config.fcLlm.summaryTemperature : (Number.isFinite(fc.temperature) ? Math.min(0.3, fc.temperature) : 0.1);
    const top_p = Number.isFinite(config.fcLlm?.summaryTopP) ? config.fcLlm.summaryTopP : undefined;

    let summaryText = '';
    let lastContent = '';
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let reinforce = '';
      if (attempt > 1) {
        try {
          const pr = await loadPrompt('fc_reinforce_summary');
          const tpl = pr.zh;
          reinforce = renderTemplate(tpl, { attempt: String(attempt), max_retries: String(maxRetries) });
        } catch {}
      }
      const messages = [...baseMsgs, { role: 'user', content: [reinforce, policy, instr].filter(Boolean).join('\n\n') }];
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
      logger.info('FC 总结：模型原始响应内容', {
        label: 'SUMMARY', attempt,
        provider: { baseURL: fc.baseURL, model: fc.model },
        contentPreview: clip(String(content)),
        length: String(content || '').length
      });

      const calls = parseFunctionCalls(String(content), {});
      logger.info('FC 总结：解析到的工具调用数量', { label: 'SUMMARY', attempt, count: calls.length, firstCallPreview: clip(calls?.[0]) });
      const call = calls.find((c) => String(c.name) === 'final_summary') || calls[0];
      try {
        const args = call?.arguments || {};
        if (typeof args.summary === 'string' && args.summary.trim()) {
          summaryText = args.summary.trim();
          break;
        }
      } catch {}
    }

    if (!summaryText) {
      const raw = String(lastContent || '');
      const rawSlice = raw.length > 4000 ? `${raw.slice(0, 4000)}…[truncated ${raw.length - 4000}]` : raw;
      logger.warn?.('FC 总结：未能解析到有效结果，已达最大重试次数', { label: 'SUMMARY', contentRaw: rawSlice });
    }

    await HistoryStore.setSummary(runId, summaryText);
    return summaryText;
  } catch (e) {
    logger.error('summarizeToolHistory failed', { runId, error: String(e) });
    return null;
  }
}

export default { summarizeToolHistory };
