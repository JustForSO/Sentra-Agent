import wsCall from '../../src/utils/ws_rpc.js';

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'message.emojiLike';
  const requestId = String(args.requestId || `${path}-${Date.now()}`);
  
  const message_id = args.message_id;
  const emoji_id = args.emoji_id;
  
  // 参数校验
  if (!message_id) {
    return { success: false, code: 'INVALID', error: 'message_id 不能为空' };
  }
  if (!Number.isFinite(Number(emoji_id))) {
    return { success: false, code: 'INVALID', error: 'emoji_id 必须是有效的数字' };
  }
  
  // 调用 SDK（注意：NapCat API 只有 message_id 和 emoji_id 两个参数）
  const callArgs = [Number(message_id), Number(emoji_id)];
  
  try {
    const resp = await wsCall({ url, path, args: callArgs, requestId, timeoutMs });
    return { 
      success: true, 
      data: { 
        request: { type: 'sdk', path, args: callArgs, requestId }, 
        response: resp 
      } 
    };
  } catch (e) {
    return { 
      success: false, 
      code: 'WS_CALL_FAILED', 
      error: String(e?.message || e) 
    };
  }
}
