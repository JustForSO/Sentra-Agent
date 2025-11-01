import wsCall from '../../src/utils/ws_rpc.js';

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'account.setQQProfile';
  const requestId = `${path}-${Date.now()}`;
  const payload = {};
  if (args.nickname !== undefined) payload.nickname = String(args.nickname);
  if (args.personal_note !== undefined) payload.personal_note = String(args.personal_note);
  if (args.sex !== undefined) {
    const sx = String(args.sex);
    if (sx === '0' || sx === '1' || sx === '2') payload.sex = sx; else {
      return { success: false, code: 'INVALID', error: 'sex 仅允许 "0"|"1"|"2"' };
    }
  }
  if (!('nickname' in payload) && !('personal_note' in payload) && !('sex' in payload)) {
    return { success: false, code: 'INVALID', error: '至少提供 nickname/personal_note/sex 其中一个' };
  }
  const resp = await wsCall({ url, path, args: [payload], requestId, timeoutMs });
  return { success: true, data: { request: { type: 'sdk', path, args: [payload], requestId }, response: resp } };
}
