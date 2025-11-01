import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import logger from '../../src/logger/index.js';
import { abs as toAbs } from '../../src/utils/path.js';

function toMarkdownPath(abs) {
  const label = path.basename(abs);
  const mdPath = String(abs).replace(/\\/g, '/');
  return `![${label}](${mdPath})`;
}

// Fisher-Yates 洗牌算法
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function guessExtFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').pop() || '');
    const m = last.match(/\.[a-zA-Z0-9]{2,5}$/);
    return m ? m[0].toLowerCase() : '';
  } catch {
    return '';
  }
}

function extFromContentType(ct) {
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'image/heic': '.heic',
    'image/heif': '.heif',
  };
  return map[ct] || '';
}

// 智能筛选 + 深度随机打乱算法
// 优先选择前60%高相关性图片，不足时补充后40%
function smartShuffleWithRelevance(array, needCount) {
  if (!array.length) return array;
  
  // 计算前60%的数量（高相关性区域）
  const highRelevanceCount = Math.ceil(array.length * 0.6);
  const highRelevance = array.slice(0, highRelevanceCount);
  const lowRelevance = array.slice(highRelevanceCount);
  
  let selected = [];
  
  // 优先从高相关性区域选取
  if (highRelevance.length >= needCount) {
    // 高相关性图片足够，直接从中选取
    selected = highRelevance.slice(0, needCount);
  } else {
    // 高相关性图片不够，全部加入
    selected = [...highRelevance];
    
    // 从低相关性区域补充
    const remaining = needCount - selected.length;
    if (remaining > 0 && lowRelevance.length > 0) {
      selected.push(...lowRelevance.slice(0, remaining));
    }
  }
  
  // 对选中的图片进行深度洗牌
  return deepShuffle(selected);
}

// 深度随机打乱算法（多重随机策略）
function deepShuffle(array) {
  if (!array.length) return array;
  
  const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const shuffleCount = getRandomInt(3, 5); // 随机进行3-5次打乱
  let results = [...array];
  
  for (let i = 0; i < shuffleCount; i++) {
    // Fisher-Yates 洗牌
    shuffleArray(results);
    
    // 随机排序
    results.sort(() => Math.random() - 0.5);
    
    // 随机反转
    if (Math.random() > 0.5) {
      results.reverse();
    }
    
    // 随机分段重组
    if (Math.random() > 0.5) {
      const splitIndex = Math.floor(results.length / 2);
      const firstHalf = results.slice(0, splitIndex);
      const secondHalf = results.slice(splitIndex);
      results = [...secondHalf, ...firstHalf];
    }
  }
  
  // 最后再进行一次 Fisher-Yates 洗牌
  shuffleArray(results);
  
  return results;
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

// 搜图神器壁纸搜索 API（主要来源）
async function searchWallpapers(query, count, timeoutMs = 10000) {
  try {
    const hashValue = crypto.randomBytes(32).toString('hex');
    const params = new URLSearchParams({
      product_id: '52',
      version_code: '28103',
      page: '0',
      search_word: query,
      maxWidth: '99999',
      minWidth: '0',
      maxHeight: '99999',
      minHeight: '0',
      searchMode: 'ACCURATE_SEARCH',
      sort: '0',
      sign: hashValue
    });
    
    const res = await fetchWithTimeout('https://wallpaper.soutushenqi.com/v1/wallpaper/list', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    }, timeoutMs);
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    
    if (!data.data || !Array.isArray(data.data)) return [];
    
    // 提取并过滤有效的图片URL
    const imageUrls = data.data
      .filter(item => item.largeUrl && !item.largeUrl.includes('fw480'))
      .map(item => ({
        url: item.largeUrl,
        source: 'wallpaper',
        id: item.id || crypto.randomUUID(),
      }));
    
    // 去重
    const uniqueUrls = Array.from(
      new Map(imageUrls.map(item => [item.url, item])).values()
    );
    
    return uniqueUrls.slice(0, count);
  } catch (e) {
    logger.warn?.('unsplash_search:wallpaper_failed', { label: 'PLUGIN', error: String(e?.message || e) });
    return [];
  }
}

