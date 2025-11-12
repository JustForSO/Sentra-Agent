import { createLogger } from './logger.js';
import { Agent } from '../agent.js';

const logger = createLogger('FormatRepair');

/**
 * 使用工具调用将模型输出修复为合规的 <sentra-response> XML
 * - 分段 text 为必须（1-5 段，每段 1-3 句）
 * - resources 可选（仅当原始文本中包含可解析的 URL/路径时）
 * - 不改变原始语义，不添加凭空内容
 * - 不输出任何只读系统标签（sentra-user-question/sentra-result 等）
 *
 * @param {string} rawText - API 原始文本（不合规的输出，但有人类可读内容）
 * @param {{ agent?: Agent, model?: string, temperature?: number }} opts
 * @returns {Promise<string>} 合规 XML 字符串
 */
export async function repairSentraResponse(rawText, opts = {}) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('repairSentraResponse: rawText 为空或非字符串');
  }

  const agent = opts.agent || new Agent({
    apiKey: process.env.API_KEY,
    apiBaseUrl: process.env.API_BASE_URL,
    defaultModel: process.env.REPAIR_AI_MODEL || process.env.MAIN_AI_MODEL,
    temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.MAX_TOKENS || '4096'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    timeout: parseInt(process.env.TIMEOUT || '60000')
  });

  const model = opts.model || process.env.REPAIR_AI_MODEL || process.env.MAIN_AI_MODEL;
  const temperature = opts.temperature ?? 0.2;

  const systemPrompt = [
    '# Sentra XML Format Repair Assistant',
    '',
    'You fix an unformatted or wrongly formatted assistant output into Sentra XML format using a tool call.',
    '',
    'STRICT rules:',
    '- Output MUST be convertible to <sentra-response> with segmented <text1>, <text2>, ...',
    '- Segment texts: 1-5 segments, each 1-3 sentences, natural conversational tone.',
    '- Do NOT change meaning, tone, or language of the raw text.',
    '- Do NOT invent facts or resources. Only extract resources that are explicitly present as URLs or file paths.',
    '- Resources schema: type=image|video|audio|file|link, source=absolute path or URL, caption=one sentence.',
    '- NEVER output or mention read-only system tags (sentra-user-question, sentra-result, sentra-pending-messages, sentra-emo).',
    '- NO XML escaping inside text tags.',
    '',
    'You MUST call the function tool to return structured fields. Do NOT output plain text.'
  ].join('\n');

  const userPrompt = [
    'Repair the following assistant output into structured fields. Keep meaning intact. If no resources are detectable, return an empty resources array.',
    '',
    '<raw>',
    rawText,
    '</raw>'
  ].join('\n');

  const tools = [
    {
      type: 'function',
      function: {
        name: 'return_structured_sentra_response',
        description: 'Return structured fields for a Sentra XML response. Do not invent content.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            texts: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              description: 'Text segments, each 1-3 sentences, natural and friendly.',
              items: { type: 'string' }
            },
            resources: {
              type: 'array',
              description: 'Optional resources extracted from the raw text (URLs/paths only).',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  type: { type: 'string', enum: ['image', 'video', 'audio', 'file', 'link'] },
                  source: { type: 'string' },
                  caption: { type: 'string' }
                },
                required: ['type', 'source']
              }
            }
          },
          required: ['texts']
        }
      }
    }
  ];

  const tool_choice = { type: 'function', function: { name: 'return_structured_sentra_response' } };

  let result;
  try {
    result = await agent.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], {
      model,
      temperature,
      tools,
      tool_choice
    });
  } catch (e) {
    logger.error('调用修复模型失败', e);
    throw e;
  }

  // 当使用 tools 时，agent.chat 会返回解析后的 JSON 对象
  if (!result || typeof result !== 'object' || !Array.isArray(result.texts)) {
    throw new Error('修复工具返回无效结果');
  }

  const texts = Array.isArray(result.texts) ? result.texts : [];
  const resources = Array.isArray(result.resources) ? result.resources : [];

  // 组装为 <sentra-response>
  const xmlParts = [];
  xmlParts.push('<sentra-response>');

  const maxTexts = Math.min(5, Math.max(1, texts.length));
  for (let i = 0; i < maxTexts; i++) {
    const seg = String(texts[i] ?? '').trim();
    if (!seg) continue;
    xmlParts.push(`  <text${i + 1}>${seg}</text${i + 1}>`);
  }

  if (resources.length === 0) {
    xmlParts.push('  <resources></resources>');
  } else {
    xmlParts.push('  <resources>');
    for (const r of resources) {
      // 仅当字段完整时添加
      if (!r || !r.type || !r.source) continue;
      const caption = r.caption ? String(r.caption) : '';
      xmlParts.push('    <resource>');
      xmlParts.push(`      <type>${r.type}</type>`);
      xmlParts.push(`      <source>${r.source}</source>`);
      if (caption) xmlParts.push(`      <caption>${caption}</caption>`);
      xmlParts.push('    </resource>');
    }
    xmlParts.push('  </resources>');
  }

  xmlParts.push('</sentra-response>');

  const fixed = xmlParts.join('\n');
  logger.success('格式修复完成');
  return fixed;
}

/**
 * 简单判断是否需要修复：有文本但不包含 <sentra-response>
 * @param {string} text
 */
export function shouldRepair(text) {
  if (!text || typeof text !== 'string') return false;
  if (!text.trim()) return false;
  return !text.includes('<sentra-response>');
}
