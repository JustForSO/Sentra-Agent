import wsCall from '../../src/utils/ws_rpc.js';

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'account.setQQAvatar';
  const requestId = `${path}-${Date.now()}`;
  const file = String(args.file || '');
  if (!file) return { success: false, code: 'INVALID', error: 'file 不能为空' };
  const resp = await wsCall({ url, path, args: [{ file }], requestId, timeoutMs });
  return { success: true, data: { request: { type: 'sdk', path, args: [{ file }], requestId }, response: resp } };
}
