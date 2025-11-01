import { withTimeout } from './timeout.js';

export async function executeToolWithTimeout(fn, ms, options = {}) {
  // fn should be a function returning a promise
  const onTimeout = options.onTimeout;
  const p = Promise.resolve().then(() => fn());
  return withTimeout(p, ms, onTimeout);
}

export default { executeToolWithTimeout };