// 搜索图片
async function searchPhotos({ query, count, orientation, accessKey, headers = {} }, timeoutMs = 20000) {
  const params = new URLSearchParams({
    query,
    per_page: String(Math.min(count, 30)), // Unsplash API 限制单次最多30
    client_id: accessKey,
  });
  if (orientation) params.append('orientation', orientation);
  
  const url = `https://api.unsplash.com/search/photos?${params.toString()}`;
  const j = await fetchJson(url, headers, timeoutMs);
  
  if (!Array.isArray(j?.results)) throw new Error('Invalid Unsplash API response');
  return j.results.slice(0, count); // 确保不超过请求数量
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
  const logInterval = 2 * 1024 * 1024; // 2MB（图片较小，更频繁反馈）
  let lastLog = 0;
  
  const { Transform } = await import('node:stream');
  const progressTransform = new Transform({
    transform(chunk, encoding, callback) {
      downloaded += chunk.length;
      if (downloaded - lastLog >= logInterval) {
        logger.info?.('unsplash_search:download_progress', { label: 'PLUGIN', downloadedMB: (downloaded / 1024 / 1024).toFixed(2) });
        lastLog = downloaded;
      }
      callback(null, chunk);
    }
  });
  
  // 超时控制
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

// 创建 zip 压缩包
async function createZip(files, zipPath) {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  
  return new Promise((resolve, reject) => {
    const output = fssync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      resolve({ size: archive.pointer(), path: zipPath });
    });
    
    archive.on('error', reject);
    output.on('error', reject);
    
    archive.pipe(output);
    
    for (const file of files) {
      if (fssync.existsSync(file.path)) {
        archive.file(file.path, { name: path.basename(file.path) });
      }
    }
    
    archive.finalize();
  });
}

