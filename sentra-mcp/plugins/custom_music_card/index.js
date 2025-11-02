import logger from '../../src/logger/index.js';
import wsCall from '../../src/utils/ws_rpc.js';

/**
 * 构建自定义音乐卡片 segments
 * @param {Object} params - 卡片参数
 * @param {string} params.url - 点击跳转链接
 * @param {string} params.audio - 音频/视频播放链接
 * @param {string} params.title - 卡片标题
 * @param {string} params.image - 封面图片链接
 * @returns {Array} segments
 */
function buildCustomMusicCardSegments({ url, audio, title, image }) {
  return [{
    type: 'music',
    data: {
      type: 'custom',
      url: String(url || ''),
      audio: String(audio || ''),
      title: String(title || ''),
      image: String(image || '')
    }
  }];
}

/**
 * 通过 WebSocket 发送自定义音乐卡片
 * @param {Object} wsConfig - WebSocket配置
 * @param {string} wsConfig.wsUrl - WebSocket地址
 * @param {number} wsConfig.timeoutMs - 超时时间
 * @param {Array<string>} wsConfig.pathList - 发送路径列表
 * @param {string} wsConfig.argStyle - 参数风格（pair/object）
 * @param {Object} target - 发送目标
 * @param {string} target.user_id - 私聊用户ID
 * @param {string} target.group_id - 群聊群ID
 * @param {Array} segments - 消息segments
 * @returns {Promise<Object>} 发送结果
 */
async function sendMusicCardViaWS({ wsUrl, timeoutMs, pathList, argStyle }, target, segments) {
  const { user_id, group_id } = target;
  const filteredTarget = user_id ? { user_id } : { group_id };
  const requestIdBase = `custom-music-${(user_id ? 'private' : 'group')}-${Date.now()}`;

  for (const path of pathList) {
    const requestId = `${path}-${requestIdBase}`;
    const args = (argStyle === 'pair')
      ? (user_id ? [Number(user_id), segments] : [Number(group_id), segments])
      : [{ ...filteredTarget, message: segments }];
    
    try {
      logger.info?.('custom_music_card:ws_send_attempt', { 
        label: 'PLUGIN', 
        path, 
        target: user_id ? 'private' : 'group',
        targetId: user_id || group_id 
      });
      
      const resp = await wsCall({ url: wsUrl, path, args, requestId, timeoutMs });
      
      logger.info?.('custom_music_card:ws_send_success', { 
        label: 'PLUGIN', 
        path,
        responseCode: resp?.retcode || resp?.code
      });
      
      return { ok: true, path, args, resp };
    } catch (e) {
      logger.warn?.('custom_music_card:ws_send_failed', { 
        label: 'PLUGIN', 
        path, 
        error: String(e?.message || e) 
      });
    }
  }
  
  return { ok: false };
}

/**
 * 自定义音乐卡片插件处理函数
 * @param {Object} args - 插件参数
 * @param {string} args.media_url - 音频/视频在线链接（必需）
 * @param {string} args.title - 卡片标题（必需）
 * @param {string} args.jump_url - 点击跳转链接（可选）
 * @param {string} args.cover_url - 封面图片链接（可选）
 * @param {string} args.user_id - 私聊用户ID（与group_id二选一）
 * @param {string} args.group_id - 群聊群ID（与user_id二选一）
 * @param {Object} options - 插件选项
 * @returns {Promise<Object>} 执行结果
 */
