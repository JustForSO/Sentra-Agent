import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import logger from '../../src/logger/index.js';
import { abs as toAbs } from '../../src/utils/path.js';

function toMarkdownPath(abs) {
  const label = path.basename(abs);
  const mdPath = String(abs).replace(/\\/g, '/');
  return `![${label}](${mdPath})`;
}

// 基础超时请求封装
async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error(`Abort by timeout ${timeoutMs}ms`)), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, headers = {}, timeoutMs = 20000) {
  const res = await fetchWithTimeout(url, { headers }, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  return json;
}

async function ensureCookie(headers, timeoutMs = 8000) {
  if (headers.cookie) return headers;
  try {
    const res = await fetchWithTimeout('https://www.bilibili.com', { headers: { 'user-agent': headers['user-agent'] || '' } }, timeoutMs);
    const setCookie = [];
    // 收集所有 set-cookie
    for (const [k, v] of res.headers) {
      if (String(k).toLowerCase() === 'set-cookie' && v) setCookie.push(String(v));
    }
    if (typeof res.headers.get === 'function') {
      const one = res.headers.get('set-cookie');
      if (one) setCookie.push(one);
    }
    const cookieHeader = setCookie.map(c => String(c).split(';')[0]).filter(Boolean).join('; ');
    if (cookieHeader) return { ...headers, cookie: cookieHeader };
  } catch {}
  return headers;
}

// 流式下载（使用 pipeline + Transform 实现进度跟踪）
async function downloadToFile(url, absPath, headers = {}, timeoutMs = 120000) {
  const res = await fetchWithTimeout(url, { headers }, timeoutMs);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const ct = (res.headers?.get?.('content-type') || '').split(';')[0].trim();
  
  if (!res.body) throw new Error('no response body');
  
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  
  // 进度跟踪 Transform Stream
  let downloaded = 0;
  const logInterval = 5 * 1024 * 1024; // 5MB
  let lastLog = 0;
  
  const { Transform } = await import('node:stream');
  const progressTransform = new Transform({
    transform(chunk, encoding, callback) {
      downloaded += chunk.length;
      if (downloaded - lastLog >= logInterval) {
        logger.info?.('bilibili_search:download_progress', { label: 'PLUGIN', downloadedMB: (downloaded / 1024 / 1024).toFixed(2) });
        lastLog = downloaded;
      }
      callback(null, chunk);
    }
  });
  
  // 超时控制：pipeline 不会自动超时，需要外层包装
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Download timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  
  const downloadPromise = pipeline(
    res.body,
    progressTransform,
    fssync.createWriteStream(absPath)
  );
  
  await Promise.race([downloadPromise, timeoutPromise]);
  
  return { size: downloaded, contentType: ct };
}

// 尝试探测文件大小（优先 HEAD，其次 Range: bytes=0-0）
async function probeContentLength(url, headers = {}, timeoutMs = 8000) {
  // 1) HEAD
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD', headers }, timeoutMs);
    if (res.ok) {
      const len = res.headers?.get?.('content-length') || '';
      const n = parseInt(len, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {}
  // 2) GET with Range
  try {
    const res = await fetchWithTimeout(url, { headers: { ...headers, Range: 'bytes=0-0' } }, timeoutMs);
    if (res.ok) {
      const cr = res.headers?.get?.('content-range') || '';
      const m = /\/(\d+)\s*$/.exec(cr);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0) {
          try { await res?.body?.cancel?.(); } catch {}
          return n;
        }
      }
      try { await res?.body?.cancel?.(); } catch {}
    }
  } catch {}
  return -1;
}

async function searchVideos(keyword, headers = {}, timeoutMs = 20000) {
  const url = `https://api.bilibili.com/x/web-interface/search/type?keyword=${encodeURIComponent(keyword)}&search_type=video`;
  const j = await fetchJson(url, headers, timeoutMs);
  if (j?.code !== 0) throw new Error(`search failed: code=${j?.code} msg=${j?.message || ''}`);
  const items = Array.isArray(j?.data?.result) ? j.data.result : [];
  return items;
}

async function getViewByBvid(bvid, headers = {}, timeoutMs = 20000) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const j = await fetchJson(url, headers, timeoutMs);
  if (j?.code !== 0) throw new Error(`view failed: code=${j?.code} msg=${j?.message || ''}`);
  return j?.data || {};
}

