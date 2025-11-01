import OpenAI from 'openai';
import logger from '../../src/logger/index.js';
import { config } from '../../src/config/index.js';

function arrifyCsv(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildSearchSystemPrompt({ include, exclude, maxResults }) {
  const lines = [];
  lines.push(`你是一个实时搜索助手。请基于最新的网页搜索结果，为用户提供准确、简明的答案。`);
  if (include?.length) lines.push(`优先参考以下域名的内容：${include.join(', ')}`);
  if (exclude?.length) lines.push(`不要引用以下域名的内容：${exclude.join(', ')}`);
  if (maxResults) lines.push(`每次查询最多参考 ${maxResults} 条结果。`);
  lines.push('请在回答末尾按 [1], [2], ... 格式列出所有参考链接的完整 URL。');
  return lines.join('\n');
}

function extractTextFromChatCompletion(res) {
  try {
    const content = res?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
  } catch {}
  return '';
}

function extractUrls(text) {
  if (!text) return [];
  const re = /https?:\/\/[^\s)\]]+/gi;
  const set = new Set();
  let m; while ((m = re.exec(text)) !== null) { set.add(m[0]); }
  return Array.from(set);
}

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const q = String(args.query || '').trim();
  const raw = args.rawRequest && typeof args.rawRequest === 'object' ? args.rawRequest : null;
  const model = String(penv.REALTIME_SEARCH_MODEL || process.env.REALTIME_SEARCH_MODEL || 'gpt-4o-search');
  const baseURL = String(penv.REALTIME_SEARCH_BASE_URL || process.env.REALTIME_SEARCH_BASE_URL || config.llm.baseURL || 'https://api.openai.com/v1');
  const apiKey = String(penv.REALTIME_SEARCH_API_KEY || process.env.REALTIME_SEARCH_API_KEY || config.llm.apiKey || '');
  const maxResults = Number(args.max_results || 5);
  const include = arrifyCsv(args.include_domains);
  const exclude = arrifyCsv(args.exclude_domains);

  if (!raw && !q) {
    return { success: false, code: 'INVALID', error: 'query is required (or provide rawRequest)' };
  }

  const client = new OpenAI({ apiKey, baseURL });
  let payload;
  if (raw) {
    // Pass-through but enforce model from env
    payload = { ...raw, model };
  } else {
    // Construct standard chat completions request
    const systemPrompt = buildSearchSystemPrompt({ include, exclude, maxResults });
    payload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: q }
      ],
      temperature: 0.3,
    };
  }

  let res;
  try {
    res = await client.chat.completions.create(payload);
  } catch (e) {
    const msg = String(e?.message || e);
    logger.error('realtime_search: chat.completions.create failed', { label: 'PLUGIN', error: msg });
    return { success: false, code: 'ERR', error: msg };
  }

  const text = extractTextFromChatCompletion(res);
  const urls = extractUrls(text);

  const data = {
    query: q || null,
    model: res?.model || model,
    created: res?.created || null,
    answer_text: text || null,
    citations: urls.map((u, i) => ({ index: i + 1, url: u })),
    completion_id: res?.id || null,
    usage: res?.usage || null,
  };
  return { success: true, data };
}
