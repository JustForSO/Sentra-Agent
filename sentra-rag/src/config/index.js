import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前模块的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量（从 sentra-rag 目录）
const ragRootDir = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(ragRootDir, '.env') });

/**
 * 应用程序配置管理
 * 集中管理所有配置项，避免硬编码
 */
const config = {
  // 服务器配置
  server: {
    port: parseInt(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN || '*'
  },

  // OpenAI API 配置
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDimensions: process.env.OPENAI_EMBEDDING_DIM ? parseInt(process.env.OPENAI_EMBEDDING_DIM) : undefined,
    timeout: parseInt(process.env.OPENAI_TIMEOUT) || 30000,
    maxRetries: parseInt(process.env.OPENAI_MAX_RETRIES) || 3
  },

  // Neo4j 数据库配置
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD,
    database: process.env.NEO4J_DATABASE || 'neo4j',
    maxConnectionPoolSize: parseInt(process.env.NEO4J_MAX_POOL_SIZE) || 50,
    connectionTimeout: parseInt(process.env.NEO4J_CONNECTION_TIMEOUT) || 30000
  },

  // 消息库（OpenAI 风格消息）Neo4j 配置：可与主库分离
  messageNeo4j: {
    uri: process.env.MSG_NEO4J_URI || process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.MSG_NEO4J_USERNAME || process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.MSG_NEO4J_PASSWORD || process.env.NEO4J_PASSWORD,
    database: process.env.MSG_NEO4J_DATABASE || 'messages',
    maxConnectionPoolSize: parseInt(process.env.MSG_NEO4J_MAX_POOL_SIZE || process.env.NEO4J_MAX_POOL_SIZE) || 50,
    connectionTimeout: parseInt(process.env.MSG_NEO4J_CONNECTION_TIMEOUT || process.env.NEO4J_CONNECTION_TIMEOUT) || 30000
  },

  // 存储配置
  storage: {
    uploadDir: process.env.UPLOAD_DIR || './storage/uploads',
    vectorStorageDir: process.env.VECTOR_STORAGE_DIR || './storage/vectors',
    cacheDir: process.env.CACHE_DIR || './storage/cache',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB
    allowedTypes: {
      text: ['.txt', '.md', '.json', '.csv'],
      image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
    }
  },

  // 处理配置
  processing: {
    chunkSize: parseInt(process.env.CHUNK_SIZE) || 1000,
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP) || 200,
    embeddingBatchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE) || 100,
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS) || 5
  },

  // 缓存配置
  cache: {
    ttl: parseInt(process.env.CACHE_TTL) || 3600, // 1小时
    checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD) || 600, // 10分钟
    maxKeys: parseInt(process.env.CACHE_MAX_KEYS) || 1000
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/app.log',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
  }
};

// 情绪服务配置
config.emotion = {
  enabled: String(process.env.EMOTION_ENABLED || 'true').toLowerCase() !== 'false',
  apiBaseUrl: process.env.EMOTION_API_BASE_URL || 'http://127.0.0.1:7200',
  analyzePath: process.env.EMOTION_ANALYZE_PATH || '/analyze',
  timeout: parseInt(process.env.EMOTION_TIMEOUT) || 10000,
  minTextLength: parseInt(process.env.EMOTION_MIN_TEXT_LENGTH) || 8
};

/**
 * 验证必需的配置项
 */
export function validateConfig() {
  const requiredFields = [
    'openai.apiKey',
    'neo4j.password'
  ];

  for (const field of requiredFields) {
    const value = field.split('.').reduce((obj, key) => obj?.[key], config);
    if (!value) {
      throw new Error(`配置项 ${field} 是必需的，请检查环境变量设置`);
    }
  }

  console.log('✅ 配置验证通过');
}

export default config;
