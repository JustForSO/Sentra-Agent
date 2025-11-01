/**
 * Sentra Agent 基础示例
 * 演示如何使用集成后的 Agent 系统
 */

import { Agent } from '../src/agent.js';
import 'dotenv/config';

async function basicExample() {
  console.log('🌟 Sentra Agent 基础示例\n');
  console.log('=' .repeat(60));

  // 1. 创建 Agent 实例
  console.log('\n📦 步骤1: 创建 Agent 实例...');
  const agent = new Agent({
    conversationId: 'example_conv_001',
    userId: 'example_user'
  });

  try {
    // 2. 初始化 Agent
    console.log('\n🚀 步骤2: 初始化 Agent...');
    await agent.initialize();

    // 3. 添加系统提示词
    console.log('\n📝 步骤3: 设置系统提示词...');
    agent.addSystemMessage(`你是一个智能助手，当前时间是 {{time}}，今天是 {{date}}。
请根据用户的问题，结合历史记忆提供准确的回答。`);

    // 4. 进行对话
    console.log('\n💬 步骤4: 开始对话...');
    console.log('=' .repeat(60));

    // 第一轮对话
    console.log('\n👤 用户: 你好，请介绍一下你自己');
    const response1 = await agent.chat('你好，请介绍一下你自己');
    console.log('\n🤖 助手:', response1.response);
    console.log('\n📊 元数据:', JSON.stringify(response1.metadata, null, 2));

    // 第二轮对话
    console.log('\n' + '=' .repeat(60));
    console.log('\n👤 用户: 今天天气怎么样？');
    const response2 = await agent.chat('今天天气怎么样？');
    console.log('\n🤖 助手:', response2.response);

    // 第三轮对话
    console.log('\n' + '=' .repeat(60));
    console.log('\n👤 用户: 帮我总结一下我们刚才聊了什么');
    const response3 = await agent.chat('帮我总结一下我们刚才聊了什么');
    console.log('\n🤖 助手:', response3.response);

    // 5. 查看 Agent 信息
    console.log('\n' + '=' .repeat(60));
    console.log('\n📊 Agent 信息:');
    const info = agent.getInfo();
    console.log(JSON.stringify(info, null, 2));

    // 6. 查看对话历史
    console.log('\n📜 对话历史:');
    const history = agent.getHistory();
    console.log(`共 ${history.length} 条消息`);
    history.forEach((msg, idx) => {
      console.log(`  ${idx + 1}. [${msg.role}] ${msg.content.substring(0, 50)}...`);
    });

  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    console.error(error.stack);
  } finally {
    // 7. 关闭 Agent
    console.log('\n🔌 关闭 Agent...');
    await agent.close();
  }

  console.log('\n✅ 示例运行完成！');
  console.log('=' .repeat(60));
}

// 运行示例
basicExample().catch(console.error);
