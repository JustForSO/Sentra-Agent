import express from 'express';
import { createLogger } from '../utils/logger.js';
import ragService from '../services/ragService.js';
import embeddingService from '../services/embedding.js';
import neo4jStorage from '../database/neo4j.js';

const logger = createLogger('StatsAPI');
const router = express.Router();

/**
 * 获取系统统计信息
 * GET /api/stats
 */
router.get('/', async (req, res) => {
  try {
    logger.info('获取系统统计信息');

    // 获取RAG服务的统计信息
    const ragStats = await ragService.getStats();

    // 获取缓存统计信息  
    const embeddingStats = embeddingService.getCacheStats();

    // 获取系统资源使用情况
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // 计算运行时间
    const uptime = process.uptime();

    const stats = {
      // 数据库统计
      database: {
        documents: ragStats.documents || 0,
        chunks: ragStats.chunks || 0,  
        images: ragStats.images || 0,
        entities: ragStats.entities || 0,
        relationships: ragStats.relationships || 0
      },

      // 缓存统计
      cache: {
        ragCacheSize: ragStats.cacheSize || 0,
        embeddingCacheSize: ragStats.embeddingCacheSize || 0,
        totalCacheItems: (ragStats.cacheSize || 0) + (ragStats.embeddingCacheSize || 0)
      },

      // 系统资源
      system: {
        uptime: {
          seconds: Math.floor(uptime),
          formatted: router.formatUptime(uptime)
        },
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
          external: Math.round(memoryUsage.external / 1024 / 1024), // MB
          rss: Math.round(memoryUsage.rss / 1024 / 1024) // MB
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        }
      },

      // 时间戳
      retrievedAt: new Date().toISOString()
    };

    logger.info('系统统计信息获取成功', {
      documents: stats.database.documents,
      entities: stats.database.entities,
      memoryUsage: `${stats.system.memory.used}MB`
    });

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('获取系统统计信息失败', { error: error.message });

    res.status(500).json({
      success: false,
      message: '获取系统统计信息失败',
      error: error.message
    });
  }
});

/**
 * 获取知识图谱统计
 * GET /api/stats/graph
 */
router.get('/graph', async (req, res) => {
  try {
    logger.info('获取知识图谱统计');

    // 获取实体类型分布
    const entityTypesResult = await neo4jStorage.runQuery(
      'MATCH (e:Entity) RETURN e.type as type, count(e) as count ORDER BY count DESC'
    );

    const entityTypes = entityTypesResult.records.map(record => ({
      type: record.get('type') || 'unknown',
      count: record.get('count').toNumber()
    }));

    // 获取关系类型分布
    const relationTypesResult = await neo4jStorage.runQuery(
      'MATCH ()-[r:RELATED]->() RETURN r.type as type, count(r) as count ORDER BY count DESC'
    );

    const relationTypes = relationTypesResult.records.map(record => ({
      type: record.get('type') || 'unknown',
      count: record.get('count').toNumber()
    }));

    // 获取连接度最高的实体
    const topEntitiesResult = await neo4jStorage.runQuery(
      'MATCH (e:Entity)-[r:RELATED]-() ' +
      'RETURN e.name as name, e.type as type, count(r) as connections ' +
      'ORDER BY connections DESC LIMIT 10'
    );

    const topEntities = topEntitiesResult.records.map(record => ({
      name: record.get('name'),
      type: record.get('type'),
      connections: record.get('connections').toNumber()
    }));

    // 获取文档类型分布
    const documentTypesResult = await neo4jStorage.runQuery(
      'MATCH (d:Document) RETURN d.type as type, count(d) as count ORDER BY count DESC'
    );

    const documentTypes = documentTypesResult.records.map(record => ({
      type: record.get('type'),
      count: record.get('count').toNumber()
    }));

    const graphStats = {
      entityTypes,
      relationTypes,
      topEntities,
      documentTypes,
      summary: {
        totalEntityTypes: entityTypes.length,
        totalRelationTypes: relationTypes.length,
        averageConnections: topEntities.length > 0 
          ? Math.round(topEntities.reduce((sum, e) => sum + e.connections, 0) / topEntities.length)
          : 0
      },
      retrievedAt: new Date().toISOString()
    };

    logger.info('知识图谱统计获取成功', {
      entityTypes: entityTypes.length,
      relationTypes: relationTypes.length,
      topEntities: topEntities.length
    });

    res.json({
      success: true,
      data: graphStats
    });

  } catch (error) {
    logger.error('获取知识图谱统计失败', { error: error.message });

    res.status(500).json({
      success: false,
      message: '获取知识图谱统计失败',
      error: error.message
    });
  }
});

