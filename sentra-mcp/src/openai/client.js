import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../logger/index.js';

let client;

export function getOpenAI() {
  if (!client) {
    client = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseURL,
    });
  }
  return client;
}

export async function chatCompletion({ messages, tools, tool_choice, temperature, top_p, max_tokens, apiKey, baseURL, model, omitMaxTokens }) {
  // Allow per-call overrides of API credentials and base URL
  const openai = (apiKey || baseURL)
    ? new OpenAI({ apiKey: apiKey || config.llm.apiKey, baseURL: baseURL || config.llm.baseURL })
    : getOpenAI();
  const payload = {
    model: model || config.llm.model,
    messages,
    temperature: temperature ?? config.llm.temperature,
  };
  if (typeof top_p === 'number') {
    const tp = Number(top_p);
    if (Number.isFinite(tp) && tp > 0 && tp <= 1) payload.top_p = tp;
  }
  // Decide whether to include max_tokens
  if (!omitMaxTokens) {
    const cfgMax = Number(config.llm.maxTokens);
    if (typeof max_tokens !== 'undefined') {
      const mt = Number(max_tokens);
      if (Number.isFinite(mt) && mt > 0) payload.max_tokens = mt; // positive value only
      // if -1 or <=0: omit
    } else if (Number.isFinite(cfgMax) && cfgMax > 0) {
      payload.max_tokens = cfgMax; // use env-configured positive limit
    }
  }
  if (tools) payload.tools = tools;
  if (tool_choice) payload.tool_choice = tool_choice;

  logger.debug?.('openai.chat.completions.create', { hasTools: !!tools, tool_choice: payload.tool_choice });

  const res = await openai.chat.completions.create(payload);
  return res;
}

// 中文：简单封装 Embeddings 接口，返回每个输入文本的向量数组
export async function embedTexts({ texts = [], apiKey, baseURL, model }) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const openai = (apiKey || baseURL)
    ? new OpenAI({ apiKey: apiKey || config.embedding.apiKey || config.llm.apiKey, baseURL: baseURL || config.embedding.baseURL || config.llm.baseURL })
    : getOpenAI();
  const mdl = model || config.embedding.model || 'text-embedding-3-small';
  const res = await openai.embeddings.create({ model: mdl, input: texts });
  return (res?.data || []).map((d) => Array.isArray(d.embedding) ? d.embedding : []);
}

export function buildToolSchemaFromLocal(tools) {
  // Convert our unified tool metadata to OpenAI tools schema
  // Each tool: { name, description, inputSchema }
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

export default { getOpenAI, chatCompletion, buildToolSchemaFromLocal, embedTexts };
