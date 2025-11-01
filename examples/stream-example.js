/**
 * Sentra Agent 流式对话示例
 * 演示如何使用流式 API 实时获取处理进度
 */

import { Agent } from '../src/agent.js';
import 'dotenv/config';

async function streamExample() {
  console.log('🌊 Sentra Agent 流式对话示例\n');
  console.log('=' .repeat(60));

  const agent = new Agent({
    conversationId: 'stream_example_001',
    userId: 'stream_user'
  });

  try {
    // 初始化
    await agent.initialize();

    // 设置系统提示词
    agent.addSystemMessage('你是一个智能助手，当前时间是 {{time}}。');

    // 流式对话
    console.log('\n💬 开始流式对话...');
    console.log('👤 用户: 请帮我分析一下人工智能的发展趋势\n');

    console.log('🔄 处理流程:\n');

    for await (const event of agent.chatStream('请帮我分析一下人工智能的发展趋势')) {
      // 根据不同的事件类型显示不同的信息
      switch (event.type) {
        case 'start':
          console.log('🚀 开始处理...');
          break;

        case 'segmentation':
          if (event.data?.keywords) {
            console.log(`📋 分词完成: ${event.data.keywords.length} 个词元`);
            console.log(`   关键词: ${event.data.keywords.slice(0, 5).join(', ')}`);
          }
          break;

        case 'rag':
          if (event.data?.count !== undefined) {
            console.log(`🔍 检索完成: 找到 ${event.data.count} 条相关记忆`);
          } else {
            console.log(`🔍 ${event.message}`);
          }
          break;

        case 'prompts':
          console.log(`📝 ${event.message}`);
          break;

        case 'mcp':
          console.log(`🔧 ${event.message}`);
          break;

        case 'mcp_event':
          // MCP 内部事件
          if (event.data) {
            const mcpEvent = event.data;
            switch (mcpEvent.type) {
              case 'judge':
                console.log(`   ⚖️  判断: ${mcpEvent.need ? '需要' : '不需要'}工具调用`);
                break;
              case 'plan':
                console.log(`   📋 计划: ${mcpEvent.plan?.steps?.length || 0} 个步骤`);
                break;
              case 'tool_result':
                console.log(`   🔨 工具执行: ${mcpEvent.aiName} (${mcpEvent.elapsedMs}ms)`);
                break;
              case 'evaluation':
                console.log(`   ✅ 评估: ${mcpEvent.result?.success ? '成功' : '需要重试'}`);
                break;
              case 'summary':
                console.log(`   📝 总结完成`);
                break;
            }
          }
          break;

        case 'save':
          console.log(`💾 ${event.message}`);
          break;

        case 'complete':
          console.log(`\n✨ 处理完成！\n`);
          console.log('🤖 助手回复:');
          console.log('-'.repeat(60));
          console.log(event.data.response);
          console.log('-'.repeat(60));
          break;

        case 'error':
          console.error(`❌ 错误: ${event.error}`);
          break;

        default:
          console.log(`ℹ️  ${event.type}: ${event.message || ''}`);
      }
    }

    // 显示对话历史
    console.log('\n📜 对话历史:');
    const history = agent.getHistory();
    console.log(`共 ${history.length} 条消息`);

  } catch (error) {
    console.error('\n❌ 错误:', error.message);
  } finally {
    await agent.close();
  }

  console.log('\n✅ 流式示例完成！');
}

// 运行示例
streamExample().catch(console.error);
