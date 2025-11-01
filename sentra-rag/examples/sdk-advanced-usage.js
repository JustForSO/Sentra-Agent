/**
 * Sentra RAG SDK 高级功能示例
 * 演示批量处理、组合查询、完整工作流等
 */

import sentraRAG from '../src/sdk/SentraRAG.js';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';

async function main() {
  try {
    console.log(chalk.bold.cyan('\n=== Sentra RAG SDK 高级功能示例 ===\n'));

    await sentraRAG.initialize();
    console.log(chalk.green('✅ SDK 初始化成功\n'));

    // ==================== 示例 1: 完整的图片处理工作流 ====================
    console.log(chalk.bold.yellow('\n📸 示例 1: 完整的图片处理工作流\n'));
    
    const imagePath = path.resolve('./1.jpeg');
    if (await fs.pathExists(imagePath)) {
      // 一步完成：处理并存储
      const result = await sentraRAG.processAndStoreImage(
        imagePath,
        'workflow_doc_001',
        { enableHash: true, enableOCR: true }
      );
      
      console.log(chalk.green('✅ 图片处理并存储完成'));
      console.log(chalk.cyan(`   图片 ID: ${result.imageData.id}`));
      console.log(chalk.cyan(`   文档 ID: ${result.documentId}`));
      console.log(chalk.cyan(`   标题: ${result.imageData.title}`));
      console.log(chalk.cyan(`   pHash: ${result.imageData.phash}\n`));
    }

    // ==================== 示例 2: 批量文本向量生成 ====================
    console.log(chalk.bold.yellow('\n📊 示例 2: 批量文本向量生成\n'));
    
    const texts = [
      '人工智能是计算机科学的一个分支',
      '机器学习是人工智能的核心技术',
      '深度学习基于神经网络模型'
    ];
    
    const embeddings = await sentraRAG.getBatchEmbeddings(texts);
    console.log(chalk.green(`✅ 批量向量生成完成，生成 ${embeddings.length} 个向量`));
    console.log(chalk.cyan(`   向量维度: ${embeddings[0]?.length || 0}\n`));

    // ==================== 示例 3: 时间段查询 ====================
    console.log(chalk.bold.yellow('\n⏰ 示例 3: 时间段查询\n'));
    
    const now = Date.now();
    const oneHourAgo = now - 3600000; // 1小时前
    
    const timeResults = await sentraRAG.searchByTime({
      startTime: oneHourAgo,
      endTime: now
    }, { limit: 10 });
    
    console.log(chalk.green(`✅ 时间查询完成，找到 ${timeResults.length} 个结果`));
    if (timeResults.length > 0) {
      console.log(chalk.cyan('\n   最近的结果:'));
      timeResults.slice(0, 3).forEach((r, i) => {
        console.log(chalk.white(`   ${i + 1}. ${r.title || r.id}`));
        console.log(chalk.gray(`      时间: ${r.local_time || new Date(r.timestamp).toLocaleString()}`));
      });
    }
    console.log();

    // ==================== 示例 4: 组合查询（文本 + 时间） ====================
    console.log(chalk.bold.yellow('\n🔍 示例 4: 组合查询\n'));
    
    // 先搜索文本
    const textResults = await sentraRAG.search('图片', { limit: 20 });
    
    // 再过滤时间
    const combinedResults = textResults.filter(r => {
      return r.timestamp && r.timestamp > oneHourAgo;
    });
    
    console.log(chalk.green(`✅ 组合查询完成`));
    console.log(chalk.cyan(`   文本匹配: ${textResults.length} 个`));
    console.log(chalk.cyan(`   时间过滤后: ${combinedResults.length} 个\n`));

    // ==================== 示例 5: 文档管理 ====================
    console.log(chalk.bold.yellow('\n📁 示例 5: 文档管理\n'));
    
    // 获取文档列表
    const documents = await sentraRAG.getDocuments({ limit: 10 });
    console.log(chalk.green(`✅ 获取文档列表，共 ${documents.length} 个文档`));
    
    if (documents.length > 0) {
      console.log(chalk.cyan('\n   最近的文档:'));
      documents.slice(0, 3).forEach((doc, i) => {
        console.log(chalk.white(`   ${i + 1}. ${doc.title || doc.id}`));
        console.log(chalk.gray(`      ID: ${doc.id}`));
        console.log(chalk.gray(`      文本块: ${doc.chunkCount || 0}`));
      });
    }
    console.log();

    // ==================== 示例 6: 系统统计和监控 ====================
    console.log(chalk.bold.yellow('\n📊 示例 6: 系统统计\n'));
    
    const stats = await sentraRAG.getStats();
    console.log(chalk.green('✅ 系统统计信息:'));
    console.log(chalk.cyan(`   文档总数: ${stats.documentCount || 0}`));
    console.log(chalk.cyan(`   文本块总数: ${stats.chunkCount || 0}`));
    console.log(chalk.cyan(`   图片总数: ${stats.imageCount || 0}`));
    console.log(chalk.cyan(`   有哈希的图片: ${stats.imagesWithHash || 0}`));
    console.log(chalk.cyan(`   总存储大小: ${formatBytes(stats.totalSize || 0)}`));
    console.log(chalk.cyan(`   平均块大小: ${stats.avgChunkSize || 0} 字符\n`));

    // ==================== 示例 7: 智能工作流 ====================
    console.log(chalk.bold.yellow('\n🤖 示例 7: 智能工作流（处理 -> 查询 -> 问答）\n'));
    
    // 步骤 1: 处理新文档
    console.log(chalk.gray('   步骤 1: 处理文档...'));
    await sentraRAG.processDocument(
      'RAG（Retrieval-Augmented Generation）是一种结合检索和生成的AI技术，能够提供更准确的回答。',
      { title: 'RAG技术简介', source: 'example' }
    );
    console.log(chalk.green('   ✅ 文档处理完成'));
    
    // 步骤 2: 搜索相关内容
    console.log(chalk.gray('   步骤 2: 搜索相关内容...'));
    const relatedDocs = await sentraRAG.search('RAG技术', { limit: 5 });
    console.log(chalk.green(`   ✅ 找到 ${relatedDocs.length} 个相关文档`));
    
    // 步骤 3: 智能问答
    console.log(chalk.gray('   步骤 3: 智能问答...'));
    const answer = await sentraRAG.query('什么是 RAG 技术？');
    console.log(chalk.green('   ✅ 问答完成'));
    console.log(chalk.cyan(`   回答: ${answer.answer?.substring(0, 150)}...\n`));

    console.log(chalk.bold.green('=== 高级功能示例完成！ ===\n'));

  } catch (error) {
    console.error(chalk.red('❌ 错误:'), error.message);
    console.error(error.stack);
  } finally {
    await sentraRAG.close();
    console.log(chalk.gray('SDK 已关闭'));
  }
}

// 辅助函数：格式化字节
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

main();
