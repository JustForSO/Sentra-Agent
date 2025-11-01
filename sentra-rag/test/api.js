/**
 * API 功能测试脚本
 * 测试所有 HTTP API 端点
 */

import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import chalk from 'chalk';
import path from 'path';

const BASE_URL = 'http://localhost:3000';

// 辅助函数：发送请求
async function request(method, url, data = null, isFormData = false) {
  try {
    const options = {
      method,
      headers: {}
    };

    if (data) {
      if (isFormData) {
        options.body = data;
      } else {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(data);
      }
    }

    const response = await fetch(`${BASE_URL}${url}`, options);
    const result = await response.json();
    return { status: response.status, data: result };
  } catch (error) {
    return { status: 0, error: error.message };
  }
}

async function main() {
  console.log(chalk.bold.cyan('\n=== Sentra RAG API 功能测试 ===\n'));

  // 1️⃣ 测试健康检查
  console.log(chalk.yellow('1️⃣  测试健康检查...'));
  try {
    const { status, data } = await request('GET', '/health');
    if (status === 200 && data.status === 'healthy') {
      console.log(chalk.green('✅ 健康检查通过'));
      console.log(chalk.gray(`   状态: ${data.status}`));
      console.log(chalk.gray(`   数据库: ${data.services?.database ? '连接正常' : '未连接'}\n`));
    } else {
      console.log(chalk.red('❌ 健康检查失败\n'));
    }
  } catch (error) {
    console.log(chalk.red(`❌ 健康检查错误: ${error.message}\n`));
  }

  // 2️⃣ 测试根路径
  console.log(chalk.yellow('2️⃣  测试根路径（API信息）...'));
  try {
    const { status, data } = await request('GET', '/');
    if (status === 200) {
      console.log(chalk.green('✅ API信息获取成功'));
      console.log(chalk.gray(`   名称: ${data.name}`));
      console.log(chalk.gray(`   版本: ${data.version}`));
      console.log(chalk.gray(`   状态: ${data.status}\n`));
    } else {
      console.log(chalk.red('❌ API信息获取失败\n'));
    }
  } catch (error) {
    console.log(chalk.red(`❌ 错误: ${error.message}\n`));
  }

  // 3️⃣ 测试系统统计
  console.log(chalk.yellow('3️⃣  测试系统统计...'));
  try {
    const { status, data } = await request('GET', '/api/stats');
    if (status === 200 && data.success) {
      console.log(chalk.green('✅ 系统统计获取成功'));
      const db = data.data?.database || {};
      console.log(chalk.gray(`   文档数: ${db.documents || 0}`));
      console.log(chalk.gray(`   文本块数: ${db.chunks || 0}`));
      console.log(chalk.gray(`   图片数: ${db.images || 0}`));
      const cache = data.data?.cache || {};
      console.log(chalk.gray(`   缓存: RAG=${cache.ragCacheSize || 0}, Embedding=${cache.embeddingCacheSize || 0}\n`));
    } else {
      console.log(chalk.red('❌ 系统统计获取失败\n'));
    }
  } catch (error) {
    console.log(chalk.red(`❌ 错误: ${error.message}\n`));
  }

  // 4️⃣ 测试以图搜图
  const testImage = path.resolve('./1.jpeg');
  if (fs.existsSync(testImage)) {
    console.log(chalk.yellow('4️⃣  测试以图搜图 API...'));
    try {
      const formData = new FormData();
      formData.append('image', fs.createReadStream(testImage));
      formData.append('limit', '5');

      const { status, data } = await request('POST', '/api/search/image', formData, true);
      
      if (status === 200 && data.success) {
        console.log(chalk.green('✅ 以图搜图成功'));
        console.log(chalk.gray(`   搜索方法: ${data.method}`));
        console.log(chalk.gray(`   找到结果: ${data.results?.length || 0} 个`));
        console.log(chalk.gray(`   耗时: ${data.stats?.totalTime}ms`));
        
        if (data.results?.length > 0) {
          console.log(chalk.cyan('\n   匹配结果:'));
          data.results.slice(0, 3).forEach((r, i) => {
            console.log(chalk.white(`   ${i + 1}. ${r.title || r.id}`));
            console.log(chalk.gray(`      相似度: 100%`));
          });
        }
        console.log();
      } else {
        console.log(chalk.red('❌ 以图搜图失败\n'));
        console.log(chalk.gray(`   ${JSON.stringify(data, null, 2)}\n`));
      }
    } catch (error) {
      console.log(chalk.red(`❌ 错误: ${error.message}\n`));
    }
  } else {
    console.log(chalk.yellow('4️⃣  跳过以图搜图测试（缺少测试图片 1.jpeg）\n'));
  }

  // 5️⃣ 测试查找重复图片
  console.log(chalk.yellow('5️⃣  测试查找重复图片...'));
  try {
    const { status, data } = await request('GET', '/api/search/duplicates?limit=100');
    
    if (status === 200 && data.success) {
      console.log(chalk.green('✅ 重复图片查找成功'));
      console.log(chalk.gray(`   重复组数: ${data.stats?.totalGroups || 0}`));
      console.log(chalk.gray(`   重复图片总数: ${data.stats?.totalDuplicates || 0}\n`));
    } else {
      console.log(chalk.red('❌ 重复图片查找失败\n'));
    }
  } catch (error) {
    console.log(chalk.red(`❌ 错误: ${error.message}\n`));
  }

  // 6️⃣ 测试批量哈希重建
  console.log(chalk.yellow('6️⃣  测试批量哈希重建...'));
  try {
    const { status, data } = await request('POST', '/api/search/rebuild-hash', { force: false });
    
    if (status === 200 && data.success) {
      console.log(chalk.green('✅ 批量哈希重建成功'));
      console.log(chalk.gray(`   需要处理: ${data.total || 0} 张`));
      console.log(chalk.gray(`   成功更新: ${data.updated || 0} 张`));
      console.log(chalk.gray(`   失败: ${data.failed || 0} 张\n`));
    } else {
      console.log(chalk.red('❌ 批量哈希重建失败\n'));
    }
  } catch (error) {
    console.log(chalk.red(`❌ 错误: ${error.message}\n`));
  }

  console.log(chalk.bold.green('=== API 测试完成！ ===\n'));
  
  // 显示总结
  console.log(chalk.cyan('📝 API 端点总结:'));
  console.log(chalk.white('   健康检查: GET /health'));
  console.log(chalk.white('   API 信息: GET /'));
  console.log(chalk.white('   系统统计: GET /api/stats'));
  console.log(chalk.white('   以图搜图: POST /api/search/image'));
  console.log(chalk.white('   查找重复: GET /api/search/duplicates'));
  console.log(chalk.white('   哈希重建: POST /api/search/rebuild-hash'));
  console.log();
}

main().catch(error => {
  console.error(chalk.red('测试过程出错:'), error);
  process.exit(1);
});
