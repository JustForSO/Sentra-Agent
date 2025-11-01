import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs-extra';
import config, { validateConfig } from './config/index.js';
import { createLogger } from './utils/logger.js';
import ragService from './services/ragService.js';

// 中间件导入
import {
  errorHandler,
  notFoundHandler,
  requestLogger,
  rateLimiter,
  corsConfig,
  securityHeaders,
  validateApiVersion,
  healthCheck
} from './middleware/validation.js';

// 路由导入
import documentsRouter from './routes/documents.js';
import queryRouter from './routes/query.js';
import statsRouter from './routes/stats.js';
import imageSearchRouter from './routes/imageSearch.js';

const logger = createLogger('App');

/**
 * 创建Express应用
 */
export async function createApp() {
  try {
    // 验证配置
    validateConfig();

    // 创建Express实例
    const app = express();

    // 信任代理（用于获取真实IP）
    app.set('trust proxy', 1);

    // 基础安全中间件
    app.use(helmet({
      contentSecurityPolicy: false, // 暂时禁用CSP以便开发
      crossOriginEmbedderPolicy: false
    }));

    // 自定义安全头
    app.use(securityHeaders);

    // CORS配置
    app.use(cors(corsConfig));

    // 请求解析中间件
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // 请求日志
    app.use(requestLogger);

    // API版本验证
    app.use('/api', validateApiVersion);

    // 请求限流（仅在生产环境启用）
    if (config.server.env === 'production') {
      app.use('/api', rateLimiter());
    }

    // 健康检查端点
    app.get('/health', healthCheck);
    app.get('/api/health', healthCheck);

    // 根路径响应
    app.get('/', (req, res) => {
      res.json({
        name: 'Sentra RAG API',
        version: '1.0.0',
        description: '基于Node.js的轻量级RAG系统',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          documents: '/api/documents',
          query: '/api/query',
          stats: '/api/stats',
          imageSearch: '/api/search',
          health: '/health'
        }
      });
    });

    // API路由
    app.use('/api/documents', documentsRouter);
    app.use('/api/query', queryRouter);
    app.use('/api/stats', statsRouter);
    app.use('/api/search', imageSearchRouter);

    // 静态文件服务（用于查看上传的图片等）
    const uploadsPath = path.resolve(config.storage.uploadDir);
    app.use('/uploads', express.static(uploadsPath));

    // 404处理
    app.use(notFoundHandler);

    // 错误处理中间件（必须放在最后）
    app.use(errorHandler);

    logger.info('✅ Express应用创建成功');
    return app;

  } catch (error) {
    logger.error('❌ Express应用创建失败', { error: error.message });
    throw error;
  }
}

/**
 * 初始化应用服务
 */
export async function initializeServices() {
  try {
    logger.info('正在初始化应用服务...');

    // 确保存储目录存在
    await fs.ensureDir(config.storage.uploadDir);
    await fs.ensureDir(config.storage.vectorStorageDir);
    await fs.ensureDir(path.dirname(config.logging.file));

    logger.info('✅ 存储目录初始化完成');

    // 初始化RAG服务
    await ragService.initialize();

    logger.info('✅ 应用服务初始化完成');

  } catch (error) {
    logger.error('❌ 应用服务初始化失败', { 
      error: error.message,
      stack: error.stack 
    });
    console.error('\n详细错误:', error);
    throw error;
  }
}

/**
 * 启动服务器
 */
export async function startServer() {
  try {
    // 初始化服务
    await initializeServices();

    // 创建应用
    const app = await createApp();

    // 启动服务器
    const server = app.listen(config.server.port, () => {
      logger.info(`🚀 服务器启动成功！`);
      logger.info(`📡 监听端口: ${config.server.port}`);
      logger.info(`🌍 环境模式: ${config.server.env}`);
      logger.info(`📋 API文档: http://localhost:${config.server.port}/`);
      logger.info(`💾 数据存储: ${config.storage.uploadDir}`);
      
      // 输出一些有用的API端点
      console.log('\n🔗 主要API端点:');
      console.log(`   健康检查: http://localhost:${config.server.port}/health`);
      console.log(`   文档上传: POST http://localhost:${config.server.port}/api/documents/upload`);
      console.log(`   智能查询: POST http://localhost:${config.server.port}/api/query`);
      console.log(`   系统统计: GET http://localhost:${config.server.port}/api/stats`);
      console.log('\n');
    });

    // 优雅关闭处理
    setupGracefulShutdown(server);

    return { app, server };

  } catch (error) {
    logger.error('❌ 服务器启动失败', { error: error.message });
    process.exit(1);
  }
}

/**
 * 设置优雅关闭
 */
function setupGracefulShutdown(server) {
  const shutdown = async (signal) => {
    logger.info(`收到 ${signal} 信号，开始优雅关闭...`);

    // 停止接受新连接
    server.close(async () => {
      logger.info('HTTP服务器已关闭');

      try {
        // 关闭数据库连接
        await ragService.close();
        logger.info('数据库连接已关闭');

        logger.info('✅ 应用已优雅关闭');
        process.exit(0);
      } catch (error) {
        logger.error('关闭过程中发生错误', { error: error.message });
        process.exit(1);
      }
    });

    // 强制关闭超时
    setTimeout(() => {
      logger.error('强制关闭应用（优雅关闭超时）');
      process.exit(1);
    }, 30000);
  };

  // 监听关闭信号
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 未捕获异常处理
  process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('未处理的Promise拒绝', { 
      reason: reason?.message || reason,
      promise: promise.toString()
    });
    process.exit(1);
  });
}

// 如果直接运行此文件，启动服务器
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
