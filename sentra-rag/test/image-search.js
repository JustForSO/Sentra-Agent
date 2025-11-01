/**
 * 以图搜图功能测试脚本
 * 测试哈希计算、精确匹配、向量搜索等功能
 */

import imageHashService from '../src/services/imageHashService.js';
import imageSearchService from '../src/services/imageSearchService.js';
import imageProcessor from '../src/services/imageProcessor.js';
import neo4jStorage from '../src/database/neo4j.js';
import { createLogger } from '../src/utils/logger.js';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

const logger = createLogger('TestImageSearch');

// 小工具：步骤计时
function step(title) {
  console.log(chalk.bold.cyan(`\n=== ${title} ===`));
  return Date.now();
}
function done(start, extra = '') {
  const ms = Date.now() - start;
  console.log(chalk.gray(`→ 用时 ${ms}ms${extra ? ' | ' + extra : ''}`));
}

/** 主测试函数 */
async function main() {
  try {
    console.log(chalk.bold.cyan('\n========================================'));
    console.log(chalk.bold.cyan('   以图搜图功能测试'));
    console.log(chalk.bold.cyan('========================================\n'));

    // 环境提示
    console.log(chalk.gray(`NEO4J_URI=${process.env.NEO4J_URI || '-'}  OPENAI_BASE_URL=${process.env.OPENAI_BASE_URL || '-'}\n`));

    // 初始化数据库连接
    let t = step('🔌 初始化数据库连接');
    try {
      await neo4jStorage.initialize();
      done(t);
      console.log(chalk.green('✅ 数据库连接成功\n'));
    } catch (error) {
      console.log(chalk.red(`❌ 数据库连接失败: ${error.message}`));
      console.log(chalk.yellow('提示: 请确保 Neo4j 数据库正在运行\n'));
      return;
    }

    // 查找测试图片
    const testImage = path.resolve('./1.jpeg');
    if (!await fs.pathExists(testImage)) {
      console.log(chalk.red('❌ 测试图片不存在: 1.jpeg'));
      return;
    }

    console.log(chalk.green(`✅ 测试图片: ${testImage}\n`));

    // 1️⃣ 测试哈希计算
    t = step('1️⃣ 测试图片哈希计算');
    try {
      const hashes = await imageHashService.calculateAllHashes(testImage);
      console.log(chalk.green('✅ 哈希计算成功:'));
      console.log(chalk.gray(`   pHash: ${hashes.phash}`));
      console.log(chalk.gray(`   dHash: ${hashes.dhash}`));
      console.log(chalk.gray(`   aHash: ${hashes.ahash}`));
      console.log(chalk.gray(`   算法: ${hashes.algorithm}`));
      done(t);
    } catch (error) {
      console.log(chalk.red(`❌ 哈希计算失败: ${error.message}`));
    }

    // 2️⃣ 测试以图搜图（哈希精确匹配）
    t = step('2️⃣ 测试以图搜图（哈希精确匹配）');
    try {
      const result = await imageSearchService.searchByImage(testImage);
      
      console.log(chalk.green('✅ 以图搜图完成:'));
      console.log(chalk.gray(`   找到结果: ${result.results.length} 个`));
      console.log(chalk.gray(`   耗时: ${result.stats.totalTime}ms`));
      done(t);
      
      if (result.results.length > 0) {
        console.log(chalk.cyan('\n   匹配结果:'));
        result.results.slice(0, 5).forEach((r, i) => {
          console.log(chalk.white(`   ${i + 1}. ${r.title || r.id}`));
          console.log(chalk.gray(`      相似度: 100%（完全相同）`));
          if (r.path) {
            console.log(chalk.gray(`      路径: ${r.path}`));
          }
        });
      } else {
        console.log(chalk.yellow('   ⚠️  未找到匹配的图片'));
      }
    } catch (error) {
      console.log(chalk.red(`❌ 以图搜图失败: ${error.message}`));
    }

    // 3️⃣ 测试查找重复图片
    t = step('3️⃣ 测试查找重复图片');
    try {
      const duplicates = await imageSearchService.findDuplicateImages({ limit: 100 });
      
      console.log(chalk.green('✅ 重复图片查找完成:'));
      console.log(chalk.gray(`   重复组数: ${duplicates.length}`));
      done(t);
      
      if (duplicates.length > 0) {
        const totalDuplicates = duplicates.reduce((sum, g) => sum + g.length, 0);
        console.log(chalk.gray(`   重复图片总数: ${totalDuplicates}`));
        
        console.log(chalk.cyan('\n   重复组详情（前3组）:'));
        duplicates.slice(0, 3).forEach((group, i) => {
          console.log(chalk.white(`   第 ${i + 1} 组 (${group.length} 张):`));
          group.forEach((img, j) => {
            console.log(chalk.gray(`     ${j + 1}. ${img.title || img.id}`));
            console.log(chalk.gray(`        哈希: ${img.phash.substring(0, 16)}...`));
          });
        });
      } else {
        console.log(chalk.yellow('   ℹ️  未发现重复图片'));
      }
    } catch (error) {
      console.log(chalk.red(`❌ 查找重复图片失败: ${error.message}`));
    }

    // 4️⃣ 测试为现有图片批量计算哈希
    t = step('4️⃣ 测试批量哈希计算');
    try {
      const result = await imageSearchService.rebuildHashIndex({ forceRebuild: false });
      
      console.log(chalk.green('✅ 批量哈希计算完成:'));
      console.log(chalk.gray(`   需要处理: ${result.total} 张`));
      console.log(chalk.gray(`   失败: ${result.failed} 张`));
      done(t);
    } catch (error) {
      console.log(chalk.red(`❌ 批量哈希计算失败: ${error.message}`));
    }

    // 5️⃣ 性能测试
    t = step('5️⃣ 性能测试（多次查询）');
    try {
      const iterations = 5;
      let totalTime = 0;
      
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await imageSearchService.searchByImage(testImage);
        totalTime += Date.now() - start;
      }
      
      const avgTime = (totalTime / iterations).toFixed(1);
      console.log(chalk.green(`✅ 性能测试完成:`));
      console.log(chalk.gray(`   平均耗时: ${avgTime}ms`));
      console.log(chalk.gray(`   总次数: ${iterations} 次`));
      done(t, `平均 ${avgTime}ms`);
    } catch (error) {
      console.log(chalk.red(`❌ 性能测试失败: ${error.message}`));
    }

    console.log(chalk.bold.green('\n========================================'));
    console.log(chalk.bold.green('   测试完成！'));
    console.log(chalk.bold.green('========================================\n'));

  } catch (error) {
    logger.error('测试过程中发生错误', { error: error.message, stack: error.stack });
    console.log(chalk.red(`\n❌ 测试失败: ${error.message}\n`));
  } finally {
    // 关闭数据库连接
    try {
      t = step('🧹 关闭数据库连接');
      await neo4jStorage.close();
      done(t);
      logger.info('数据库连接已关闭');
    } catch (e) {
      logger.warn('关闭数据库连接失败', { error: e.message });
    }
  }
}

// 运行测试
main().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
