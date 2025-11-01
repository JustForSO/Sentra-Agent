export async function withTimeout(promise, ms, onTimeout) {
  let timer;
  const cleanup = () => clearTimeout(timer);
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {}
      reject(new Error(`Timeout after ${ms} ms`));
    }, ms);
  });
  try {
    const res = await Promise.race([promise, timeoutPromise]);
    cleanup();
    return res;
  } catch (e) {
    cleanup();
    throw e;
  }
}

export default { withTimeout };
