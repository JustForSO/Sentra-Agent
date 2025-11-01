/**
 * Sentra RAG SDK 图片处理示例
 * 演示图片处理、以图搜图、重复检测等功能
 */

import sentraRAG from '../src/sdk/SentraRAG.js';
import chalk from 'chalk';
import path from 'path';

async function main() {
  try {
    console.log(chalk.bold.cyan('\n=== Sentra RAG SDK 图片处理示例 ===\n'));

    // 1. 初始化 SDK
    console.log(chalk.yellow('1️⃣  初始化 SDK...'));
    await sentraRAG.initialize();
    console.log(chalk.green('✅ SDK 初始化成功\n'));

    const testImage = path.resolve('./1.jpeg');

    // 2. 计算图片哈希
    console.log(chalk.yellow('2️⃣  计算图片哈希...'));
    const hashes = await sentraRAG.calculateImageHash(testImage);
    console.log(chalk.green('✅ 哈希计算完成'));
    console.log(chalk.cyan(`   pHash: ${hashes.phash}`));
    console.log(chalk.cyan(`   dHash: ${hashes.dhash}`));
    console.log(chalk.cyan(`   aHash: ${hashes.ahash}\n`));

    // 3. 智能处理图片
    console.log(chalk.yellow('3️⃣  智能处理图片（AI 分析 + 哈希计算）...'));
    const imageData = await sentraRAG.processImage(testImage, {
      enableHash: true,
      enableOCR: true
    });
    console.log(chalk.green('✅ 图片处理完成'));
    console.log(chalk.cyan(`   标题: ${imageData.title}`));
    console.log(chalk.cyan(`   关键词: ${imageData.keywords?.join(', ') || '无'}`));
    console.log(chalk.cyan(`   描述: ${imageData.description?.substring(0, 100)}...\n`));

    // 4. 存储图片到数据库
    console.log(chalk.yellow('4️⃣  存储图片到数据库...'));
    const storeResult = await sentraRAG.storeImage(imageData, 'example_doc_001');
    console.log(chalk.green(`✅ 图片存储成功，ID: ${storeResult.imageId}\n`));

    // 5. 以图搜图
    console.log(chalk.yellow('5️⃣  以图搜图...'));
    const searchResult = await sentraRAG.searchByImagePath(testImage, { limit: 5 });
    console.log(chalk.green(`✅ 搜索完成，找到 ${searchResult.results.length} 个匹配`));
    console.log(chalk.cyan(`   耗时: ${searchResult.stats.totalTime}ms`));
    
    if (searchResult.results.length > 0) {
      console.log(chalk.cyan('\n   匹配结果:'));
      searchResult.results.forEach((r, i) => {
        console.log(chalk.white(`   ${i + 1}. ${r.title || r.id}`));
        console.log(chalk.gray(`      相似度: 100% (完全相同)`));
      });
    }
    console.log();

    // 6. 查找重复图片
    console.log(chalk.yellow('6️⃣  查找重复图片...'));
    const duplicates = await sentraRAG.findDuplicateImages({ limit: 1000 });
    console.log(chalk.green(`✅ 重复检测完成，发现 ${duplicates.length} 组重复图片`));
    
    if (duplicates.length > 0) {
      duplicates.slice(0, 3).forEach((group, i) => {
        console.log(chalk.cyan(`\n   组 ${i + 1}: ${group.images?.length || 0} 张重复图片`));
        group.images?.slice(0, 2).forEach(img => {
          console.log(chalk.gray(`      - ${img.title || img.id}`));
        });
      });
    }
    console.log();

    // 7. 批量哈希重建（如果需要）
    console.log(chalk.yellow('7️⃣  检查需要计算哈希的图片...'));
    const rebuildResult = await sentraRAG.rebuildImageHash({ forceRebuild: false });
    console.log(chalk.green(`✅ 哈希重建完成`));
    console.log(chalk.cyan(`   需要处理: ${rebuildResult.total || 0} 张`));
    console.log(chalk.cyan(`   成功更新: ${rebuildResult.updated || 0} 张`));
    console.log(chalk.cyan(`   失败: ${rebuildResult.failed || 0} 张\n`));

    console.log(chalk.bold.green('=== 图片处理示例完成！ ===\n'));

  } catch (error) {
    console.error(chalk.red('❌ 错误:'), error.message);
    console.error(error.stack);
  } finally {
    await sentraRAG.close();
    console.log(chalk.gray('SDK 已关闭'));
  }
}

main();
