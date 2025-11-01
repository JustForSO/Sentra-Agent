import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../src/logger/index.js';
import { config } from '../../src/config/index.js';
import OpenAI from 'openai';
import mime from 'mime-types';

// 模型简化：仅使用环境变量 DRAW_MODEL（未配置则回退全局模型）

function hasMarkdownImage(s) {
  return /!\[[^\]]*\]\([^)]+\)/i.test(String(s || ''));
}

function isHttpUrl(s) {
  try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

async function downloadImagesAndRewrite(md, prefix = 'draw') {
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
      const name = `${prefix}_${Date.now()}_${idx++}${ext}`;
      const abs = path.resolve(baseDir, name);
      await fs.writeFile(abs, buf);
      const absMd = String(abs).replace(/\\/g, '/');
      map.set(url, absMd);
    } catch (e) {
      logger.warn?.('image_draw:download_failed', { label: 'PLUGIN', url, error: String(e?.message || e) });
    }
  }
  return md.replace(re, (full, alt, url) => {
    const key = String(url || '').trim();
    if (map.has(key)) return `![${alt}](${map.get(key)})`;
    return full;
  });
}

export default async function handler(args = {}, options = {}) {
  const prompt = String(args.prompt || '').trim();
  if (!prompt) return { success: false, code: 'INVALID', error: 'prompt is required' };

  const penv = options?.pluginEnv || {};
  const apiKey = penv.DRAW_API_KEY || process.env.DRAW_API_KEY || config.llm.apiKey;
  const baseURL = penv.DRAW_BASE_URL || process.env.DRAW_BASE_URL || config.llm.baseURL;
  const model = String(penv.DRAW_MODEL || process.env.DRAW_MODEL || config.llm.model || '').trim();

  const oai = new OpenAI({ apiKey, baseURL });

  // Encourage markdown image output
  const system = 'You are an image drawing assistant. Respond with a short description plus at least one Markdown image link (e.g., ![image](...)). Do not include code fences.';
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: prompt }
  ];

  try {
    const res = await oai.chat.completions.create({ model, messages });
    const content = res?.choices?.[0]?.message?.content || '';
    if (!hasMarkdownImage(content)) {
      return { success: false, code: 'NO_MD_IMAGE', error: 'response has no markdown image', data: { prompt, content } };
    }
    const rewritten = await downloadImagesAndRewrite(content, 'draw');
    return { success: true, data: { prompt, content: rewritten } };
  } catch (e) {
    logger.warn?.('image_draw:request_failed', { label: 'PLUGIN', error: String(e?.message || e) });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
