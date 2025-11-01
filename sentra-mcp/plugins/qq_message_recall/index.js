import wsCall from '../../src/utils/ws_rpc.js';

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'message.recall';
  const requestId = String(args.requestId || `${path}-${Date.now()}`);
  const message_id = Number(args.message_id);
  if (!Number.isFinite(message_id)) return { success: false, code: 'INVALID', error: 'message_id 不能为空' };
  const resp = await wsCall({ url, path, args: [message_id], requestId, timeoutMs });
  return { success: true, data: { request: { type: 'sdk', path, args: [message_id], requestId }, response: resp } };
}