async function getPlayUrl({ bvid, cid, qn = 80, headers = {}, referer = '' }, timeoutMs = 20000) {
  // 优先使用 html5 平台（durl 提供整段 mp4）
  const params = new URLSearchParams({ bvid, cid: String(cid), qn: String(qn), platform: 'html5' });
  const url = `https://api.bilibili.com/x/player/playurl?${params.toString()}`;
  const h = { ...headers, Referer: referer || `https://www.bilibili.com/video/${bvid}` };
  const j = await fetchJson(url, h, timeoutMs);
  if (j?.code !== 0) throw new Error(`playurl failed: code=${j?.code} msg=${j?.message || ''}`);
  const durl = Array.isArray(j?.data?.durl) ? j.data.durl : [];
  if (durl.length === 0) throw new Error('no playable url (durl empty)');
  // 取第一个分段
  const first = durl[0] || {};
  const mainUrl = first?.url;
  const backupUrls = Array.isArray(first?.backup_url) ? first.backup_url.filter(Boolean) : [];
  const allUrls = [mainUrl, ...backupUrls].filter(Boolean);
  if (allUrls.length === 0) throw new Error('no play url');
  const size = Number(first?.size || 0);
  return { urls: allUrls, size: Number.isFinite(size) && size > 0 ? size : 0 };
}

