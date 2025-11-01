import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import axios from 'axios';
import logger from '../../src/logger/index.js';

// ---- Chunking helpers ----
function mb(n) { return Math.max(0, Number(n) || 0) * 1024 * 1024; }

function buildFetchHeaders(penv, args) {
  const headers = {};
  const ua = penv.AV_FETCH_USER_AGENT || process.env.AV_FETCH_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
  headers['User-Agent'] = ua;
  const referer = penv.AV_FETCH_REFERER || process.env.AV_FETCH_REFERER || args?.referer || args?.headers?.Referer || args?.headers?.referer;
  if (referer) headers['Referer'] = referer;
  const cookie = penv.AV_FETCH_COOKIE || process.env.AV_FETCH_COOKIE || args?.headers?.Cookie || args?.headers?.cookie;
  if (cookie) headers['Cookie'] = cookie;
  const extra = penv.AV_FETCH_HEADERS_JSON || process.env.AV_FETCH_HEADERS_JSON || null;
  if (extra) {
    try {
      const parsed = JSON.parse(extra);
      if (parsed && typeof parsed === 'object') Object.assign(headers, parsed);
    } catch {}
  }
  if (args?.headers && typeof args.headers === 'object') Object.assign(headers, args.headers);
  return headers;
}

function resolveBaseDir(penv) {
  const base = penv.AV_BASE_DIR || process.env.AV_BASE_DIR || 'artifacts';
  const abs = path.isAbsolute(base) ? base : path.resolve(process.cwd(), base);
  const dir = path.join(abs, 'tmp', 'av_transcribe');
  try { fssync.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

async function downloadToTempFile(url, timeoutMs, headers, baseTmpDir) {
  const ext = (() => { try { return path.extname(new URL(url).pathname) || '.bin'; } catch { return '.bin'; } })();
  const root = baseTmpDir || path.join(os.tmpdir(), 'av_transcribe');
  try { fssync.mkdirSync(root, { recursive: true }); } catch {}
  const tmp = path.join(root, `av_transcribe_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  const resp = await axios.get(url, { responseType: 'stream', timeout: timeoutMs, maxBodyLength: Infinity, headers });
  await new Promise((resolve, reject) => {
    const ws = fssync.createWriteStream(tmp);
    resp.data.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
  return tmp;
}
function kb(n) { return Math.max(0, Number(n) || 0) * 1024; }

function buildChunks(fileSize, chunkSize, overlapBytes) {
  if (!Number.isFinite(fileSize) || fileSize <= 0) return [];
  const chunks = [];
  let offset = 0;
  let idx = 0;
  while (offset < fileSize) {
    const start = offset;
    const end = Math.min(offset + chunkSize, fileSize);
    let actualEnd = end;
    if (end < fileSize && idx < 3 && overlapBytes > 0) {
      actualEnd = Math.min(end + overlapBytes, fileSize);
    }
    chunks.push({ index: idx, start, end: actualEnd });
    offset += chunkSize; // next slice (no overlap move)
    idx += 1;
  }
  return chunks;
}

async function headRemote(url, timeoutMs) {
  try {
    const res = await axios.head(url, { timeout: Math.min(timeoutMs, 15000) });
    const len = Number(res.headers['content-length']);
    const acceptRanges = String(res.headers['accept-ranges'] || '').toLowerCase();
    return { size: Number.isFinite(len) ? len : null, acceptRanges };
  } catch {
    return { size: null, acceptRanges: '' };
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0, active = 0;
  return await new Promise((resolve, reject) => {
    const next = () => {
      while (active < limit && i < items.length) {
        const cur = i++;
        active++;
        Promise.resolve(worker(items[cur], cur))
          .then((r) => { results[cur] = r; active--; (i >= items.length && active === 0) ? resolve(results) : next(); })
          .catch(reject);
      }
    };
    if (items.length === 0) resolve(results);
    else next();
  });
}

function pickLanguage(langs) {
  const map = new Map();
  for (const l of langs) { if (!l) continue; map.set(l, (map.get(l) || 0) + 1); }
  let best = null, max = -1;
  for (const [k, v] of map.entries()) { if (v > max) { best = k; max = v; } }
  return best || langs.find(Boolean) || '未知';
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function toErrInfo(e) {
  return {
    message: e?.message || String(e),
    code: e?.code,
    status: e?.response?.status,
    statusText: e?.response?.statusText,
    dataPreview: (() => {
      const d = e?.response?.data;
      if (!d) return undefined;
      try {
        if (typeof d === 'string') return d.slice(0, 300);
        if (Buffer.isBuffer?.(d)) return `<buffer ${d.length}>`;
        return JSON.stringify(d).slice(0, 300);
      } catch {
        return String(d).slice(0, 300);
      }
    })(),
  };
}

function shouldRetry(e) {
  const status = e?.response?.status;
  const code = String(e?.code || '').toUpperCase();
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) return true;
  return false;
}

async function postWithRetry(url, formData, timeoutMs, retries, baseDelayMs) {
  let attempt = 0;
  while (true) {
    try {
      const res = await axios.post(url, formData, {
        headers: formData.getHeaders(),
        timeout: timeoutMs,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return res;
    } catch (e) {
      const info = toErrInfo(e);
      if (attempt >= retries || !shouldRetry(e)) {
        logger.error?.('av_transcribe:post_failed', { attempt, info });
        throw e;
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), 8000) + Math.floor(Math.random() * 250);
      logger.warn?.('av_transcribe:post_retry', { attempt, waitMs: delay, info });
      await sleep(delay);
      attempt += 1;
    }
  }
}

export default async function handler(args = {}, options = {}) {
  const filePath = String(args.file || '').trim();
  const language = args.language || null;
  const prompt = args.prompt || null;
  
  if (!filePath) {
    return { success: false, code: 'INVALID', error: 'file is required' };
  }
  
  const penv = options?.pluginEnv || {};
  const baseUrl = String(penv.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  const model = String(penv.WHISPER_MODEL || process.env.WHISPER_MODEL || 'whisper-1');
  const timeoutMs = Number(penv.WHISPER_TIMEOUT_MS || process.env.WHISPER_TIMEOUT_MS || 300000);
  // Chunking config (env)
  const chunkEnabledRaw = String(penv.AV_CHUNK_ENABLED ?? '1').trim().toLowerCase();
  const chunkEnabled = !(chunkEnabledRaw === '0' || chunkEnabledRaw === 'false' || chunkEnabledRaw === 'off' || chunkEnabledRaw === 'no');
  const chunkSizeBytes = penv.AV_CHUNK_SIZE_BYTES ? Number(penv.AV_CHUNK_SIZE_BYTES) : mb(penv.AV_CHUNK_SIZE_MB ?? 2.5);
  const chunkOverlapBytes = penv.AV_CHUNK_OVERLAP_BYTES ? Number(penv.AV_CHUNK_OVERLAP_BYTES) : kb(penv.AV_CHUNK_OVERLAP_KB ?? 10);
  const maxChunkThreshold = penv.AV_MAX_CHUNK_SIZE_BYTES ? Number(penv.AV_MAX_CHUNK_SIZE_BYTES) : mb(penv.AV_MAX_CHUNK_SIZE_MB ?? 3);
  const maxConcurrency = Math.max(1, Number(penv.AV_MAX_CONCURRENCY || 4));
  const retries = Math.max(0, Number(penv.AV_MAX_RETRIES || 2));
  const retryBaseMs = Math.max(100, Number(penv.AV_RETRY_BASE_MS || 600));
  
  try {
    logger.info?.('av_transcribe:start', {
      label: 'PLUGIN',
      file: filePath,
      language: language || 'auto',
      model
    });
    
    // 支持本地文件与 http/https URL
    const isUrl = filePath.startsWith('http://') || filePath.startsWith('https://');
    if (!isUrl && !fssync.existsSync(filePath)) {
      return { success: false, code: 'FILE_NOT_FOUND', error: `File not found: ${filePath}` };
    }

    // 获取大小与是否支持 Range（URL 优先 HEAD；不支持则回落为本地临时文件以启用切片）
    let fileSize = null; let acceptRanges = '';
    let localPath = filePath; let usingTemp = false;
    const fetchHeaders = buildFetchHeaders(penv, args);
    const baseTmpDir = resolveBaseDir(penv);
    if (isUrl) {
      const info = await headRemote(filePath, timeoutMs, fetchHeaders);
      if (!Number.isFinite(info.size) || !String(info.acceptRanges || '').includes('bytes')) {
        logger.info?.('av_transcribe:fallback_download', { label: 'PLUGIN', reason: 'no-range-or-size', url: filePath });
        localPath = await downloadToTempFile(filePath, timeoutMs, fetchHeaders, baseTmpDir);
        usingTemp = true;
        try { fileSize = fssync.statSync(localPath).size; } catch {}
      } else {
        fileSize = info.size; acceptRanges = info.acceptRanges;
      }
    } else {
      try { fileSize = fssync.statSync(filePath).size; } catch {}
    }

    const canChunk = chunkEnabled && Number.isFinite(fileSize) && fileSize > maxChunkThreshold && (!isUrl || usingTemp || (acceptRanges && acceptRanges.includes('bytes')));
    logger.info?.('av_transcribe:chunk_decision', {
      label: 'PLUGIN', isUrl, usingTemp, fileSize, chunkEnabled, acceptRanges, threshold: maxChunkThreshold, canChunk
    });

    if (!canChunk) {
      // 单次直传（保持之前行为：直接返回 API 响应）
      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      if (isUrl && !usingTemp) {
        const remote = await axios.get(filePath, { responseType: 'stream', timeout: timeoutMs, maxBodyLength: Infinity, headers: fetchHeaders });
        const guessedName = (() => { try { return path.basename(new URL(filePath).pathname) || 'audio'; } catch { return 'audio'; }})();
        const contentType = remote.headers?.['content-type'] || 'application/octet-stream';
        formData.append('file', remote.data, { filename: guessedName, contentType });
      } else {
        const fileStream = fssync.createReadStream(localPath);
        formData.append('file', fileStream, { filename: path.basename(localPath), contentType: 'application/octet-stream' });
      }
      formData.append('model', model);
      if (language) formData.append('language', language);
      if (prompt) formData.append('prompt', prompt);

      logger.info?.('av_transcribe:api_call', { label: 'PLUGIN', url: `${baseUrl}/audio/transcriptions`, model, language, source: isUrl ? 'url' : 'file', mode: 'single' });
      const response = await postWithRetry(`${baseUrl}/audio/transcriptions`, formData, timeoutMs, retries, retryBaseMs);
      logger.info?.('av_transcribe:complete', { label: 'PLUGIN' });
      const data = response.data;
      if (usingTemp) { try { fssync.unlinkSync(localPath); } catch {} }
      return data;
    }

    // 分片并发处理
    const chunks = buildChunks(fileSize, chunkSizeBytes, chunkOverlapBytes);
    logger.info?.('av_transcribe:chunking', { label: 'PLUGIN', fileSize, chunks: chunks.length, chunkSizeBytes, chunkOverlapBytes, concurrency: maxConcurrency });

    const worker = async (c) => {
      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      let filename = 'audio_chunk_' + (c.index + 1);
      let contentType = 'application/octet-stream';

      if (isUrl && !usingTemp) {
        const rangeHeader = { Range: `bytes=${c.start}-${c.end - 1}`, ...fetchHeaders };
        const resp = await axios.get(filePath, { responseType: 'stream', headers: rangeHeader, timeout: timeoutMs, maxBodyLength: Infinity });
        try { filename = path.basename(new URL(filePath).pathname) || filename; } catch {}
        contentType = resp.headers?.['content-type'] || contentType;
        formData.append('file', resp.data, { filename, contentType });
      } else {
        try { filename = path.basename(localPath).replace(/(\.[^./\\]+)?$/, `_chunk_${c.index + 1}$1`); } catch {}
        const stream = fssync.createReadStream(localPath, { start: c.start, end: c.end - 1 });
        formData.append('file', stream, { filename, contentType });
      }

      formData.append('model', model);
      if (language) formData.append('language', language);
      const addition = ` (音频第${c.index + 1}部分，共${chunks.length}部分，请确保转录完整准确)`;
      const chunkPrompt = chunks.length > 1 ? (prompt ? `${prompt}${addition}` : addition) : (prompt || '');
      if (chunkPrompt) formData.append('prompt', chunkPrompt);

      const res = await postWithRetry(`${baseUrl}/audio/transcriptions`, formData, timeoutMs, retries, retryBaseMs);
      const data = res.data;
      // 归一化每片结果
      let text = '';
      let lang = '';
      if (data && data.success && Array.isArray(data.data) && data.data.length >= 2) {
        text = String(data.data[0] || '');
        lang = String(data.data[1] || '');
      } else if (data && typeof data === 'object') {
        text = String(data.text || data.transcript || data.content || '');
        lang = String(data.language_name || data.language || '');
      } else if (typeof data === 'string') {
        text = data;
      }
      return { index: c.index, text, language: lang };
    };

    let results;
    try {
      results = await mapLimit(chunks, maxConcurrency, worker);
    } catch (err) {
      logger.warn?.('av_transcribe:chunk_parallel_error', { error: toErrInfo(err) });
      // Fallback: sequential processing
      results = await mapLimit(chunks, 1, worker);
    }

    // 排序拼接
    const ordered = results.slice().sort((a, b) => a.index - b.index);
    const combinedText = ordered.map(r => r.text).filter(Boolean).join('\n');
    const combinedLang = pickLanguage(ordered.map(r => r.language));

    logger.info?.('av_transcribe:complete', { label: 'PLUGIN', chunks: chunks.length });
    if (usingTemp) { try { fssync.unlinkSync(localPath); } catch {} }
    return { success: true, data: [combinedText, combinedLang] };
    
  } catch (e) {
    logger.error?.('av_transcribe:error', {
      label: 'PLUGIN',
      error: String(e?.message || e),
      stack: e?.stack
    });
    
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
