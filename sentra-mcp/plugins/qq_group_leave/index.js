import wsCall from '../../src/utils/ws_rpc.js';

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'group.leave';
  const requestId = String(args.requestId || `${path}-${Date.now()}`);
  const group_id = Number(args.group_id);
  if (!Number.isFinite(group_id)) return { success: false, code: 'INVALID', error: 'group_id 不能为空' };
  const dismiss = typeof args.dismiss === 'boolean' ? args.dismiss : false;
  const resp = await wsCall({ url, path, args: [group_id, dismiss], requestId, timeoutMs });
  return { success: true, data: { request: { type: 'sdk', path, args: [group_id, dismiss], requestId }, response: resp } };
}
