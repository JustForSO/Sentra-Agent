/**
 * 简化版消息流客户端
 * 仅显示 summary 字段（Markdown格式的消息摘要）
 * 
 * 使用方法：
 * 1. 在 .env 中设置 ENABLE_STREAM=true
 * 2. 启动主程序 npm run dev
 * 3. 运行此客户端 npx tsx examples/stream-simple.ts
 */

import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:6702');

ws.on('open', () => {
  console.log('✅ 已连接到消息流服务\n');
});

ws.on('message', (data) => {
  try {
    const payload = JSON.parse(data.toString());
    
    if (payload.type === 'welcome') {
      console.log(`📢 ${payload.message}\n`);
      return;
    }
    
    if (payload.type === 'message' && payload.data) {
      // 直接打印 Markdown 格式的摘要
      console.log(payload.data.summary);
      console.log(''); // 空行分隔
    }
  } catch (err) {
    console.error('❌ 解析消息失败:', err);
  }
});

ws.on('close', (code, reason) => {
  console.log(`\n🔌 连接已关闭 [${code}] ${reason}`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('❌ WebSocket错误:', err);
});

// 心跳（可选）
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n👋 正在关闭客户端...');
  ws.close();
});
