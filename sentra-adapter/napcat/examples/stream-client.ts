/**
 * 消息流客户端示例
 * 演示如何连接到NapCat消息流服务并接收实时消息
 * 
 * 使用方法：
 * 1. 在 .env 中设置 ENABLE_STREAM=true
 * 2. 启动主程序 npm run dev
 * 3. 运行此客户端 npx tsx examples/stream-client.ts
 */

import WebSocket from 'ws';
import type { FormattedMessage } from '../src/stream';

// 消息流服务地址
const STREAM_URL = 'ws://localhost:6702';

// 创建WebSocket连接
const ws = new WebSocket(STREAM_URL);

ws.on('open', () => {
  console.log('✅ 已连接到消息流服务');
  
  // 发送心跳（可选）
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
});

ws.on('message', (data) => {
  try {
    const payload = JSON.parse(data.toString());
    
    // 欢迎消息
    if (payload.type === 'welcome') {
      console.log('📢 服务器消息:', payload.message);
      return;
    }
    
    // 心跳响应
    if (payload.type === 'pong') {
      console.log('💓 心跳响应');
      return;
    }
    
    // 关闭通知
    if (payload.type === 'shutdown') {
      console.log('⚠️ 服务器关闭:', payload.message);
      return;
    }
    
    // 消息推送
    if (payload.type === 'message' && payload.data) {
      const msg: FormattedMessage = payload.data;
      handleMessage(msg);
    }
  } catch (err) {
    console.error('❌ 解析消息失败:', err);
  }
});

ws.on('close', (code, reason) => {
  console.log(`🔌 连接已关闭 [${code}] ${reason}`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('❌ WebSocket错误:', err);
});

/**
 * 处理接收到的消息
 * 这里可以根据需要进行自定义处理
 */
function handleMessage(msg: FormattedMessage) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // 方式1：直接打印Markdown格式的摘要（推荐，简洁可读）
  console.log('\n📋 消息摘要 (Markdown):');
  console.log(msg.summary);
  
  console.log('\n' + '─'.repeat(44));
  
  // 方式2：详细的结构化输出（调试用）
  console.log('\n📊 详细信息:');
  
  // 基础信息
  if (msg.type === 'group') {
    console.log(`📨 群聊消息 [${msg.group_name || msg.group_id}]`);
    console.log(`👤 ${msg.sender_name}${msg.sender_card ? ` (${msg.sender_card})` : ''} [${msg.sender_role}]`);
  } else {
    console.log(`💬 私聊消息`);
    console.log(`👤 ${msg.sender_name} (${msg.sender_id})`);
  }
  
  console.log(`🕐 ${msg.time_str}`);
  console.log(`📝 ${msg.text || '(无文本)'}`);
  
  // 引用消息
  if (msg.reply) {
    console.log(`\n🔗 引用消息 [${msg.reply.id}]:`);
    console.log(`   ${msg.reply.text}`);
    
    const media = msg.reply.media;
    if (media.images.length) {
      console.log(`   📷 图片: ${media.images.length}张`);
    }
    if (media.videos.length) {
      console.log(`   🎥 视频: ${media.videos.length}个`);
    }
    if (media.files.length) {
      console.log(`   📄 文件: ${media.files.length}个`);
    }
    if (media.records.length) {
      console.log(`   🎤 语音: ${media.records.length}个`);
    }
    if (media.forwards.length) {
      console.log(`   📋 转发: ${media.forwards.length}个`);
      media.forwards.forEach((fwd, i) => {
        console.log(`      #${i+1} ${fwd.count}条消息`);
        if (fwd.preview && fwd.preview.length) {
          fwd.preview.forEach(p => console.log(`         ${p}`));
        }
      });
    }
  }
  
  // 多媒体
  if (msg.images.length > 0) {
    console.log(`\n📷 图片 (${msg.images.length}):`);
    msg.images.forEach((img, i) => {
      console.log(`   #${i+1} ${img.file || img.url}`);
    });
  }
  
  if (msg.videos.length > 0) {
    console.log(`\n🎥 视频 (${msg.videos.length}):`);
    msg.videos.forEach((vid, i) => {
      console.log(`   #${i+1} ${vid.file || vid.url}`);
    });
  }
  
  if (msg.files.length > 0) {
    console.log(`\n📄 文件 (${msg.files.length}):`);
    msg.files.forEach((file, i) => {
      console.log(`   #${i+1} ${file.name} (${file.size})`);
      if (file.url) console.log(`      ${file.url}`);
    });
  }
  
  if (msg.records.length > 0) {
    console.log(`\n🎤 语音 (${msg.records.length}):`);
    msg.records.forEach((rec, i) => {
      console.log(`   #${i+1} ${rec.file || rec.url}`);
    });
  }
  
  // @提及
  if (msg.at_all) {
    console.log('\n📣 @全体成员');
  } else if (msg.at_users.length > 0) {
    console.log(`\n👥 @了 ${msg.at_users.length} 人: ${msg.at_users.join(', ')}`);
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n👋 正在关闭客户端...');
  ws.close();
});
