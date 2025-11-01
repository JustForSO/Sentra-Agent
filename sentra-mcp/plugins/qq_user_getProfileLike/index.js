import wsCall from '../../src/utils/ws_rpc.js';

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'user.getProfileLike';
  const requestId = String(args.requestId || `${path}-${Date.now()}`);
  const resp = await wsCall({ url, path, args: [], requestId, timeoutMs });
  return { success: true, data: { request: { type: 'sdk', path, args: [], requestId }, response: resp } };
}
