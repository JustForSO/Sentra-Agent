/**
 * 演示：人性化输出示例
 * 展示如何使用 humanAction 字段来显示真实生活的行为映射
 */

import SentraMcpSDK from '../src/sdk/index.js';

const sdk = new SentraMcpSDK();
await sdk.init();

console.log('🎭 人性化输出演示\n');

const objective = '查询北京的天气，然后上网搜索一下今天的新闻，最后把信息记录到文件里';

console.log(`📝 目标: ${objective}\n`);
console.log('━'.repeat(60));

// 使用流式输出，展示人性化的行为描述
for await (const ev of sdk.stream({ objective })) {
  switch (ev.type) {
    case 'judge':
      if (ev.need) {
        console.log(`\n🤔 判断: 需要使用工具`);
        if (ev.reason) console.log(`   原因: ${ev.reason}`);
      } else {
        console.log(`\n🤔 判断: 无需使用工具，直接回答即可`);
      }
      break;

    case 'plan':
      console.log(`\n📋 规划完成，共 ${ev.plan.steps?.length || 0} 个步骤\n`);
      break;

    case 'args':
      console.log(`\n🎬 步骤 ${ev.stepIndex + 1}: 准备${ev.humanAction || '使用工具'}`);
      console.log(`   工具: ${ev.aiName}`);
      if (ev.reason) console.log(`   原因: ${ev.reason}`);
      // 展示关键参数
      if (ev.args) {
        const keyArgs = Object.keys(ev.args)
          .filter(k => !['timeout', 'useCache', 'detailed'].includes(k))
          .slice(0, 3);
        if (keyArgs.length > 0) {
          console.log(`   参数: ${keyArgs.map(k => `${k}=${JSON.stringify(ev.args[k]).slice(0, 50)}`).join(', ')}`);
        }
      }
      break;

    case 'tool_result':
      const icon = ev.result?.success ? '✅' : '❌';
      const status = ev.result?.success ? '成功' : '失败';
      console.log(`${icon} ${ev.humanAction || '工具执行'}${status}`);
      if (ev.elapsedMs) {
        console.log(`   耗时: ${ev.elapsedMs}ms`);
      }
      if (!ev.result?.success && ev.result?.message) {
        console.log(`   错误: ${ev.result.message}`);
      }
      break;

    case 'evaluation':
      console.log(`\n🎯 评估结果: ${ev.result?.success ? '✅ 任务成功' : '❌ 任务失败'}`);
      if (ev.result?.summary) {
        console.log(`   总结: ${ev.result.summary}`);
      }
      break;

    case 'summary':
      console.log(`\n📊 执行摘要:`);
      console.log(`   尝试: ${ev.summary?.attempted || 0} 步`);
      console.log(`   成功: ${ev.summary?.succeeded || 0} 步`);
      console.log(`   成功率: ${((ev.summary?.successRate || 0) * 100).toFixed(1)}%`);
      break;

    case 'done':
      console.log(`\n🎉 任务完成!\n`);
      console.log('━'.repeat(60));
      break;
  }
}

console.log('\n💡 提示: 所有工具调用都映射到了真实生活的行为');
console.log('   - realtime_search → 上网查资料');
console.log('   - weather → 查看天气预报');
console.log('   - fs_ops (write_file) → 记录到文件');
console.log('   - web_parser → 仔细浏览网页');
console.log('   - mindmap_gen → 绘制思维导图');
console.log('   - system_info → 查看系统信息\n');
