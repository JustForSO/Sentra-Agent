import wsCall from '../../src/utils/ws_rpc.js';

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'system.setDiyOnlineStatus';
  const requestId = `${path}-${Date.now()}`;
  const payload = {};
  // face_id: required, number|string
  const hasFaceId = Object.prototype.hasOwnProperty.call(args, 'face_id');
  if (!hasFaceId) return { success: false, code: 'INVALID', error: 'face_id 为必填' };
  const fidRaw = args.face_id;
  const fidNum = Number(fidRaw);
  payload.face_id = Number.isFinite(fidNum) ? fidNum : String(fidRaw);
  // face_type: optional, number|string
  if (Object.prototype.hasOwnProperty.call(args, 'face_type')) {
    const ftRaw = args.face_type;
    const ftNum = Number(ftRaw);
    payload.face_type = Number.isFinite(ftNum) ? ftNum : String(ftRaw);
  }
  // wording: optional string
  if (Object.prototype.hasOwnProperty.call(args, 'wording')) {
    payload.wording = String(args.wording);
  }
  const resp = await wsCall({ url, path, args: [payload], requestId, timeoutMs });
  return { success: true, data: { request: { type: 'sdk', path, args: [payload], requestId }, response: resp } };
}
