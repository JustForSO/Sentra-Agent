import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../src/logger/index.js';
import { config } from '../../src/config/index.js';
import OpenAI from 'openai';
import mime from 'mime-types';

function isHttpUrl(s) {
  try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

function findMarkdownLinks(md) {
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  const out = [];
  let m; while ((m = re.exec(String(md || ''))) !== null) {
    const text = String(m[1] || '').trim();
    const url = String(m[2] || '').trim();
    out.push({ text, url });
  }
  return out;
}

function hasMarkdownVideo(md) {
  const links = findMarkdownLinks(md);
  return links.some((l) => isHttpUrl(l.url));
}

async function downloadVideosAndRewrite(md, prefix = 'video') {
  const links = findMarkdownLinks(md).filter((l) => isHttpUrl(l.url));
  if (!links.length) return md;

  const baseDir = 'artifacts';
  await fs.mkdir(baseDir, { recursive: true });

  const map = new Map();
  let idx = 0;
  for (const { url } of links) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let ct = (res.headers?.get?.('content-type') || '').split(';')[0].trim();
      if (!ct) {
        try { const u = new URL(url); ct = String(mime.lookup(u.pathname) || ''); } catch {}
      }
      // Skip non-video links
      const isVideo = (ct && ct.startsWith('video/'));
      if (!isVideo) continue;

      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      let ext = '';
      if (ct && ct.startsWith('video/')) {
        const e = mime.extension(ct);
        if (e) ext = `.${e}`;
      }
      if (!ext) {
        try { const u = new URL(url); ext = path.extname(u.pathname) || '.mp4'; } catch { ext = '.mp4'; }
      }
      const name = `${prefix}_${Date.now()}_${idx++}${ext}`;
      const abs = path.resolve(baseDir, name);
      await fs.writeFile(abs, buf);
      const absMd = String(abs).replace(/\\/g, '/');
      map.set(url, absMd);
    } catch (e) {
      logger.warn?.('video_generate:download_failed', { label: 'PLUGIN', url, error: String(e?.message || e) });
    }
  }

  return String(md || '').replace(/\[([^\]]*)\]\(([^)]+)\)/g, (full, text, url) => {
    const key = String(url || '').trim();
    if (map.has(key)) return `[${text}](${map.get(key)})`;
    return full;
  });
}

export default async function handler(args = {}, options = {}) {
  const prompt = String(args.prompt || '').trim();
  if (!prompt) return { success: false, code: 'INVALID', error: 'prompt is required' };

  const penv = options?.pluginEnv || {};
  const apiKey = penv.VIDEO_API_KEY || process.env.VIDEO_API_KEY || config.llm.apiKey;
  const baseURL = penv.VIDEO_BASE_URL || process.env.VIDEO_BASE_URL || config.llm.baseURL;
  const model = String(penv.VIDEO_MODEL || process.env.VIDEO_MODEL || config.llm.model || '').trim();

  const oai = new OpenAI({ apiKey, baseURL });

  const system = 'You are a video generation assistant. Respond with a short description plus at least one Markdown link to a downloadable video file (e.g., [Download video](https://.../file.mp4)). The link must be a direct file URL (mp4/webm/mov/mkv). Do not include code fences.';
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: prompt }
  ];

  try {
    const stream = await oai.chat.completions.create({ model, messages, stream: true });
    let content = '';
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content || '';
      if (delta) {
        content += delta;
        if (typeof options?.onStream === 'function') {
          try { options.onStream({ type: 'delta', delta, content }); } catch {}
        }
      }
    }
    if (!hasMarkdownVideo(content)) {
      return { success: false, code: 'NO_MD_VIDEO', error: 'response has no markdown video link', data: { prompt, content } };
    }
    const rewritten = await downloadVideosAndRewrite(content, 'video');
    return { success: true, data: { prompt, content: rewritten } };
  } catch (e) {
    logger.warn?.('video_generate:request_failed', { label: 'PLUGIN', error: String(e?.message || e) });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
