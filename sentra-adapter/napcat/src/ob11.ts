import type { OneBotResponse } from './types/onebot';

export function isOk<T = any>(res: OneBotResponse<T>): boolean {
  // OneBot 11 通常 retcode = 0 代表成功，但也有实现仅依赖 status
  return res.status === 'ok' && (res.retcode === 0 || typeof res.retcode !== 'number');
}

export function assertOk<T = any>(res: OneBotResponse<T>): OneBotResponse<T> {
  if (!isOk(res)) {
    const msg = res.message || `OneBot action failed (retcode=${res.retcode})`;
    throw new Error(msg);
  }
  return res;
}

export function dataOrThrow<T = any>(res: OneBotResponse<T>): T {
  return assertOk(res).data as T;
}
