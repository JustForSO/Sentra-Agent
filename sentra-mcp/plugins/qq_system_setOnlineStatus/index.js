import wsCall from '../../src/utils/ws_rpc.js';

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'system.setOnlineStatus';
  const requestId = `${path}-${Date.now()}`;
  const sraw = args.status;
  const eraw = (args.ext_status !== undefined) ? args.ext_status : args.extStatus;
  const braw = (args.battery_status !== undefined) ? args.battery_status : args.batteryStatus;
  const status = Number(sraw);
  const ext_status = Number(eraw);
  const battery_status = Number(braw);
  if (!Number.isFinite(status)) return { success: false, code: 'INVALID', error: 'status 为必填，需为整数' };
  if (!Number.isFinite(ext_status)) return { success: false, code: 'INVALID', error: 'ext_status 为必填，需为整数' };
  if (!Number.isFinite(battery_status)) return { success: false, code: 'INVALID', error: 'battery_status 为必填，需为整数' };
  const argsArr = [{ status, ext_status, battery_status }];
  const resp = await wsCall({ url, path, args: argsArr, requestId, timeoutMs });
  return { success: true, data: { request: { type: 'sdk', path, args: argsArr, requestId }, response: resp } };
}