export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  
  const media_url = String(args.media_url || '').trim();
  const title = String(args.title || '').trim();
  
  if (!media_url) {
    return { 
      success: false, 
      code: 'INVALID_MEDIA_URL', 
      error: 'media_url 为必填参数，需要提供音频或视频的在线链接（MP3/MP4等）' 
    };
  }
  
  if (!title) {
    return { 
      success: false, 
      code: 'INVALID_TITLE', 
      error: 'title 为必填参数，需要提供卡片标题' 
    };
  }
  
  const user_id = args.user_id;
  const group_id = args.group_id;
  
  if (!user_id && !group_id) {
    return { 
      success: false, 
      code: 'TARGET_REQUIRED', 
      error: '必须提供 user_id（私聊）或 group_id（群聊）' 
    };
  }
  
  if (user_id && group_id) {
    return { 
      success: false, 
      code: 'TARGET_EXCLUSIVE', 
      error: 'user_id 与 group_id 只能二选一' 
    };
  }

  const jump_url = String(args.jump_url || '').trim() || media_url; // 默认跳转到media_url
  const cover_url = String(args.cover_url || '').trim() 
    || String(penv.DEFAULT_COVER_URL || process.env.DEFAULT_COVER_URL || '').trim()
    || 'https://filesystem.site/cdn/20251003/lSl1Vi7WNkZzBm6lNJ3LxvxkaHJ77M.png'; // 默认封面
  
  // WebSocket 配置
  const wsUrl = String(penv.WS_SDK_URL || process.env.WS_SDK_URL || 'ws://127.0.0.1:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || process.env.WS_SDK_TIMEOUT_MS || 15000));
  const argStyle = String(penv.WS_SDK_ARG_STYLE || process.env.WS_SDK_ARG_STYLE || 'pair');
  const pathMain = String(penv.WS_SDK_SEND_PATH || process.env.WS_SDK_SEND_PATH || '').trim();
  const pathPri = String(penv.WS_SDK_SEND_PATH_PRIVATE || process.env.WS_SDK_SEND_PATH_PRIVATE || 'send.private');
  const pathGrp = String(penv.WS_SDK_SEND_PATH_GROUP || process.env.WS_SDK_SEND_PATH_GROUP || 'send.group');
  
  try {
    logger.info?.('custom_music_card:start', { 
      label: 'PLUGIN', 
      title: title.slice(0, 50), 
      media_url: media_url.slice(0, 100),
      target: user_id ? 'private' : 'group',
      targetId: user_id || group_id
    });
    
    const segments = buildCustomMusicCardSegments({
      url: jump_url,      // 点击跳转链接
      audio: media_url,   // 音频/视频播放链接
      title: title,       // 卡片标题
      image: cover_url    // 封面图片
    });
    
    logger.info?.('custom_music_card:segments_built', { 
      label: 'PLUGIN',
      segmentsCount: segments.length,
      type: segments[0]?.type,
      dataType: segments[0]?.data?.type
    });

    const pathList = [pathMain, (user_id ? pathPri : pathGrp)].filter((v, i, a) => !!v && a.indexOf(v) === i);
    
    logger.info?.('custom_music_card:sending', { 
      label: 'PLUGIN',
      pathList,
      argStyle,
      wsUrl
    });
    
    const sendRes = await sendMusicCardViaWS(
      { wsUrl, timeoutMs, pathList, argStyle },
      { user_id, group_id },
      segments
    );
    
    if (sendRes.ok) {
      const result = {
        success: true,
        data: {
          action: 'custom_music_card',
          发送对象: user_id ? '私聊' : '群聊',
          目标: user_id || group_id,
          卡片标题: title,
          媒体链接: media_url,
          跳转链接: jump_url,
          封面链接: cover_url,
          发送路径: sendRes.path,
          参数风格: argStyle,
          segments: segments,
          response: sendRes.resp,
          timestamp: new Date().toISOString()
        }
      };
      
      logger.info?.('custom_music_card:complete', { 
        label: 'PLUGIN',
        success: true,
        target: result.data.发送对象,
        targetId: result.data.目标
      });
      
      return result;
    } else {
      logger.warn?.('custom_music_card:send_all_failed', { 
        label: 'PLUGIN',
        triedPaths: pathList.length
      });
      
      return { 
        success: false, 
        code: 'SEND_FAILED', 
        error: `发送音乐卡片失败（尝试了 ${pathList.length} 个WebSocket路径均失败）`,
        details: {
          title,
          media_url,
          target: user_id ? 'private' : 'group',
          targetId: user_id || group_id,
          triedPaths: pathList
        }
      };
    }
  } catch (e) {
    logger.error?.('custom_music_card:error', { 
      label: 'PLUGIN', 
      error: String(e?.message || e),
      stack: e?.stack
    });
    
    return { 
      success: false, 
      code: 'ERR', 
      error: String(e?.message || e) 
    };
  }
}
