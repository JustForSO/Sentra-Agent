import wsCall from '../../src/utils/ws_rpc.js';

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'system.setModelShow';
  const requestId = String(args.requestId || `${path}-${Date.now()}`);
  const model = String(args.model || '');
  const model_show = String(args.model_show || '');
  if (!model) return { success: false, code: 'INVALID', error: 'model 不能为空' };
  if (!model_show) return { success: false, code: 'INVALID', error: 'model_show 不能为空' };
  const payloadArgs = [{ model, model_show }];
  const resp = await wsCall({ url, path, args: payloadArgs, requestId, timeoutMs });
  return { success: true, data: { request: { type: 'sdk', path, args: payloadArgs, requestId }, response: resp } };
}
