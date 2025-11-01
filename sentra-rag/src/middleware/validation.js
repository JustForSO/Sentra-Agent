import { createLogger } from '../utils/logger.js';

const logger = createLogger('Validation');

/**
 * 错误处理中间件
 */
export const errorHandler = (err, req, res, next) => {
  logger.error('请求处理错误', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // Multer 错误处理
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: '文件大小超出限制',
      error: '文件过大'
    });
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      success: false,
      message: '文件数量超出限制',
      error: '文件过多'
    });
  }

  // Joi 验证错误
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      error: err.details?.map(d => d.message).join(', ') || err.message
    });
  }

  // Neo4j 数据库错误
  if (err.name === 'Neo4jError') {
    return res.status(500).json({
      success: false,
      message: '数据库操作失败',
      error: '数据库连接或查询错误'
    });
  }

  // OpenAI API 错误
  if (err.name === 'APIError' || err.code === 'insufficient_quota') {
    return res.status(503).json({
      success: false,
      message: 'AI服务暂时不可用',
      error: 'OpenAI API 调用失败'
    });
  }

  // 默认错误响应
  const statusCode = err.statusCode || err.status || 500;
  const isDev = process.env.NODE_ENV === 'development';

  res.status(statusCode).json({
    success: false,
    message: err.message || '服务器内部错误',
    ...(isDev && { 
      stack: err.stack,
      details: err 
    })
  });
};

/**
 * 404 处理中间件
 */
export const notFoundHandler = (req, res) => {
  logger.warn('访问不存在的路由', {
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  res.status(404).json({
    success: false,
    message: '请求的资源不存在',
    path: req.url,
    method: req.method
  });
};

/**
 * 请求日志中间件
 */
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // 记录请求开始
  logger.info('请求开始', {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  // 监听响应结束
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[level]('请求完成', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });

  next();
};

/**
 * 请求限流中间件（简单实现）
 */
export const rateLimiter = () => {
  const requests = new Map();
  const windowMs = 15 * 60 * 1000; // 15分钟
  const maxRequests = 100; // 最大请求数

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    
    // 清理过期的记录
    const windowStart = now - windowMs;
    if (requests.has(key)) {
      const userRequests = requests.get(key).filter(time => time > windowStart);
      requests.set(key, userRequests);
    }

    // 检查请求数量
    const userRequests = requests.get(key) || [];
    if (userRequests.length >= maxRequests) {
      logger.warn('请求频率过高', { ip: req.ip, requests: userRequests.length });
      
      return res.status(429).json({
        success: false,
        message: '请求过于频繁，请稍后再试',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    // 记录请求时间
    userRequests.push(now);
    requests.set(key, userRequests);

    next();
  };
};

/**
 * CORS 配置中间件
 */
export const corsConfig = {
  origin: (origin, callback) => {
    // 开发环境允许所有来源
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // 生产环境可以配置允许的域名
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
    
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('不允许的CORS来源'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

/**
 * 安全头中间件
 */
export const securityHeaders = (req, res, next) => {
  // 基本安全头
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // 移除敏感头信息
  res.removeHeader('X-Powered-By');
  
  next();
};

/**
 * 文件上传验证中间件
 */
export const validateFileUpload = (req, res, next) => {
  if (!req.file && !req.files) {
    return next();
  }

  const files = req.files || [req.file];
  
  for (const file of files) {
    // 验证文件名
    if (!file.originalname || file.originalname.length > 255) {
      return res.status(400).json({
        success: false,
        message: '文件名无效或过长'
      });
    }

    // 验证文件扩展名
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (!ext) {
      return res.status(400).json({
        success: false,
        message: '文件必须包含扩展名'
      });
    }

    // 检查文件内容类型是否与扩展名匹配
    const mimeTypeMap = {
      'txt': 'text/plain',
      'md': 'text/markdown',
      'json': 'application/json',
      'csv': 'text/csv',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp'
    };

    const expectedMimeType = mimeTypeMap[ext];
    if (expectedMimeType && !file.mimetype.startsWith(expectedMimeType.split('/')[0])) {
      logger.warn('文件类型不匹配', {
        filename: file.originalname,
        expectedType: expectedMimeType,
        actualType: file.mimetype
      });
    }
  }

  next();
};

/**
 * API 版本验证中间件
 */
export const validateApiVersion = (req, res, next) => {
  const apiVersion = req.headers['api-version'] || '1.0';
  
  // 目前只支持 1.0 版本
  if (apiVersion !== '1.0') {
    return res.status(400).json({
      success: false,
      message: '不支持的API版本',
      supportedVersions: ['1.0']
    });
  }

  req.apiVersion = apiVersion;
  next();
};

/**
 * 健康检查中间件
 */
export const healthCheck = async (req, res) => {
  try {
    // 简单的健康检查
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime),
      memory: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024)
      },
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    logger.error('健康检查失败', { error: error.message });
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
};
