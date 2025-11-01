import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../src/logger/index.js';

// In-memory cache: Map<userId, { expireAt:number, data:any }>
const memCache = new Map();
const TTL_SEC = 1800; // 30 minutes

function now() { return Date.now(); }

function getCacheDir() { return path.resolve(process.cwd(), 'cache', 'qq_avatar_get'); }
async function ensureCacheDir() { await fs.mkdir(getCacheDir(), { recursive: true }); }
function getCacheFilePath(userId) {
  const safe = String(userId).replace(/[^\w,-]/g, '_');
  return path.join(getCacheDir(), `${safe}.json`);
}

async function readFileCache(userId) {
  try {
    const p = getCacheFilePath(userId);
    const txt = await fs.readFile(p, 'utf-8');
    const cached = JSON.parse(txt);
    if (cached.expireAt && Number(cached.expireAt) > now()) return cached.data || null;
    return null;
  } catch { return null; }
}

async function writeFileCache(userId, data, ttlSec) {
  try {
    await ensureCacheDir();
    const p = getCacheFilePath(userId);
    const obj = { expireAt: now() + ttlSec * 1000, data, cachedAt: new Date().toISOString() };
    await fs.writeFile(p, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {
    logger.warn?.('qq_avatar_get:write_cache_failed', { label: 'PLUGIN', error: String(e?.message || e) });
  }
}

function getFromMem(userId) {
  const v = memCache.get(String(userId));
  if (v && v.expireAt > now()) return v.data;
  return null;
}
function setToMem(userId, data, ttlSec) {
  memCache.set(String(userId), { expireAt: now() + ttlSec * 1000, data });
}

function buildAvatarUrl(userId) {
  const uid = encodeURIComponent(String(userId));
  return `http://q.qlogo.cn/headimg_dl?dst_uin=${uid}&spec=640&img_type=jpg`;
}

async function downloadToArtifacts(userId) {
  const url = buildAvatarUrl(userId);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  const baseDir = 'artifacts';
  await fs.mkdir(baseDir, { recursive: true });
  const name = `qq_avatar_${String(userId).replace(/[^\w-]/g, '_')}.jpg`;
  const abs = path.resolve(baseDir, name);
  await fs.writeFile(abs, buf);
  return abs.replace(/\\/g, '/');
}

export default async function handler(args = {}, options = {}) {
  const userIdRaw = args.user_id;
  const userId = String(userIdRaw ?? '').trim();
  if (!userId) return { success: false, code: 'INVALID', error: 'user_id is required' };
  const useCache = args.useCache !== false; // default true

  // Try memory cache
  if (useCache) {
    const cached = getFromMem(userId);
    if (cached && cached.path_absolute) {
      return { success: true, cached: true, data: { user_id: userId, content: `![avatar](${cached.path_absolute})`, path_absolute: cached.path_absolute, path_markdown: `![avatar](${cached.path_absolute})` } };
    }
  }

  // Try file cache
  if (useCache) {
    const cached = await readFileCache(userId);
    if (cached && cached.path_absolute) {
      // backfill memory cache
      setToMem(userId, cached, TTL_SEC);
      return { success: true, cached: true, data: { user_id: userId, content: `![avatar](${cached.path_absolute})`, path_absolute: cached.path_absolute, path_markdown: `![avatar](${cached.path_absolute})` } };
    }
  }

  // Download fresh
  try {
    const abs = await downloadToArtifacts(userId);
    const data = { user_id: userId, path_absolute: abs };
    if (useCache) {
      setToMem(userId, data, TTL_SEC);
      await writeFileCache(userId, data, TTL_SEC);
    }
    return { success: true, data: { user_id: userId, content: `![avatar](${abs})`, path_absolute: abs, path_markdown: `![avatar](${abs})` } };
  } catch (e) {
    logger.warn?.('qq_avatar_get:download_failed', { label: 'PLUGIN', error: String(e?.message || e) });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
