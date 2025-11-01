#!/usr/bin/env node

/**
 * Sentra RAG - 基于Node.js的轻量级RAG系统
 * 主入口文件
 */

import dotenv from 'dotenv';
import { startServer } from './app.js';
import { createLogger } from './utils/logger.js';
import { validateConfig } from './config/index.js';

// 首先加载环境变量
dotenv.config();

const logger = createLogger('Main');

/**
 * 主函数
 */
async function main() {
  try {
    logger.info('🚀 启动 Sentra RAG 系统...');
    logger.info('📝 项目描述: 支持文本和图片的向量知识库系统');
    logger.info('🔧 技术栈: Node.js + Neo4j + OpenAI');
    
    // 验证配置
    logger.info('🔧 验证系统配置...');
    validateConfig();
    
    // 输出环境信息
    logger.info('🌍 运行环境信息:', {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      env: process.env.NODE_ENV || 'development'
    });

    // 输出关键配置信息（隐藏敏感信息）
    logger.info('⚙️ 关键配置信息:', {
      neo4jUri: process.env.NEO4J_URI,
      neo4jUsername: process.env.NEO4J_USERNAME,
      neo4jPasswordSet: !!process.env.NEO4J_PASSWORD,
      openaiBaseUrl: process.env.OPENAI_BASE_URL,
      openaiKeySet: !!process.env.OPENAI_API_KEY,
      port: process.env.PORT || 3000
    });

    // 启动服务器
    await startServer();

  } catch (error) {
    logger.error('❌ 系统启动失败', { 
      error: error.message,
      stack: error.stack 
    });
    
    console.error('\n💥 启动失败！请检查以下配置:');
    console.error('1. 确保已复制 .env.example 为 .env 并填写正确的配置');
    console.error('2. 确保 Neo4j 数据库正在运行');
    console.error('3. 确保 OpenAI API Key 有效');
    console.error('4. 检查网络连接和权限设置\n');
    
    process.exit(1);
  }
}

// 启动应用
main();