export default async function handler(args = {}, options = {}) {
  const query = String(args.query || '').trim();
  const count = Number(args.count || 0);
  const orientation = args.orientation || null;
  
  if (!query) return { success: false, code: 'INVALID', error: 'query is required' };
  if (!count || count < 1) return { success: false, code: 'INVALID', error: 'count is required and must be >= 1' };
  
  const penv = options?.pluginEnv || {};
  const accessKey = String(penv.UNSPLASH_ACCESS_KEY || process.env.UNSPLASH_ACCESS_KEY || '');
  const hasUnsplashKey = accessKey && accessKey !== 'YOUR_ACCESS_KEY_HERE';
  
  if (!hasUnsplashKey) {
    logger.info?.('unsplash_search:no_unsplash_key', { label: 'PLUGIN', message: 'Unsplash API key not configured, will only use wallpaper API' });
  }
  
  const baseDir = String(penv.UNSPLASH_BASE_DIR || process.env.UNSPLASH_BASE_DIR || 'artifacts');
  const maxCount = Number(penv.UNSPLASH_MAX_COUNT || process.env.UNSPLASH_MAX_COUNT || 10);
  const zipThreshold = Number(penv.UNSPLASH_ZIP_THRESHOLD || process.env.UNSPLASH_ZIP_THRESHOLD || 3);
  const quality = String(penv.UNSPLASH_QUALITY || process.env.UNSPLASH_QUALITY || 'regular');
  const fetchTimeoutMs = Number(penv.UNSPLASH_FETCH_TIMEOUT_MS || process.env.UNSPLASH_FETCH_TIMEOUT_MS || 20000);
  const downloadTimeoutMs = Number(penv.UNSPLASH_DOWNLOAD_TIMEOUT_MS || process.env.UNSPLASH_DOWNLOAD_TIMEOUT_MS || 120000);
  const concurrency = Math.max(1, Math.min(20, Number(penv.UNSPLASH_CONCURRENCY || process.env.UNSPLASH_CONCURRENCY || 5))); // 限制1-20
  const userAgent = String(penv.UNSPLASH_USER_AGENT || process.env.UNSPLASH_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
  
  const finalCount = Math.min(count, maxCount);
  
  if (count > maxCount) {
    logger.info?.('unsplash_search:count_limited', { label: 'PLUGIN', requestedCount: count, maxCount, actualCount: finalCount });
  }
  
  const headers = {
    'user-agent': userAgent,
    'accept': 'application/json',
  };
  
  try {
    logger.info?.('unsplash_search:start', { label: 'PLUGIN', query, requestedCount: count, actualCount: finalCount, orientation });
    
    // 多源搜索策略：优先壁纸API，不足时用Unsplash补充
    let allPhotos = [];
    
    // 第一步：搜索壁纸API（主要来源）
    logger.info?.('unsplash_search:step:search_wallpaper', { label: 'PLUGIN', query, count: finalCount, timeout: fetchTimeoutMs });
    const wallpaperResults = await searchWallpapers(query, finalCount, fetchTimeoutMs);
    logger.info?.('unsplash_search:step:search_wallpaper_done', { label: 'PLUGIN', found: wallpaperResults.length, source: 'wallpaper' });
    
    allPhotos.push(...wallpaperResults);
    
    // 第二步：如果壁纸结果不足且有Unsplash Key，用Unsplash补充
    const remaining = finalCount - allPhotos.length;
    if (remaining > 0 && hasUnsplashKey) {
      logger.info?.('unsplash_search:step:search_unsplash', { label: 'PLUGIN', query, count: remaining, timeout: fetchTimeoutMs });
      const unsplashPhotos = await searchPhotos({ query, count: remaining, orientation, accessKey, headers }, fetchTimeoutMs);
      const unsplashResults = unsplashPhotos.map(photo => ({
        ...photo,
        source: 'unsplash',
        url: photo.urls?.regular || photo.urls?.full,
      }));
      logger.info?.('unsplash_search:step:search_unsplash_done', { label: 'PLUGIN', found: unsplashResults.length, source: 'unsplash' });
      allPhotos.push(...unsplashResults);
    } else if (remaining > 0 && !hasUnsplashKey) {
      logger.warn?.('unsplash_search:skip_unsplash', { label: 'PLUGIN', message: 'Unsplash补充跳过（无API Key），返回已有结果', wallpaperCount: allPhotos.length, remaining });
    }
    
    if (!allPhotos.length) return { success: false, code: 'NO_RESULT', error: `未找到与 "${query}" 相关的图片` };
    
    // 统计来源
    const sourceStats = allPhotos.reduce((acc, p) => {
      acc[p.source] = (acc[p.source] || 0) + 1;
      return acc;
    }, {});
    logger.info?.('unsplash_search:source_stats', { label: 'PLUGIN', total: allPhotos.length, sources: sourceStats });
    
    // 智能筛选 + 深度洗牌：优先选择前60%高相关性图片
    const highRelevanceCount = Math.ceil(allPhotos.length * 0.6);
    logger.info?.('unsplash_search:step:smart_select', { label: 'PLUGIN', total: allPhotos.length, highRelevance: highRelevanceCount, needCount: finalCount });
    
    const shuffledPhotos = smartShuffleWithRelevance(allPhotos, finalCount);
    logger.info?.('unsplash_search:step:smart_shuffle_done', { label: 'PLUGIN', selected: shuffledPhotos.length });
    
    // 保存目录
    const baseAbs = toAbs(baseDir);
    const sessionId = crypto.randomUUID().slice(0, 8);
    const sessionDir = path.join(baseAbs, `unsplash_${sessionId}`);
    await fs.mkdir(sessionDir, { recursive: true });
    
    // 并发下载图片（并发数由env配置，默认5）
    logger.info?.('unsplash_search:step:download_start', { label: 'PLUGIN', total: shuffledPhotos.length, concurrency });
    
    const downloadTasks = shuffledPhotos.map((photo, i) => {
      const photoId = photo.id || `photo_${i}`;
      const photoSource = photo.source || 'unknown';
      
      // 根据来源提取下载URL
      let downloadUrl;
      if (photoSource === 'wallpaper') {
        downloadUrl = photo.url;
      } else if (photoSource === 'unsplash') {
        const urlMap = {
          full: photo.urls?.full,
          regular: photo.urls?.regular,
          small: photo.urls?.small,
          thumb: photo.urls?.thumb,
        };
        downloadUrl = urlMap[quality] || photo.url || photo.urls?.regular || photo.urls?.full;
      } else {
        downloadUrl = photo.url || photo.urls?.regular;
      }
      
      if (!downloadUrl) {
        logger.warn?.('unsplash_search:no_url', { label: 'PLUGIN', photoId, index: i, source: photoSource });
        return Promise.resolve(null);
      }
      
      let ext = guessExtFromUrl(downloadUrl) || '.jpg';
      let fileName = `${sessionId}_${i + 1}_${photoSource}_${photoId}${ext}`;
      let absPath = path.join(sessionDir, fileName);
      
      return async () => {
        try {
          const { size, contentType } = await downloadToFile(downloadUrl, absPath, headers, downloadTimeoutMs);
          let finalPath = absPath;
          const ctExt = extFromContentType(contentType);
          if (ctExt && ctExt !== ext) {
            const newPath = path.join(sessionDir, `${sessionId}_${i + 1}_${photoSource}_${photoId}${ctExt}`);
            try {
              await fs.rename(absPath, newPath);
              finalPath = newPath;
              ext = ctExt;
              fileName = path.basename(newPath);
            } catch (err) {
              logger.warn?.('unsplash_search:rename_failed', { label: 'PLUGIN', index: i + 1, photoId, source: photoSource, error: String(err?.message || err) });
            }
          }
          logger.info?.('unsplash_search:download_done', { label: 'PLUGIN', index: i + 1, photoId, source: photoSource, sizeMB: (size / 1024 / 1024).toFixed(2) });
          
          return {
            path: finalPath,
            path_markdown: toMarkdownPath(finalPath),
            size,
            contentType,
            photoId,
            source: photoSource,
            author: photo.user?.name || 'Unknown',
            author_url: photo.user?.links?.html || '',
            download_location: photo.links?.download_location || '',
          };
        } catch (e) {
          logger.warn?.('unsplash_search:download_failed', { label: 'PLUGIN', index: i + 1, photoId, source: photoSource, error: String(e?.message || e) });
          return null;
        }
      };
    });
    
    // 并发执行下载任务（分批限流）
    const files = [];
    for (let i = 0; i < downloadTasks.length; i += concurrency) {
      const batch = downloadTasks.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(task => task()));
      files.push(...results.filter(Boolean));
    }
    
    if (!files.length) return { success: false, code: 'DOWNLOAD_FAILED', error: '所有图片下载失败' };
    
    // 触发 Unsplash 下载统计（API 要求）
    for (const file of files) {
      if (file.download_location) {
        try {
          await fetchWithTimeout(file.download_location, { headers: { ...headers, Authorization: `Client-ID ${accessKey}` } }, 5000);
        } catch {}
      }
    }
    
    // 统计下载文件的来源
    const downloadedSourceStats = files.reduce((acc, f) => {
      acc[f.source] = (acc[f.source] || 0) + 1;
      return acc;
    }, {});
    
    const data = {
      action: 'unsplash_search',
      query,
      requested_count: count,
      actual_count: finalCount,
      downloaded: files.length,
      sources: downloadedSourceStats,
      orientation: orientation || 'any',
      timestamp: new Date().toISOString(),
    };
    
    // 判断是否需要打包 zip
    if (files.length > zipThreshold) {
      logger.info?.('unsplash_search:step:create_zip', { label: 'PLUGIN', fileCount: files.length, threshold: zipThreshold });
      const zipName = `images_${query.replace(/\s+/g, '_')}_${sessionId}.zip`;
      const zipPath = path.join(baseAbs, zipName);
      const { size: zipSize } = await createZip(files, zipPath);
      logger.info?.('unsplash_search:step:create_zip_done', { label: 'PLUGIN', zipSizeMB: (zipSize / 1024 / 1024).toFixed(2) });
      
      const sourceInfo = Object.entries(downloadedSourceStats).map(([k, v]) => `${k}:${v}张`).join(', ');
      
      // zip 模式：只返回 zip 信息，不返回单个文件（避免误导）
      data.zip_path = zipPath;
      data.zip_path_markdown = toMarkdownPath(zipPath);
      data.zip_size = zipSize;
      data.status = 'OK_ZIPPED';
      data.summary = `成功搜索并下载 ${files.length} 张关于 "${query}" 的图片（${sourceInfo}），已打包为 zip 文件（${(zipSize / 1024 / 1024).toFixed(2)}MB）。`;
      data.notice = `图片已打包为 zip，请解压查看。不单独提供图片路径以避免误导。`;
    } else {
      // 直接模式：返回每个文件的详细信息
      data.files = files.map(f => ({
        path: f.path,
        path_markdown: f.path_markdown,
        size: f.size,
        contentType: f.contentType,
        source: f.source,
        author: f.author,
        author_url: f.author_url,
      }));
      data.status = 'OK_DIRECT';
      const sourceInfo = Object.entries(downloadedSourceStats).map(([k, v]) => `${k}:${v}张`).join(', ');
      data.summary = `成功搜索并下载 ${files.length} 张关于 "${query}" 的图片（${sourceInfo}），已保存至本地。`;
    }
    
    logger.info?.('unsplash_search:complete', { label: 'PLUGIN', status: data.status, fileCount: files.length });
    return { success: true, data };
    
  } catch (e) {
    logger.error?.('unsplash_search:error', { label: 'PLUGIN', error: String(e?.message || e), stack: e?.stack });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
