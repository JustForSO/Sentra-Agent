/**
 * 预思考阶段：使用推理模型进行深度思考
 */

import logger from '../../logger/index.js';
import { config } from '../../config/index.js';
import { chatCompletion } from '../../openai/client.js';
import { buildToolContextSystem } from '../plan/manifest.js';
import { loadPrompt, renderTemplate } from '../prompts/loader.js';
import { compactMessages, normalizeConversation } from '../utils/messages.js';

/**
 * 预思考阶段
 * 若返回中包含 reasoning_content 则优先使用，否则回退到 content
 */
export async function getPreThought(objective, manifest, conversation) {
  try {
    // 从 prompts 加载 reasoner 提示，并注入工具上下文与目标
    const rp = await loadPrompt('reasoner');
    const toolContext = buildToolContextSystem(manifest);
    const useOmit = Number(config?.reasoner?.maxTokens ?? -1) <= 0;
    const conv = normalizeConversation(conversation);
    const messages = compactMessages([
      { role: 'system', content: renderTemplate(rp.system || '{{toolContext}}', { toolContext }) },
      ...conv,
      { role: 'user', content: renderTemplate(rp.user_goal || '目标: {{objective}}', { objective }) },
    ]);
    const res = await chatCompletion({
      messages,
      omitMaxTokens: useOmit,
      max_tokens: useOmit ? undefined : Number(config.reasoner.maxTokens),
      temperature: Number(config.reasoner.temperature ?? 0.2),
      apiKey: config.reasoner.apiKey,
      baseURL: config.reasoner.baseURL,
      model: config.reasoner.model,
    });
    const msg = res?.choices?.[0]?.message || {};
    const thought = (typeof msg.reasoning_content === 'string' && msg.reasoning_content)
      || (typeof msg.content === 'string' && msg.content)
      || '';
    return thought;
  } catch (e) {
    logger.warn?.('预思考阶段失败（忽略继续）', { label: 'PLAN', error: String(e) });
    return '';
  }
}