export default async function handler(args = {}, options = {}) {
  const keyword = String(args.keyword || '').trim();
  const pick = (args.pick || 'first');
  // 仅使用环境变量控制封面下载
  const wantCover = String((options?.pluginEnv?.BILI_SAVE_COVER || process.env.BILI_SAVE_COVER || 'true')).toLowerCase() !== 'false';

  if (!keyword) return { success: false, code: 'INVALID', error: 'keyword is required' };

  const penv = options?.pluginEnv || {};
  const baseDir = String(penv.BILI_BASE_DIR || process.env.BILI_BASE_DIR || 'artifacts');
  const quality = Number(penv.BILI_QUALITY || process.env.BILI_QUALITY || 80);
  const maxDownloadMB = Number(penv.BILI_MAX_DOWNLOAD_MB || process.env.BILI_MAX_DOWNLOAD_MB || 65);
  const maxBytes = Math.max(1, Math.floor(maxDownloadMB * 1024 * 1024));
  const fetchTimeoutMs = Number(penv.BILI_FETCH_TIMEOUT_MS || process.env.BILI_FETCH_TIMEOUT_MS || 20000);
  const probeTimeoutMs = Number(penv.BILI_PROBE_TIMEOUT_MS || process.env.BILI_PROBE_TIMEOUT_MS || 8000);
  const downloadTimeoutMs = Number(penv.BILI_DOWNLOAD_TIMEOUT_MS || process.env.BILI_DOWNLOAD_TIMEOUT_MS || 120000);
  const strictProbe = String(penv.BILI_STRICT_PROBE || process.env.BILI_STRICT_PROBE || 'true').toLowerCase() !== 'false';
  const userAgent = String(penv.BILI_USER_AGENT || process.env.BILI_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
  const cookie = String(penv.BILI_COOKIE || process.env.BILI_COOKIE || '');

  const headers = {
    'user-agent': userAgent,
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-CN,zh;q=0.9',
    ...(cookie ? { cookie } : {}),
  };

  // 如果未提供 Cookie，尝试从 bilibili 首页预取以通过校验
  const headersWithCookie = await ensureCookie(headers, fetchTimeoutMs);

  try {
    logger.info?.('bilibili_search:start', { label: 'PLUGIN', keyword, pick });
    
    logger.info?.('bilibili_search:step:search', { label: 'PLUGIN', keyword, timeout: fetchTimeoutMs });
    const items = await searchVideos(keyword, headersWithCookie, fetchTimeoutMs);
    logger.info?.('bilibili_search:step:search_done', { label: 'PLUGIN', count: items.length });
    if (!items.length) return { success: false, code: 'NO_RESULT', error: `未找到与 "${keyword}" 相关的视频` };

    const chosen = pick === 'random' ? items[Math.floor(Math.random() * items.length)] : items[0];
    const title = String(chosen?.title || '').replace(/<[^>]+>/g, '');
    const bvid = String(chosen?.bvid || chosen?.bvid?.trim?.() || '');
    const up = String(chosen?.author || chosen?.uname || '');
    const duration = String(chosen?.duration || '');
    const pic = String(chosen?.pic || '');
    const urlVideoPage = `https://www.bilibili.com/video/${bvid}`;
    logger.info?.('bilibili_search:step:chosen', { label: 'PLUGIN', bvid, title: title.slice(0, 50) });

    // 获取 cid
    logger.info?.('bilibili_search:step:get_cid', { label: 'PLUGIN', bvid, timeout: fetchTimeoutMs });
    const view = await getViewByBvid(bvid, headersWithCookie, fetchTimeoutMs);
    logger.info?.('bilibili_search:step:get_cid_done', { label: 'PLUGIN', bvid });
    const firstPage = Array.isArray(view?.pages) && view.pages.length > 0 ? view.pages[0] : null;
    const cid = Number(firstPage?.cid || view?.cid || 0);
    if (!cid) return { success: false, code: 'NO_CID', error: '未能解析视频 CID' };

    // 播放地址（mp4）
    let playUrls = [];
    let durlSize = 0;
    try {
      logger.info?.('bilibili_search:step:get_playurl', { label: 'PLUGIN', bvid, cid, quality, timeout: fetchTimeoutMs });
      const got = await getPlayUrl({ bvid, cid, qn: quality, headers: headersWithCookie, referer: urlVideoPage }, fetchTimeoutMs);
      playUrls = got.urls || [];
      durlSize = Number(got.size || 0);
      logger.info?.('bilibili_search:step:get_playurl_done', { label: 'PLUGIN', bvid, durlSizeMB: (durlSize / 1024 / 1024).toFixed(2), urlCount: playUrls.length });
    } catch (e) {
      logger.error?.('bilibili_search:step:get_playurl_failed', { label: 'PLUGIN', bvid, error: String(e?.message || e) });
      return { success: false, code: 'PLAYURL_ERR', error: String(e?.message || e) };
    }
    
    if (!playUrls.length) return { success: false, code: 'NO_PLAYURL', error: '未能获取播放地址' };

    // 获取/预探测视频大小
    let sizeBytes = Number(durlSize || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      logger.info?.('bilibili_search:step:probe_size', { label: 'PLUGIN', timeout: probeTimeoutMs });
      sizeBytes = await probeContentLength(playUrls[0], { ...headersWithCookie, Referer: urlVideoPage }, probeTimeoutMs);
      logger.info?.('bilibili_search:step:probe_size_done', { label: 'PLUGIN', sizeMB: sizeBytes > 0 ? (sizeBytes / 1024 / 1024).toFixed(2) : 'unknown' });
    } else {
      logger.info?.('bilibili_search:step:size_from_durl', { label: 'PLUGIN', sizeMB: (sizeBytes / 1024 / 1024).toFixed(2) });
    }

    // 保存目录
    const baseAbs = toAbs(baseDir);
    await fs.mkdir(baseAbs, { recursive: true });
    const id = crypto.randomUUID();
    const fileName = `${id}.mp4`;
    const videoAbs = toAbs(path.join(baseAbs, fileName));

    // 结果骨架
    const data = {
      action: 'bilibili_search',
      keyword,
      pick,
      quality,
      url: urlVideoPage,
      bvid,
      title,
      author: up,
      duration,
      play_url: playUrls[0] || '',
      timestamp: new Date().toISOString(),
    };

    // 如果探测到大小且超过阈值：不下载，仅返回链接
    if (Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes > maxBytes) {
      const sizeMB = +(sizeBytes / 1024 / 1024).toFixed(2);
      logger.info?.('bilibili_search:too_large_skip_download', { label: 'PLUGIN', sizeMB, maxDownloadMB });
      data.too_large = true;
      data.size_bytes = sizeBytes;
      data.size_mb = sizeMB;
      data.notice = `已成功获取视频，但体积 ${sizeMB}MB 超过阈值 ${maxDownloadMB}MB，按策略不下载，已提供访问链接`;
      data.downloaded = false;
      data.status = 'OK_LINK_ONLY';
      data.summary = `已成功获取视频"${title}"（${bvid}），体积 ${sizeMB}MB 超过阈值 ${maxDownloadMB}MB，按策略不下载，已提供链接：${urlVideoPage}`;
    } else if ((!Number.isFinite(sizeBytes) || sizeBytes <= 0) && strictProbe) {
      // 未能确定大小，启用严格模式：直接返回链接，避免长时间下载导致超时
      logger.info?.('bilibili_search:unknown_size_skip_download', { label: 'PLUGIN', strictProbe });
      data.unknown_size = true;
      data.downloaded = false;
      data.status = 'OK_LINK_ONLY';
      data.notice = `已获取视频链接，但无法确定文件大小，按严格策略不下载，已提供访问链接`;
      data.summary = `已成功获取视频"${title}"（${bvid}），由于无法确定体积，按策略不下载，已提供链接：${urlVideoPage}`;
    } else {
      // 下载视频（支持备用 URL 重试）
      let videoSize = 0; let contentType = '';
      let lastError = null;
      for (let i = 0; i < playUrls.length; i++) {
        const currentUrl = playUrls[i];
        try {
          logger.info?.('bilibili_search:step:download_start', { label: 'PLUGIN', urlIndex: i, totalUrls: playUrls.length, timeout: downloadTimeoutMs, sizeMB: sizeBytes > 0 ? (sizeBytes / 1024 / 1024).toFixed(2) : 'unknown' });
          const got = await downloadToFile(currentUrl, videoAbs, { ...headersWithCookie, Referer: urlVideoPage }, downloadTimeoutMs);
          videoSize = got.size; contentType = got.contentType;
          logger.info?.('bilibili_search:step:download_done', { label: 'PLUGIN', urlIndex: i, sizeMB: (videoSize / 1024 / 1024).toFixed(2) });
          lastError = null;
          break; // 成功，退出重试循环
        } catch (e) {
          lastError = e;
          logger.warn?.('bilibili_search:download_failed_retry', { label: 'PLUGIN', urlIndex: i, error: String(e?.message || e) });
          if (i < playUrls.length - 1) {
            logger.info?.('bilibili_search:download_retry_backup', { label: 'PLUGIN', nextUrlIndex: i + 1 });
          }
        }
      }
      
      if (lastError) {
        // 所有 URL 都失败：优雅回退为仅链接
        const note = String(lastError?.message || lastError);
        logger.warn?.('bilibili_search:download_aborted_all_urls', { label: 'PLUGIN', error: note });
        data.downloaded = false;
        data.status = 'OK_LINK_ONLY';
        data.notice = `下载阶段中止（尝试了 ${playUrls.length} 个地址）：${note}。已提供访问链接`;
        data.summary = `已获取视频"${title}"（${bvid}），下载阶段中止（${note}），按策略返回链接：${urlVideoPage}`;
        return { success: true, data };
      }
      // 与规范一致，提供顶层 path 与 path_markdown（指向视频文件）
      data.path = videoAbs;
      data.path_markdown = toMarkdownPath(videoAbs);
      data.video = { path: videoAbs, path_markdown: toMarkdownPath(videoAbs), size: videoSize, contentType };
      data.downloaded = true;
      const sizeMB = +(videoSize / 1024 / 1024).toFixed(2);
      data.size_bytes = videoSize;
      data.size_mb = sizeMB;
      data.status = 'OK_DOWNLOADED';
      data.summary = `已成功下载视频"${title}"（${bvid}），大小 ${sizeMB}MB，保存至本地。`;
    }

    // 下载封面
    if (wantCover && pic) {
      try {
        logger.info?.('bilibili_search:step:download_cover', { label: 'PLUGIN', timeout: fetchTimeoutMs });
        const coverUrl = pic.startsWith('//') ? `https:${pic}` : pic;
        const ext = path.extname(new URL(coverUrl).pathname) || '.jpg';
        const coverName = `${id}_cover${ext}`;
        const coverAbs = toAbs(path.join(baseAbs, coverName));
        const { size: coverSize, contentType: coverType } = await downloadToFile(coverUrl, coverAbs, headersWithCookie, fetchTimeoutMs);
        data.cover = { path: coverAbs, path_markdown: toMarkdownPath(coverAbs), size: coverSize, contentType: coverType };
        logger.info?.('bilibili_search:step:download_cover_done', { label: 'PLUGIN' });
      } catch (e) {
        logger.warn?.('bilibili_search:cover_download_failed', { label: 'PLUGIN', error: String(e?.message || e) });
      }
    }

    logger.info?.('bilibili_search:complete', { label: 'PLUGIN', status: data.status, downloaded: data.downloaded });
    return { success: true, data };
  } catch (e) {
    logger.error?.('bilibili_search:error', { label: 'PLUGIN', error: String(e?.message || e), stack: e?.stack });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
