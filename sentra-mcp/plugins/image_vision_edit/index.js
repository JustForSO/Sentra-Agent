import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../src/logger/index.js';
import { config } from '../../src/config/index.js';
import OpenAI from 'openai';
import mime from 'mime-types';

function isHttpUrl(s) {
  try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

async function readImageAsBase64WithMime(src) {
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
    const p = path.resolve(src);
    if (!path.isAbsolute(p)) {
      throw new Error('local image path must be absolute');
    }
    buf = await fs.readFile(p);
    type = String(mime.lookup(p) || '');
  }
  if (!type || !type.startsWith('image/')) type = 'image/png';
  const dataUri = `data:${type};base64,${buf.toString('base64')}`;
  return { uri: dataUri, mime: type, size: buf.length };
}

function isEnglishPrompt(s) {
  const text = String(s || '');
  // reject if contains obvious CJK characters
  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)) return false;
  // require majority ASCII letters/punctuations
  const ascii = (text.match(/[\x00-\x7F]/g) || []).length;
  return ascii >= Math.ceil(text.length * 0.8);
}

function hasMarkdownImage(s) {
  return /!\[[^\]]*\]\([^)]+\)/i.test(String(s || ''));
}

async function downloadImagesAndRewrite(md) {
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const urls = new Set();
  let m;
  while ((m = re.exec(md)) !== null) {
    const url = String(m[2] || '').trim();
    if (isHttpUrl(url)) urls.add(url);
  }
  if (urls.size === 0) return md;
  const baseDir = 'artifacts';
  await fs.mkdir(baseDir, { recursive: true });

  const map = new Map();
  let idx = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      let ct = (res.headers?.get?.('content-type') || '').split(';')[0].trim();
      if (!ct) {
        try { const u = new URL(url); ct = String(mime.lookup(u.pathname) || ''); } catch {}
      }
      let ext = '';
      if (ct && ct.startsWith('image/')) {
        const e = mime.extension(ct);
        if (e) ext = `.${e}`;
      }
      if (!ext) {
        try { const u = new URL(url); ext = path.extname(u.pathname) || '.png'; } catch { ext = '.png'; }
      }
      const name = `edit_${Date.now()}_${idx++}${ext}`;
      const abs = path.resolve(baseDir, name);
      await fs.writeFile(abs, buf);
      // 最终反馈要求绝对路径（Markdown中使用正斜杠以避免转义问题）
      const absMd = String(abs).replace(/\\/g, '/');
      map.set(url, absMd);
    } catch {
      // ignore this url; keep original link
    }
  }
  return md.replace(re, (full, alt, url) => {
    const key = String(url || '').trim();
    if (map.has(key)) return `![${alt}](${map.get(key)})`;
    return full;
  });
}

export default async function handler(args = {}, options = {}) {
  const images = Array.isArray(args.images) ? args.images : [];
  const prompt = String(args.prompt || '').trim();
  if (!images.length) return { success: false, code: 'INVALID', error: 'images is required (array of urls or absolute paths)' };
  if (!prompt) return { success: false, code: 'INVALID', error: 'prompt is required' };
  if (!isEnglishPrompt(prompt)) return { success: false, code: 'PROMPT_NOT_ENGLISH', error: 'prompt must be English only' };

  const penv = options?.pluginEnv || {};
  const apiKey = penv.VISION_API_KEY || process.env.VISION_API_KEY || config.llm.apiKey;
  const baseURL = penv.VISION_BASE_URL || process.env.VISION_BASE_URL || config.llm.baseURL;
  const model = penv.VISION_MODEL || process.env.VISION_MODEL || config.llm.model;

  const oai = new OpenAI({ apiKey, baseURL });

  // prepare messages
  const items = [];
  if (prompt) items.push({ type: 'text', text: prompt });
  let prepared;
  try {
    prepared = await Promise.all(images.map((src) => readImageAsBase64WithMime(src)));
  } catch (e) {
    logger.warn?.('image_vision_edit:load_image_failed', { label: 'PLUGIN', error: String(e?.message || e) });
    return { success: false, code: 'IMAGE_READ_ERR', error: String(e?.message || e) };
  }
  for (const it of prepared) items.push({ type: 'image_url', image_url: { url: it.uri } });

  const messages = [
    { role: 'user', content: items }
  ];

  try {
    const res = await oai.chat.completions.create({ model, messages });
    const content = res?.choices?.[0]?.message?.content || '';
    const ok = hasMarkdownImage(content);
    if (ok) {
      const rewritten = await downloadImagesAndRewrite(content);
      return { success: true, data: { prompt, content: rewritten } };
    }
    return { success: false, code: 'NO_MD_IMAGE', error: 'response has no markdown image', data: { prompt, content } };
  } catch (e) {
    logger.warn?.('image_vision_edit:request_failed', { label: 'PLUGIN', error: String(e?.message || e) });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
