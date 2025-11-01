import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../src/logger/index.js';
import { config } from '../../src/config/index.js';
import OpenAI from 'openai';
import mime from 'mime-types';

function isHttpUrl(s) {
  try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

async function readVideoAsBase64WithMime(src) {
  let buf; let type = '';
  if (isHttpUrl(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`fetch video failed: ${res.status}`);
    const ab = await res.arrayBuffer();
    buf = Buffer.from(ab);
    const ct = (res.headers?.get?.('content-type') || '').split(';')[0].trim();
    if (ct && ct.startsWith('video/')) type = ct;
    if (!type) {
      try { const u = new URL(String(src)); type = mime.lookup(u.pathname) || ''; } catch {}
    }
  } else {
    // treat as local absolute path
    const p = path.resolve(src);
    if (!path.isAbsolute(p)) {
      throw new Error('local video path must be absolute');
    }
    buf = await fs.readFile(p);
    type = String(mime.lookup(p) || '');
  }
  if (!type || !type.startsWith('video/')) {
    // fallback to a common video type
    type = 'video/mp4';
  }
  
  const dataUri = `data:${type};base64,${buf.toString('base64')}`;
  return { uri: dataUri, mime: type, size: buf.length };
}

export default async function handler(args = {}, options = {}) {
  const videos = Array.isArray(args.videos) ? args.videos : [];
  const prompt = String(args.prompt || '').trim();
  if (!videos.length) return { success: false, code: 'INVALID', error: 'videos is required (array of urls or absolute paths)' };
  if (!prompt) return { success: false, code: 'INVALID', error: 'prompt is required' };

  // plugin-level env
  const penv = options?.pluginEnv || {};
  const apiKey = penv.VIDEO_VISION_API_KEY || process.env.VIDEO_VISION_API_KEY || config.llm.apiKey;
  const baseURL = penv.VIDEO_VISION_BASE_URL || process.env.VIDEO_VISION_BASE_URL || config.llm.baseURL;
  const model = penv.VIDEO_VISION_MODEL || process.env.VIDEO_VISION_MODEL || config.llm.model;
  const maxVideoSizeMB = Number(penv.VIDEO_VISION_MAX_SIZE_MB || process.env.VIDEO_VISION_MAX_SIZE_MB || 50);

  const oai = new OpenAI({ apiKey, baseURL });

  logger.info?.('video_vision_read:config', { label: 'PLUGIN', baseURL, model, videoCount: videos.length, maxVideoSizeMB });

  // prepare vision messages: a single user message with mixed text+videos
  const items = [];
  if (prompt) items.push({ type: 'text', text: prompt });
  
  // read all videos and build data URIs with detected MIME in parallel
  let prepared;
  try {
    prepared = await Promise.all(videos.map(async (src) => {
      const result = await readVideoAsBase64WithMime(src);
      // 检查视频大小限制
      const sizeMB = result.size / (1024 * 1024);
      if (sizeMB > maxVideoSizeMB) {
        throw new Error(`Video size ${sizeMB.toFixed(2)}MB exceeds limit of ${maxVideoSizeMB}MB: ${src}`);
      }
      logger.info?.('video_vision_read:video_loaded', { label: 'PLUGIN', src, mime: result.mime, sizeMB: sizeMB.toFixed(2) });
      return result;
    }));
  } catch (e) {
    logger.warn?.('video_vision_read:load_video_failed', { label: 'PLUGIN', error: String(e?.message || e) });
    return { success: false, code: 'VIDEO_READ_ERR', error: String(e?.message || e) };
  }
  
  // 根据OpenAI API格式，视频使用 video_url 而不是 image_url
  for (const it of prepared) {
    items.push({ 
      type: 'video_url', 
      video_url: { url: it.uri } 
    });
  }

  const messages = [
    { role: 'user', content: items }
  ];

  try {
    logger.info?.('video_vision_read:calling_api', { label: 'PLUGIN', model, itemCount: items.length });
    const res = await oai.chat.completions.create({ model, messages });
    const content = res?.choices?.[0]?.message?.content || '';
    logger.info?.('video_vision_read:api_success', { label: 'PLUGIN', responseLength: content?.length || 0 });
    
    // 返回字段：prompt、视频描述与摘要统计
    const formats = Array.from(new Set((prepared || []).map((x) => x.mime))).filter(Boolean);
    const totalSizeMB = (prepared || []).reduce((sum, x) => sum + x.size, 0) / (1024 * 1024);
    
    return { 
      success: true, 
      data: { 
        prompt, 
        description: content, 
        video_count: videos.length, 
        formats,
        total_size_mb: totalSizeMB.toFixed(2)
      } 
    };
  } catch (e) {
    logger.warn?.('video_vision_read:request_failed', { label: 'PLUGIN', error: String(e?.message || e), stack: e?.stack });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
