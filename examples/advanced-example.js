/**
 * Sentra Agent 高级示例
 * 演示如何自定义配置和使用高级功能
 */

import { Agent } from '../src/agent.js';
import 'dotenv/config';

async function advancedExample() {
  console.log('⚡ Sentra Agent 高级示例\n');
  console.log('=' .repeat(60));

  // 1. 创建具有自定义配置的 Agent
  console.log('\n🎛️  创建自定义配置的 Agent...');
  const agent = new Agent({
    conversationId: 'advanced_conv_001',
    userId: 'advanced_user',
    // 可以在这里覆盖环境变量配置
  });

  try {
    await agent.initialize();

    // 查看 Agent 配置
    const info = agent.getInfo();
    console.log('\n📊 Agent 配置:');
    console.log(`  - 会话ID: ${info.conversationId}`);
    console.log(`  - 用户ID: ${info.userId}`);
    console.log(`  - 功能状态:`);
    console.log(`    • 分词: ${info.features.segmentation ? '✅' : '❌'}`);
    console.log(`    • RAG检索: ${info.features.rag ? '✅' : '❌'}`);
    console.log(`    • 动态提示词: ${info.features.prompts ? '✅' : '❌'}`);
    console.log(`    • MCP工具: ${info.features.mcp ? '✅' : '❌'}`);
    console.log(`    • 记忆保存: ${info.features.memorySave ? '✅' : '❌'}`);

    // 2. 使用复杂的系统提示词（包含动态占位符）
    console.log('\n📝 设置包含动态占位符的系统提示词...');
    agent.addSystemMessage(`你是一个高级智能助手。

【当前信息】
- 时间: {{time}}
- 日期: {{date}}
- 星期: {{weekday}}
- 系统: {{os_platform}}

【工作原则】
1. 准确理解用户意图
2. 结合历史记忆提供上下文相关的回答
3. 在必要时使用工具完成任务
4. 始终保持友好和专业

请根据用户的问题提供帮助。`);

    // 3. 执行多轮对话，测试记忆功能
    console.log('\n💬 开始多轮对话测试...');
    console.log('=' .repeat(60));

    const conversations = [
      '我叫张三，是一名软件工程师',
      '我正在开发一个AI项目',
      '你还记得我的名字吗？',
      '我在做什么项目？'
    ];

    for (let i = 0; i < conversations.length; i++) {
      console.log(`\n【第 ${i + 1} 轮对话】`);
      console.log(`👤 用户: ${conversations[i]}`);

      const startTime = Date.now();
      const response = await agent.chat(conversations[i]);
      const endTime = Date.now();

      console.log(`🤖 助手: ${response.response}`);
      console.log(`⏱️  耗时: ${endTime - startTime}ms`);

      if (response.metadata) {
        console.log(`📊 元数据:`);
        if (response.metadata.keywords?.length > 0) {
          console.log(`   - 关键词: ${response.metadata.keywords.slice(0, 5).join(', ')}`);
        }
        if (response.metadata.ragContextLength > 0) {
          console.log(`   - RAG上下文长度: ${response.metadata.ragContextLength} 字符`);
        }
        if (response.metadata.mcpUsed) {
          console.log(`   - MCP工具已使用`);
        }
      }

      // 在对话之间稍作延迟
      if (i < conversations.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // 4. 测试特殊场景
    console.log('\n' + '=' .repeat(60));
    console.log('\n🧪 测试特殊场景...');

    // 测试长文本
    console.log('\n【场景1: 长文本处理】');
    const longText = `请帮我分析一下以下内容：
人工智能（Artificial Intelligence，AI）是计算机科学的一个分支，
它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。
该领域的研究包括机器人、语言识别、图像识别、自然语言处理和专家系统等。
人工智能从诞生以来，理论和技术日益成熟，应用领域也不断扩大。
`;
    console.log(`👤 用户: ${longText.substring(0, 50)}...`);
    const longResponse = await agent.chat(longText);
    console.log(`🤖 助手: ${longResponse.response.substring(0, 100)}...`);

    // 测试中英混合
    console.log('\n【场景2: 中英混合文本】');
    const mixedText = 'What is the difference between Machine Learning and Deep Learning？请用中文回答。';
    console.log(`👤 用户: ${mixedText}`);
    const mixedResponse = await agent.chat(mixedText);
    console.log(`🤖 助手: ${mixedResponse.response.substring(0, 100)}...`);

    // 5. 最终统计
    console.log('\n' + '=' .repeat(60));
    console.log('\n📊 最终统计:');
    const finalInfo = agent.getInfo();
    console.log(`  - 总对话轮数: ${finalInfo.historyLength / 2}`);
    console.log(`  - 历史消息数: ${finalInfo.historyLength}`);

    const history = agent.getHistory();
    const userMessages = history.filter(m => m.role === 'user').length;
    const assistantMessages = history.filter(m => m.role === 'assistant').length;
    console.log(`  - 用户消息: ${userMessages}`);
    console.log(`  - 助手消息: ${assistantMessages}`);

  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    console.error(error.stack);
  } finally {
    await agent.close();
  }

  console.log('\n✅ 高级示例完成！');
  console.log('=' .repeat(60));
}

// 运行示例
advancedExample().catch(console.error);
