export function ok(data = null, code = 'OK', extra = {}) {
  return { success: true, code, data, error: null, ...extra };
}

export function fail(error, code = 'ERR', extra = {}) {
  const msg = error instanceof Error ? error.message : String(error);
  const errObj = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: msg };
  return { success: false, code, data: null, error: errObj, ...extra };
}

export function wrap(fn) {
  return async (...args) => {
    try {
      const data = await fn(...args);
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  };
}

export default { ok, fail, wrap };
