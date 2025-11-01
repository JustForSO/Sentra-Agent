import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../src/logger/index.js';
import { config } from '../../src/config/index.js';
import OpenAI from 'openai';
import mime from 'mime-types';

function isHttpUrl(s) {
  try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

async function readImageAsBase64WithMime(src, convertGif = false) {
  let buf; let type = '';
  if (isHttpUrl(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`fetch image failed: ${res.status}`);
    const ab = await res.arrayBuffer();
    buf = Buffer.from(ab);
    const ct = (res.headers?.get?.('content-type') || '').split(';')[0].trim();
    if (ct && ct.startsWith('image/')) type = ct;
    if (!type) {
      try { const u = new URL(String(src)); type = mime.lookup(u.pathname) || ''; } catch {}
    }
  } else {
    // treat as local absolute path
    const p = path.resolve(src);
    if (!path.isAbsolute(p)) {
      throw new Error('local image path must be absolute');
    }
    buf = await fs.readFile(p);
    type = String(mime.lookup(p) || '');
  }
  if (!type || !type.startsWith('image/')) {
    // fallback to a common image type, but we do NOT expose base64 outwards
    type = 'image/png';
  }
  
  // GIF优化：某些视觉模型不支持 image/gif，可配置是否转换为 image/jpeg
  // 注意：这里只是改变 MIME 类型标识，实际内容仍是原始格式
  // 大多数视觉模型会根据实际内容自动识别，而不是严格依赖 MIME 类型
  if (convertGif && (type === 'image/gif' || src.toLowerCase().endsWith('.gif'))) {
    type = 'image/jpeg';
  }
  
  const dataUri = `data:${type};base64,${buf.toString('base64')}`;
  return { uri: dataUri, mime: type, size: buf.length };
}

export default async function handler(args = {}, options = {}) {
  const images = Array.isArray(args.images) ? args.images : [];
  const prompt = String(args.prompt || '').trim();
  if (!images.length) return { success: false, code: 'INVALID', error: 'images is required (array of urls or absolute paths)' };
  if (!prompt) return { success: false, code: 'INVALID', error: 'prompt is required' };

  // plugin-level env
  const penv = options?.pluginEnv || {};
  const apiKey = penv.VISION_API_KEY || process.env.VISION_API_KEY || config.llm.apiKey;
  const baseURL = penv.VISION_BASE_URL || process.env.VISION_BASE_URL || config.llm.baseURL;
  const model = penv.VISION_MODEL || process.env.VISION_MODEL || config.llm.model;
  const convertGif = String(penv.VISION_CONVERT_GIF || process.env.VISION_CONVERT_GIF || 'false').toLowerCase() === 'true';

  const oai = new OpenAI({ apiKey, baseURL });

  logger.info?.('image_vision_read:config', { label: 'PLUGIN', baseURL, model, imageCount: images.length, convertGif });

  // prepare vision messages: a single user message with mixed text+images
  const items = [];
  if (prompt) items.push({ type: 'text', text: prompt });
  // read all images and build data URIs with detected MIME in parallel
  let prepared;
  try {
    prepared = await Promise.all(images.map((src) => readImageAsBase64WithMime(src, convertGif)));
  } catch (e) {
    logger.warn?.('image_vision_read:load_image_failed', { label: 'PLUGIN', error: String(e?.message || e) });
    return { success: false, code: 'IMAGE_READ_ERR', error: String(e?.message || e) };
  }
  for (const it of prepared) items.push({ type: 'image_url', image_url: { url: it.uri } });

  const messages = [
    { role: 'user', content: items }
  ];

  try {
    logger.info?.('image_vision_read:calling_api', { label: 'PLUGIN', model });
    const res = await oai.chat.completions.create({ model, messages });
    const content = res?.choices?.[0]?.message?.content || '';
    logger.info?.('image_vision_read:api_success', { label: 'PLUGIN', responseLength: content?.length || 0 });
    // 仅返回所需字段：prompt、图片描述与摘要统计
    const formats = Array.from(new Set((prepared || []).map((x) => x.mime))).filter(Boolean);
    return { success: true, data: { prompt, description: content, image_count: images.length, formats } };
  } catch (e) {
    logger.warn?.('image_vision_read:request_failed', { label: 'PLUGIN', error: String(e?.message || e), stack: e?.stack });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
