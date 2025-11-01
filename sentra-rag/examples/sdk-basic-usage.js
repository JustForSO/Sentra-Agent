/**
 * Sentra RAG SDK 基础使用示例
 * 演示如何直接使用函数调用，无需启动 HTTP 服务器
 */

import sentraRAG from '../src/sdk/SentraRAG.js';
import chalk from 'chalk';

async function main() {
  try {
    console.log(chalk.bold.cyan('\n=== Sentra RAG SDK 基础使用示例 ===\n'));

    // 1. 初始化 SDK
    console.log(chalk.yellow('1️⃣  初始化 SDK...'));
    await sentraRAG.initialize();
    console.log(chalk.green('✅ SDK 初始化成功\n'));

    // 2. 处理文本文档
    console.log(chalk.yellow('2️⃣  处理文本文档...'));
    const docResult = await sentraRAG.processDocument(
      '人工智能（AI）是计算机科学的一个分支，致力于创建能够执行通常需要人类智能的任务的系统。',
      {
        title: '人工智能简介',
        source: 'example'
      }
    );
    console.log(chalk.green(`✅ 文档处理完成，生成 ${docResult.chunks?.length || 0} 个文本块\n`));

    // 3. 智能问答
    console.log(chalk.yellow('3️⃣  智能问答...'));
    const answer = await sentraRAG.query('什么是人工智能？');
    console.log(chalk.green('✅ 问答完成'));
    console.log(chalk.cyan(`   回答: ${answer.answer?.substring(0, 100)}...\n`));

    // 4. 文本搜索
    console.log(chalk.yellow('4️⃣  文本搜索...'));
    const searchResults = await sentraRAG.search('人工智能', { limit: 5 });
    console.log(chalk.green(`✅ 搜索完成，找到 ${searchResults.length} 个结果\n`));

    // 5. 生成向量
    console.log(chalk.yellow('5️⃣  生成文本向量...'));
    const embedding = await sentraRAG.getTextEmbedding('测试文本');
    console.log(chalk.green(`✅ 向量生成完成，维度: ${embedding.length}\n`));

    // 6. 获取系统统计
    console.log(chalk.yellow('6️⃣  获取系统统计...'));
    const stats = await sentraRAG.getStats();
    console.log(chalk.green('✅ 统计信息获取完成'));
    console.log(chalk.cyan(`   文档数: ${stats.documentCount || 0}`));
    console.log(chalk.cyan(`   文本块数: ${stats.chunkCount || 0}\n`));

    console.log(chalk.bold.green('=== 示例运行完成！ ===\n'));

  } catch (error) {
    console.error(chalk.red('❌ 错误:'), error.message);
    console.error(error.stack);
  } finally {
    // 关闭 SDK
    await sentraRAG.close();
    console.log(chalk.gray('SDK 已关闭'));
  }
}

main();