/**
 * 获取存储使用情况
 * GET /api/stats/storage  
 */
router.get('/storage', async (req, res) => {
  try {
    logger.info('获取存储使用情况');

    const fs = await import('fs-extra');
    const path = await import('path');
    const config = await import('../config/index.js');

    // 计算上传目录大小
    const uploadDir = config.default.storage.uploadDir;
    let totalSize = 0;
    let fileCount = 0;

    const calculateDirSize = async (dirPath) => {
      try {
        if (await fs.pathExists(dirPath)) {
          const items = await fs.readdir(dirPath);
          
          for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stats = await fs.stat(fullPath);
            
            if (stats.isDirectory()) {
              await calculateDirSize(fullPath);
            } else {
              totalSize += stats.size;
              fileCount++;
            }
          }
        }
      } catch (error) {
        logger.warn('计算目录大小失败', { dirPath, error: error.message });
      }
    };

    await calculateDirSize(uploadDir);

    // 获取按类型分组的文件统计
    const fileTypesResult = await neo4jStorage.runQuery(
      'MATCH (d:Document) RETURN d.type as type, count(d) as count, sum(d.size) as totalSize ORDER BY count DESC'
    );

    const fileTypes = fileTypesResult.records.map(record => ({
      type: record.get('type'),
      count: record.get('count').toNumber(),
      totalSize: record.get('totalSize').toNumber()
    }));

    // 获取最近上传的文件
    const recentFilesResult = await neo4jStorage.runQuery(
      'MATCH (d:Document) RETURN d.filename as filename, d.type as type, d.size as size, d.created_at as createdAt ' +
      'ORDER BY d.created_at DESC LIMIT 10'
    );

    const recentFiles = recentFilesResult.records.map(record => ({
      filename: record.get('filename'),
      type: record.get('type'),
      size: record.get('size'),
      createdAt: record.get('createdAt')
    }));

    const storageStats = {
      total: {
        files: fileCount,
        size: totalSize,
        sizeFormatted: router.formatBytes(totalSize)
      },
      byType: fileTypes.map(ft => ({
        ...ft,
        sizeFormatted: router.formatBytes(ft.totalSize),
        avgSize: ft.count > 0 ? Math.round(ft.totalSize / ft.count) : 0
      })),
      recent: recentFiles,
      directories: {
        upload: uploadDir,
        exists: await fs.pathExists(uploadDir)
      },
      retrievedAt: new Date().toISOString()
    };

    logger.info('存储使用情况获取成功', {
      totalFiles: fileCount,
      totalSize: router.formatBytes(totalSize)
    });

    res.json({
      success: true,
      data: storageStats
    });

  } catch (error) {
    logger.error('获取存储使用情况失败', { error: error.message });

    res.status(500).json({
      success: false,
      message: '获取存储使用情况失败',
      error: error.message
    });
  }
});

/**
 * 健康检查
 * GET /api/stats/health
 */
router.get('/health', async (req, res) => {
  try {
    const checks = {
      database: false,
      embedding: false,
      storage: false
    };

    // 检查数据库连接
    try {
      await neo4jStorage.runQuery('RETURN 1');
      checks.database = true;
    } catch (error) {
      logger.warn('数据库健康检查失败', { error: error.message });
    }

    // 检查嵌入服务
    try {
      await embeddingService.getTextEmbedding('健康检查');
      checks.embedding = true;  
    } catch (error) {
      logger.warn('嵌入服务健康检查失败', { error: error.message });
    }

    // 检查存储目录
    try {
      const fs = await import('fs-extra');
      const config = await import('../config/index.js');
      await fs.ensureDir(config.default.storage.uploadDir);
      checks.storage = true;
    } catch (error) {
      logger.warn('存储健康检查失败', { error: error.message });
    }

    const isHealthy = Object.values(checks).every(check => check);
    const status = isHealthy ? 'healthy' : 'degraded';

    logger.info('健康检查完成', { status, checks });

    res.status(isHealthy ? 200 : 503).json({
      success: isHealthy,
      status,
      checks,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });

  } catch (error) {
    logger.error('健康检查失败', { error: error.message });

    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 格式化运行时间
 * @param {number} seconds - 秒数
 * @returns {string} 格式化的时间
 */
router.formatUptime = function(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  if (secs > 0) parts.push(`${secs}秒`);

  return parts.join(' ') || '0秒';
};

/**
 * 格式化字节数
 * @param {number} bytes - 字节数
 * @returns {string} 格式化的大小
 */
router.formatBytes = function(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default router;
