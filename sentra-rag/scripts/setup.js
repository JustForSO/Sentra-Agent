#!/usr/bin/env node

/**
 * 系统初始化设置脚本
 * 用于首次安装后的环境检查和配置
 */

import fs from 'fs-extra';
import path from 'path';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('Setup');

/**
 * 检查必需的环境变量
 */
async function checkEnvironmentVariables() {
  logger.info('🔍 检查环境变量配置...');

  const requiredVars = [
    'OPENAI_API_KEY',
    'NEO4J_URI',
    'NEO4J_USERNAME', 
    'NEO4J_PASSWORD'
  ];

  const missingVars = [];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    logger.error('❌ 缺少必需的环境变量:');
    missingVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\n请确保已正确配置 .env 文件');
    return false;
  }

  logger.info('✅ 环境变量检查通过');
  return true;
}

/**
 * 检查并创建必需的目录
 */
async function createDirectories() {
  logger.info('📁 创建必需的目录...');

  const directories = [
    './storage',
    './storage/uploads',
    './storage/uploads/text',
    './storage/uploads/images',
    './storage/vectors',
    './storage/cache',
    './logs'
  ];

  for (const dir of directories) {
    try {
      await fs.ensureDir(dir);
      logger.info(`✅ 目录创建/检查: ${dir}`);
    } catch (error) {
      logger.error(`❌ 目录创建失败: ${dir}`, { error: error.message });
      return false;
    }
  }

  return true;
}

/**
 * 测试 OpenAI API 连接
 */
async function testOpenAIConnection() {
  logger.info('🤖 测试 OpenAI API 连接...');

  try {
    const { OpenAI } = await import('openai');
    
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    });

    // 测试简单的嵌入调用
    const response = await openai.embeddings.create({
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      input: '测试连接'
    });

    if (response.data && response.data.length > 0) {
      logger.info('✅ OpenAI API 连接测试成功');
      return true;
    } else {
      logger.error('❌ OpenAI API 响应格式异常');
      return false;
    }

  } catch (error) {
    logger.error('❌ OpenAI API 连接失败', { error: error.message });
    console.error('请检查:');
    console.error('1. OPENAI_API_KEY 是否正确');
    console.error('2. 网络连接是否正常');
    console.error('3. API 额度是否充足');
    return false;
  }
}

/**
 * 测试 Neo4j 数据库连接
 */
async function testNeo4jConnection() {
  logger.info('🗄️ 测试 Neo4j 数据库连接...');

  try {
    const neo4j = await import('neo4j-driver');
    
    const driver = neo4j.default.driver(
      process.env.NEO4J_URI,
      neo4j.default.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
      {
        connectionTimeout: 10000,
        disableLosslessIntegers: true
      }
    );

    // 测试连接
    await driver.verifyConnectivity();
    
    // 测试简单查询
    const session = driver.session();
    const result = await session.run('RETURN 1 as test');
    await session.close();
    
    if (result.records.length > 0) {
      logger.info('✅ Neo4j 数据库连接测试成功');
      await driver.close();
      return true;
    } else {
      logger.error('❌ Neo4j 查询测试失败');
      await driver.close();
      return false;
    }

  } catch (error) {
    logger.error('❌ Neo4j 数据库连接失败', { error: error.message });
    console.error('请检查:');
    console.error('1. Neo4j 服务是否启动');
    console.error('2. 连接URI是否正确');
    console.error('3. 用户名和密码是否正确');
    console.error('4. 网络端口是否开放');
    return false;
  }
}

/**
 * 初始化数据库schema
 */
async function initializeDatabaseSchema() {
  logger.info('🏗️ 初始化数据库架构...');

  try {
    const neo4jStorage = (await import('../src/database/neo4j.js')).default;
    await neo4jStorage.initialize();
    logger.info('✅ 数据库架构初始化成功');
    await neo4jStorage.close();
    return true;
  } catch (error) {
    logger.error('❌ 数据库架构初始化失败', { error: error.message });
    return false;
  }
}

/**
 * 创建示例 .env 文件
 */
async function createEnvExample() {
  const envPath = './.env';
  const envExamplePath = './.env.example';

  if (!await fs.pathExists(envPath)) {
    if (await fs.pathExists(envExamplePath)) {
      logger.info('📋 创建 .env 文件模板...');
      await fs.copy(envExamplePath, envPath);
      logger.info('✅ 已创建 .env 文件，请编辑并填写正确的配置值');
    } else {
      logger.warn('⚠️ 未找到 .env.example 文件');
    }
  }
}

/**
 * 输出配置指南
 */
function printConfigurationGuide() {
  console.log('\n' + '='.repeat(60));
  console.log('📖 配置指南');
  console.log('='.repeat(60));
  
  console.log('\n1. OpenAI API 配置:');
  console.log('   - 注册 OpenAI 账号: https://platform.openai.com/');
  console.log('   - 创建 API Key: https://platform.openai.com/api-keys');
  console.log('   - 在 .env 文件中设置 OPENAI_API_KEY');
  
  console.log('\n2. Neo4j 数据库配置:');
  console.log('   - 安装 Neo4j: https://neo4j.com/download/');
  console.log('   - 或使用 Docker: docker run --name neo4j -p 7474:7474 -p 7687:7687 -d neo4j:latest');
  console.log('   - 设置用户名密码并更新 .env 文件');
  
  console.log('\n3. 启动应用:');
  console.log('   - 开发模式: npm run dev');
  console.log('   - 生产模式: npm start');
  
  console.log('\n4. 测试功能:');
  console.log('   - 运行测试: node test/basic-test.js');
  console.log('   - 访问 API: http://localhost:3000');
  
  console.log('\n' + '='.repeat(60));
}

/**
 * 主设置函数
 */
async function runSetup() {
  console.log('🚀 开始 Sentra RAG 系统初始化设置\n');

  const steps = [
    { name: '环境变量检查', fn: checkEnvironmentVariables },
    { name: '目录创建', fn: createDirectories },
    { name: 'OpenAI API 测试', fn: testOpenAIConnection },
    { name: 'Neo4j 连接测试', fn: testNeo4jConnection },
    { name: '数据库架构初始化', fn: initializeDatabaseSchema }
  ];

  let allPassed = true;

  for (const step of steps) {
    try {
      const result = await step.fn();
      if (!result) {
        allPassed = false;
        break;
      }
    } catch (error) {
      logger.error(`❌ ${step.name} 失败`, { error: error.message });
      allPassed = false;
      break;
    }
    console.log(''); // 空行分隔
  }

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('🎉 系统初始化设置完成！');
    console.log('✅ 所有检查都通过，系统已准备就绪');
    console.log('\n可以使用以下命令启动应用:');
    console.log('   npm run dev   # 开发模式');
    console.log('   npm start     # 生产模式');
  } else {
    console.log('❌ 系统初始化设置未完成');
    console.log('⚠️ 请解决上述问题后重新运行设置');
    printConfigurationGuide();
  }
  console.log('='.repeat(60));

  return allPassed;
}

/**
 * 主入口
 */
async function main() {
  // 检查是否有 .env 文件
  if (!await fs.pathExists('./.env')) {
    logger.warn('⚠️ 未找到 .env 文件');
    await createEnvExample();
    console.log('\n请先配置 .env 文件中的必需参数，然后重新运行设置');
    printConfigurationGuide();
    return;
  }

  // 加载环境变量
  const dotenv = await import('dotenv');
  dotenv.config();

  try {
    const success = await runSetup();
    process.exit(success ? 0 : 1);
  } catch (error) {
    logger.error('设置过程中发生错误', { error: error.message });
    process.exit(1);
  }
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
