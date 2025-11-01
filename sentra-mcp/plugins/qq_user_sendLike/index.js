import wsCall from '../../src/utils/ws_rpc.js';

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'user.sendLike';
  const requestId = String(args.requestId || `${path}-${Date.now()}`);
  const user_id = Number(args.user_id);
  if (!Number.isFinite(user_id)) return { success: false, code: 'INVALID', error: 'user_id 不能为空' };
  const times = Number(args.times);
  if (!Number.isFinite(times)) return { success: false, code: 'INVALID', error: 'times 不能为空' };
  const resp = await wsCall({ url, path, args: [user_id, times], requestId, timeoutMs });
  return { success: true, data: { request: { type: 'sdk', path, args: [user_id, times], requestId }, response: resp } };
}
