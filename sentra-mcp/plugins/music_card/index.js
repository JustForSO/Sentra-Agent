import logger from '../../src/logger/index.js';
import wsCall from '../../src/utils/ws_rpc.js';

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

function pickOne(arr, idx, random) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (random) return arr[Math.floor(Math.random() * arr.length)];
  const i = toInt(idx) ?? 0;
  return arr[Math.max(0, Math.min(arr.length - 1, i))];
}

async function searchMusic163(keyword, limit = 6) {
  const url = `http://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&offset=0&total=true&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`163 search HTTP ${res.status}`);
  const json = await res.json();
  const songs = json?.result?.songs || [];
  return songs.map((s) => ({
    id: s.id,
    name: s.name,
    artists: Array.isArray(s.artists) ? s.artists.map((a) => a?.name).filter(Boolean).join('&') : '',
    alias: Array.isArray(s.alias) && s.alias.length ? s.alias.join(',') : 'none',
  }));
}

async function getMusicUrl163(ids, musicUCookie = '') {
  let url = `http://music.163.com/song/media/outer/url?id=${ids}`;
  if (!musicUCookie) return url; // 无 COOKIE 直接返回外链（通常会302到实际地址）
  const body = `ids=${encodeURIComponent(JSON.stringify([ids]))}&level=standard&encodeType=mp3`;
  const res = await fetch('https://music.163.com/api/song/enhance/player/url/v1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12; MI Build/SKQ1.211230.001)',
      'Cookie': `versioncode=8008070; os=android; channel=xiaomi; appver=8.8.70; MUSIC_U=${musicUCookie}`,
    },
    body,
  });
  if (!res.ok) return url;
  const json = await res.json().catch(() => ({}));
  const u = json?.data?.[0]?.url;
  return u || url;
}

function buildSegmentsMusic(provider, id) {
  return [{ type: 'music', data: { type: String(provider), id: String(id) } }];
}

function buildSegmentsRecord(url) {
  return [{ type: 'record', data: { file: String(url) } }];
}

async function sendViaWS({ url, timeoutMs, pathList, argStyle }, target, segments) {
  const { user_id, group_id } = target;
  const filteredTarget = user_id ? { user_id } : { group_id };
  const requestIdBase = `${(user_id ? 'private' : 'group')}-${Date.now()}`;

  for (const path of pathList) {
    const requestId = `${path}-${requestIdBase}`;
    const args = (argStyle === 'pair')
      ? (user_id ? [Number(user_id), segments] : [Number(group_id), segments])
      : [{ ...filteredTarget, message: segments }];
    try {
      const resp = await wsCall({ url, path, args, requestId, timeoutMs });
      // 返回即认为调用成功，交由上层判定业务字段
      return { ok: true, path, args, resp };
    } catch (e) {
      logger.warn?.('music_card:ws_send_failed', { label: 'PLUGIN', path, error: String(e?.message || e) });
    }
  }
  return { ok: false };
}

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const keyword = String(args.keyword || '').trim();
  if (!keyword) return { success: false, code: 'INVALID', error: 'keyword 为必填参数' };

  const provider = String(args.provider || '163').trim();
  if (provider !== '163') return { success: false, code: 'UNSUPPORTED', error: '仅支持 provider=163（网易云）' };

  const user_id = args.user_id;
  const group_id = args.group_id;
  if (!user_id && !group_id) return { success: false, code: 'TARGET_REQUIRED', error: '必须提供 user_id（私聊）或 group_id（群聊）' };
  if (user_id && group_id) return { success: false, code: 'TARGET_EXCLUSIVE', error: 'user_id 与 group_id 只能二选一' };

  const defaultLimit = toInt(penv.MUSIC163_SEARCH_LIMIT || process.env.MUSIC163_SEARCH_LIMIT) ?? 6;
  const limit = Math.max(1, Math.min(10, toInt(args.limit) ?? defaultLimit));
  const random = typeof args.random === 'boolean' ? args.random : true;
  const pick = args.pick;

  const wsUrl = String(penv.WS_SDK_URL || process.env.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || process.env.WS_SDK_TIMEOUT_MS || 15000));
  const argStyle = String(penv.WS_SDK_ARG_STYLE || process.env.WS_SDK_ARG_STYLE || 'pair'); // 'object' | 'pair'
  const pathMain = String(penv.WS_SDK_SEND_PATH || process.env.WS_SDK_SEND_PATH || '').trim();
  const pathPri = String(penv.WS_SDK_SEND_PATH_PRIVATE || process.env.WS_SDK_SEND_PATH_PRIVATE || 'send.private');
  const pathGrp = String(penv.WS_SDK_SEND_PATH_GROUP || process.env.WS_SDK_SEND_PATH_GROUP || 'send.group');

  try {
    const list = await searchMusic163(keyword, limit);
    if (!list.length) return { success: false, code: 'NOT_FOUND', error: '未找到相关的音乐' };
    const chosen = pickOne(list, pick, random);

    const segments = buildSegmentsMusic(provider, chosen.id);
    const pathList = [pathMain, (user_id ? pathPri : pathGrp)].filter((v, i, a) => !!v && a.indexOf(v) === i);
    const sendRes = await sendViaWS({ url: wsUrl, timeoutMs, pathList, argStyle }, { user_id, group_id }, segments);
    if (sendRes.ok) {
      return { success: true, data: { 发送对象: user_id ? '私聊' : '群聊', 目标: user_id || group_id, 平台: provider, 歌曲: chosen, request: { pathTried: pathList, argStyle, segments }, response: sendRes.resp } };
    }

    if (args.fallback_to_record) {
      const musicU = String(penv.MUSIC163_COOKIE_MUSIC_U || process.env.MUSIC163_COOKIE_MUSIC_U || '').trim();
      const playUrl = await getMusicUrl163(chosen.id, musicU);
      if (playUrl) {
        const fbSeg = buildSegmentsRecord(playUrl);
        const fbRes = await sendViaWS({ url: wsUrl, timeoutMs, pathList, argStyle }, { user_id, group_id }, fbSeg);
        if (fbRes.ok) {
          return { success: true, data: { 发送对象: user_id ? '私聊' : '群聊', 目标: user_id || group_id, 提示: '音乐卡片发送失败，已回退发送音频直链', 歌曲: chosen, request: { pathTried: pathList, argStyle, segments: fbSeg }, response: fbRes.resp } };
        }
      }
    }

    return { success: false, code: 'SEND_FAILED', error: '发送音乐卡片失败（WS）' };
  } catch (e) {
    logger.warn?.('music_card:error', { label: 'PLUGIN', error: String(e?.message || e) });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
