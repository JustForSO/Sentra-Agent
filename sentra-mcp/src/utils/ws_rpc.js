async function getWebSocketImpl() {
  if (typeof globalThis !== 'undefined' && typeof globalThis.WebSocket === 'function') {
    return globalThis.WebSocket;
  }
  try {
    const mod = await import('ws');
    return mod.WebSocket || mod.default || mod;
  } catch {}
  try {
    const mod = await import('undici');
    return mod.WebSocket;
  } catch {}
  return null;
}

function parseJsonSafe(s) { try { return JSON.parse(s); } catch { return null; } }

function buildDefaultMatcher(payload) {
  return (data) => {
    if (!data || data.type === 'welcome') return false;
    const rid = payload.requestId;
    if (typeof data.requestId === 'string' && rid && data.requestId === rid) return true;
    if (typeof data.echo === 'string' && rid && data.echo === rid) return true;
    const p = payload.path;
    if (data.path && p && data.path === p) return true;
    if (data.cmd && p && data.cmd === p) return true;
    if (data.action && p && data.action === p) return true;
    if (data.route && p && data.route === p) return true;
    return false;
  };
}

export default async function wsCall({ url, path, args = [], requestId, timeoutMs = 15000, match } = {}) {
  const WS = await getWebSocketImpl();
  if (!WS) throw new Error('WebSocket 客户端不可用，请安装 ws 或使用 Node 18+ 并启用 undici');

  const payload = { type: 'sdk', path, args, requestId, echo: requestId };
  const matcher = match || buildDefaultMatcher(payload);

  return new Promise((resolve, reject) => {
    let timer = null; let settled = false;
    let ws;
    try {
      ws = new WS(url);
    } catch (e) { reject(e); return; }

    const done = (err, res) => {
      if (settled) return; settled = true;
      try { if (timer) clearTimeout(timer); } catch {}
      try { ws && ws.close?.(); } catch {}
      if (err) return reject(err);
      resolve(res);
    };

    const onOpen = () => {
      try { ws.send(JSON.stringify(payload)); } catch (e) { done(e); }
    };
    const onMessage = (msg) => {
      try {
        const raw = typeof msg === 'string' ? msg : (msg?.data ? msg.data : (Buffer.isBuffer(msg) ? msg.toString('utf-8') : String(msg)));
        const data = parseJsonSafe(raw);
        if (!data) return; // ignore
        if (!matcher(data)) return; // not ours
        done(null, data);
      } catch (e) { /* ignore parse errors */ }
    };
    const onError = (e) => done(new Error(String(e?.message || e)));
    const onClose = () => { if (!settled) done(new Error('WebSocket 已关闭')); };

    if (ws.on) {
      ws.on('open', onOpen);
      ws.on('message', onMessage);
      ws.on('error', onError);
      ws.on('close', onClose);
    } else if (ws.addEventListener) {
      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    }

    timer = setTimeout(() => done(new Error('WebSocket 超时')), Math.max(1000, timeoutMs));
  });
}
