/**
 * 判断阶段：判断是否需要调用工具
 */

import { config } from '../../config/index.js';
import { chatCompletion } from '../../openai/client.js';
import { manifestToBulletedText } from '../plan/manifest.js';
import { loadPrompt, renderTemplate, composeSystem } from '../prompts/loader.js';
import { compactMessages, normalizeConversation } from '../utils/messages.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolDef } from '../tools/loader.js';
import logger from '../../logger/index.js';

/**
 * 前置判定：是否需要调用工具
 */
export async function judgeToolNecessity(objective, manifest, conversation, context = {}) {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const toolDef = await loadToolDef({
      baseDir: __dirname,
      toolPath: '../tools/internal/emit_decision.tool.json',
      schemaPath: '../tools/internal/emit_decision.schema.json',
      fallbackTool: { type: 'function', function: { name: 'emit_decision', description: '判断是否需要调用外部工具来完成目标。仅通过函数调用返回 JSON。', parameters: { type: 'object', properties: { need_tools: { type: 'boolean' }, reason: { type: 'string' } }, required: ['need_tools'], additionalProperties: true } } },
      fallbackSchema: { type: 'object', properties: { need_tools: { type: 'boolean' }, reason: { type: 'string' } }, required: ['need_tools'], additionalProperties: true },
    });
    const tools = [toolDef];

    const jp = await loadPrompt('judge');
    const overlays = (context?.promptOverlays || context?.overlays || {});
    const overlayGlobal = overlays.global?.system || overlays.global || '';
    const overlayJud = overlays.judge?.system || overlays.judge || '';
    const baseSystem = composeSystem(jp.system, [overlayGlobal, overlayJud].filter(Boolean).join('\n\n'));
    const manifestBullet = manifestToBulletedText(manifest);
    // 中文：严格约束 reason 的格式，确保首次就包含英文分号，避免后续重试
    const reasonFormat = '【输出reason格式要求】先用1-2句中文总结需求与关键信息（不要过长）；然后列出需要调用的每个操作项，必须使用英文分号 ; 分隔，并且至少出现一次 ;，禁止使用中文分号（；）或逗号（，/、）等其它分隔符。例如：抓取网页; 解析表格; 生成CSV。请保持每个操作项短小、动作式、无多余标点。';
    const systemContent = [
      baseSystem,
      jp.manifest_intro,
      manifestBullet,
      reasonFormat,
    ].join('\n');

    const conv = normalizeConversation(conversation);
    const msgs = compactMessages([
      { role: 'system', content: systemContent },
      ...conv,
      { role: 'user', content: renderTemplate(jp.user_goal, { objective }) },
    ]);

    const useOmit = Number(config?.judge?.maxTokens ?? -1) <= 0;
    const res = await chatCompletion({
      messages: msgs,
      tools,
      tool_choice: { type: 'function', function: { name: 'emit_decision' } },
      omitMaxTokens: useOmit,
      max_tokens: useOmit ? undefined : Number(config.judge.maxTokens),
      temperature: Number(config.judge.temperature ?? 0.1),
      apiKey: config.judge.apiKey,
      baseURL: config.judge.baseURL,
      model: config.judge.model,
    });

    const call = res?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed;
    try {
      parsed = call?.function?.arguments ? JSON.parse(call.function.arguments) : { need_tools: true };
    } catch {
      parsed = { need_tools: true };
    }

    let need = !!parsed.need_tools;
    let reason = String(parsed.reason || '').trim();

    // 若需要工具但 reason 未包含英文分号；触发一次严格重试，强制生成以 ';' 分隔的动作项
    if (need && (!reason || reason.indexOf(';') === -1)) {
      try {
        logger.info?.('Judge严格重试：reason缺少分号，强制要求以分号分隔动作项', { label: 'JUDGE' });
        const strictOverlay = '【格式强制】你的上一次 reason 未包含英文分号 ;。现在只输出 reason 字段的内容，必须用英文分号 ; 分隔每个动作项，禁止使用中文分号或逗号，也不要输出任何额外解释。每个动作项保持尽量短小（2-6个字），动词短语。';
        const strictSystem = composeSystem(jp.system, [overlayGlobal, overlayJud, strictOverlay].filter(Boolean).join('\n\n'));
        const strictMsgs = compactMessages([
          { role: 'system', content: [strictSystem, jp.manifest_intro, manifestBullet].join('\n') },
          ...conv,
          { role: 'user', content: renderTemplate(jp.user_goal, { objective }) },
          { role: 'user', content: `上一次的reason: ${reason}\n请按要求只输出以英文分号 ; 分隔的 reason。` },
        ]);
        const res2 = await chatCompletion({
          messages: strictMsgs,
          tools,
          tool_choice: { type: 'function', function: { name: 'emit_decision' } },
          omitMaxTokens: useOmit,
          max_tokens: useOmit ? undefined : Number(config.judge.maxTokens),
          temperature: Number(config.judge.temperature ?? 0.1),
          apiKey: config.judge.apiKey,
          baseURL: config.judge.baseURL,
          model: config.judge.model,
        });
        const call2 = res2?.choices?.[0]?.message?.tool_calls?.[0];
        let parsed2 = {};
        try { parsed2 = call2?.function?.arguments ? JSON.parse(call2.function.arguments) : {}; } catch {}
        const r2 = String(parsed2?.reason || '').trim();
        if (r2 && r2.indexOf(';') !== -1) reason = r2;
      } catch {}
    }

    return { need, reason };
  } catch (e) {
    return { need: true, reason: 'Judge阶段异常，默认需要工具' };
  }
}
