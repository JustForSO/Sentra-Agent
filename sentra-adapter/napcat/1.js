require('dotenv/config');
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:6702');

let seq = 1;
const send = (obj) => ws.send(JSON.stringify(obj));
const rpcInvoke = (action, params = {}, call = 'ok') => {
  const requestId = `req-${Date.now()}-${seq++}`;
  send({ type: 'invoke', call, action, params, requestId });
  console.log('>> invoke', call, action, params, requestId);
  return requestId;
};
const rpcSdk = (path, ...args) => {
  const requestId = `req-${Date.now()}-${seq++}`;
  send({ type: 'sdk', path, args, requestId });
  console.log('>> sdk', path, args, requestId);
  return requestId;
};

ws.on('open', () => {
  console.log('已连接到Sentra-Napcat适配器');
  // 心跳
  setInterval(() => send({ type: 'ping' }), 30000);

  // 基础读取类测试
  setTimeout(() => {
    rpcInvoke('get_login_info');
    rpcSdk('system.versionInfo');
    rpcSdk('system.status');
  }, 300);

  // 如需测试发送，请在 .env 配置 TEST_USER_ID / TEST_GROUP_ID
  const uid = parseInt(process.env.TEST_USER_ID || '');
  const gid = parseInt(process.env.TEST_GROUP_ID || '');
  if (Number.isFinite(uid)) {
    setTimeout(() => {
      ws.send(JSON.stringify({
        "type": "sdk",
        "path": "send.private",
        "args": [
          2166683295,
          [
            { "type": "text", "data": { "text": "看这张图" } },
            { "type": "image", "data": { "file": "D:/comfyui-api/downloads/ComfyUi_002ab1d4-daf4-48f2-8e15-828462443718.webp" } }
          ]
        ],
        "requestId": "send-private-2"
      }))
      ws.send(JSON.stringify({
        "type": "sdk",
        "path": "file.uploadPrivate",
        "args": [2166683295, "E:/sentra-agent/sentra-adapter/napcat/tsconfig.json", "文档.json"],
        "requestId": "file-upload-private-1"
      }))
      rpcSdk('send.private', uid, '来自流RPC的私聊测试消息');
    }, 800);
  }
  if (Number.isFinite(gid)) {
    setTimeout(() => {
      rpcSdk('send.group', gid, '来自流RPC的群聊测试消息');
    }, 1100);
  }
});

ws.on('message', (data) => {
  try {
    const payload = JSON.parse(data.toString());
    if (payload.type === 'welcome') {
      console.log('欢迎:', payload.message);
      return;
    }
    if (payload.type === 'pong') {
      console.log('心跳响应');
      return;
    }
    if (payload.type === 'shutdown') {
      console.log('服务器关闭:', payload.message);
      return;
    }
    if (payload.type === 'result') {
      console.log('<< result', payload.requestId, payload.ok ? 'OK' : 'ERR', payload.ok ? payload.data : payload.error);
      return;
    }
    if (payload.type === 'message') {
      const msg = payload.data;
      console.log('<< message');
      console.log(msg);
      return;
    }
  } catch (e) {
    console.error('解析消息失败:', e);
  }
});