import express from 'express';
import Joi from 'joi';
import { createLogger } from '../utils/logger.js';
import ragService from '../services/ragService.js';
import neo4jStorage from '../database/neo4j.js';

const logger = createLogger('QueryAPI');
const router = express.Router();

/**
 * 智能查询接口
 * POST /api/query
 */
router.post('/', async (req, res) => {
  try {
    const querySchema = Joi.object({
      query: Joi.string().required().min(1).max(1000),
      mode: Joi.string().valid('vector', 'graph', 'hybrid').default('hybrid'),
      limit: Joi.number().integer().min(1).max(50).default(10),
      threshold: Joi.number().min(0).max(1).default(0.7),
      includeImages: Joi.boolean().default(true),
      includeEntities: Joi.boolean().default(true),
      filters: Joi.object({
        type: Joi.string().valid('text', 'image').optional(),
        category: Joi.string().optional(),
        dateRange: Joi.object({
          start: Joi.string().isoDate().optional(),
          end: Joi.string().isoDate().optional()
        }).optional()
      }).optional()
    });

    const { error, value } = querySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: `参数错误: ${error.details[0].message}`
      });
    }

    const { query, mode, limit, threshold, includeImages, includeEntities, filters = {} } = value;

    logger.info(`收到查询请求: "${query}"`, { mode, limit, threshold });

    const startTime = Date.now();

    // 执行查询
    const result = await ragService.query(query, {
      mode,
      limit,
      threshold,
      includeImages,
      includeEntities,
      filters
    });

    const processingTime = Date.now() - startTime;

    logger.info(`查询完成: "${query}"`, { 
      resultsCount: result.results.length,
      processingTime: `${processingTime}ms`
    });

    // 规范化输出，优先展示上下文化文本
    const items = (result.results || []).map(r => {
      const chunk = r.chunk || {};
      const text = chunk.contextualized || r.content || r.description || '';
      return {
        type: r.type || (r.image ? 'image' : 'text'),
        score: r.score,
        text,
        title: chunk.title || null,
        summary: chunk.summary || null,
        keywords: Array.isArray(chunk.keywords) ? chunk.keywords : null,
        document: r.document || null,
        chunk: r.chunk || null,
        image: r.image || null
      };
    });

    res.json({
      success: true,
      data: {
        ...result,
        items,
        processingTime: `${processingTime}ms`,
        searchedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('查询处理失败', { 
      error: error.message,
      query: req.body?.query 
    });

    res.status(500).json({
      success: false,
      message: '查询处理失败',
      error: error.message
    });
  }
});

/**
 * 获取查询建议
 * GET /api/query/suggestions
 */
router.get('/suggestions', async (req, res) => {
  try {
    const querySchema = Joi.object({
      q: Joi.string().required().min(1).max(100),
      limit: Joi.number().integer().min(1).max(20).default(10)
    });

    const { error, value } = querySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: `参数错误: ${error.details[0].message}`
      });
    }

    const { q, limit } = value;

    // 基于输入获取实体建议
    const entitySuggestions = await neo4jStorage.runQuery(
      'MATCH (e:Entity) WHERE e.name CONTAINS $query ' +
      'RETURN e.name as suggestion, "entity" as type, e.frequency as weight ' +
      'ORDER BY e.frequency DESC LIMIT $limit',
      { query: q, limit: Math.floor(limit / 2) }
    );

    // 基于输入获取文档标题建议
    const documentSuggestions = await neo4jStorage.runQuery(
      'MATCH (d:Document) WHERE d.filename CONTAINS $query OR d.metadata CONTAINS $query ' +
      'RETURN d.filename as suggestion, "document" as type, 1 as weight ' +
      'ORDER BY d.created_at DESC LIMIT $limit',
      { query: q, limit: Math.floor(limit / 2) }
    );

    const suggestions = [
      ...entitySuggestions.records.map(r => ({
        text: r.get('suggestion'),
        type: r.get('type'),
        weight: r.get('weight')
      })),
      ...documentSuggestions.records.map(r => ({
        text: r.get('suggestion'),
        type: r.get('type'),
        weight: r.get('weight')
      }))
    ];

    // 按权重排序
    suggestions.sort((a, b) => b.weight - a.weight);

    res.json({
      success: true,
      data: {
        query: q,
        suggestions: suggestions.slice(0, limit)
      }
    });

  } catch (error) {
    logger.error('获取查询建议失败', { error: error.message });

    res.status(500).json({
      success: false,
      message: '获取查询建议失败',
      error: error.message
    });
  }
});

/**
 * 相似性搜索接口
 * POST /api/query/similar
 */
router.post('/similar', async (req, res) => {
  try {
    const similarSchema = Joi.object({
      documentId: Joi.string().optional(),
      text: Joi.string().optional(),
      limit: Joi.number().integer().min(1).max(20).default(5),
      threshold: Joi.number().min(0).max(1).default(0.8)
    }).or('documentId', 'text');

    const { error, value } = similarSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: `参数错误: ${error.details[0].message}`
      });
    }

    const { documentId, text, limit, threshold } = value;

    logger.info('收到相似性搜索请求', { documentId, textLength: text?.length });

    let queryEmbedding;

    if (documentId) {
      // 基于文档ID获取向量
      const chunkResult = await neo4jStorage.runQuery(
        'MATCH (d:Document {id: $id})-[:CONTAINS]->(c:Chunk) ' +
        'RETURN c.embedding as embedding LIMIT 1',
        { id: documentId }
      );

      if (chunkResult.records.length === 0) {
        return res.status(404).json({
          success: false,
          message: '文档不存在或无向量数据'
        });
      }

      queryEmbedding = chunkResult.records[0].get('embedding');
    } else {
      // 基于文本生成向量
      const embeddingService = await import('../services/embedding.js');
      queryEmbedding = await embeddingService.default.getTextEmbedding(text);
    }

    // 执行向量搜索
    const similarResults = await neo4jStorage.vectorSearch(
      queryEmbedding, 'Chunk', limit, threshold
    );

    // 获取相关文档信息
    const results = [];
    for (const result of similarResults) {
      const docQuery = await neo4jStorage.runQuery(
        'MATCH (d:Document)-[:CONTAINS]->(c:Chunk {id: $chunkId}) RETURN d',
        { chunkId: result.node.id }
      );

      if (docQuery.records.length > 0) {
        const doc = docQuery.records[0].get('d').properties;
        results.push({
          score: result.score,
          document: doc,
          chunk: result.node,
          similarity: result.score
        });
      }
    }

    logger.info('相似性搜索完成', { resultsCount: results.length });

    res.json({
      success: true,
      data: {
        query: documentId ? `document:${documentId}` : text,
        results,
        searchMeta: {
          threshold,
          limit,
          searchType: 'similarity',
          searchedAt: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    logger.error('相似性搜索失败', { error: error.message });

    res.status(500).json({
      success: false,
      message: '相似性搜索失败',
      error: error.message
    });
  }
});

/**
 * 实体关系查询
 * GET /api/query/entities/:entityName/relations
 */
router.get('/entities/:entityName/relations', async (req, res) => {
  try {
    const { entityName } = req.params;
    const querySchema = Joi.object({
      depth: Joi.number().integer().min(1).max(3).default(1),
      limit: Joi.number().integer().min(1).max(50).default(10)
    });

    const { error, value } = querySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: `参数错误: ${error.details[0].message}`
      });
    }

    const { depth, limit } = value;

    logger.info(`查询实体关系: ${entityName}`, { depth, limit });

    // 查找实体
    const entityResult = await neo4jStorage.runQuery(
      'MATCH (e:Entity) WHERE e.name = $name OR e.name CONTAINS $name ' +
      'RETURN e ORDER BY e.frequency DESC LIMIT 1',
      { name: entityName }
    );

    if (entityResult.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: '实体不存在'
      });
    }

    const entity = entityResult.records[0].get('e').properties;

    // 查询关系（支持多层深度）
    let relationQuery;
    if (depth === 1) {
      relationQuery = `
        MATCH (e1:Entity {id: $entityId})-[r:RELATED]-(e2:Entity)
        RETURN e1, r, e2
        LIMIT $limit
      `;
    } else if (depth === 2) {
      relationQuery = `
        MATCH path = (e1:Entity {id: $entityId})-[r1:RELATED*1..2]-(e2:Entity)
        WHERE e1 <> e2
        RETURN path
        LIMIT $limit
      `;
    } else {
      relationQuery = `
        MATCH path = (e1:Entity {id: $entityId})-[r1:RELATED*1..3]-(e2:Entity)
        WHERE e1 <> e2
        RETURN path  
        LIMIT $limit
      `;
    }

    const relationResult = await neo4jStorage.runQuery(relationQuery, {
      entityId: entity.id,
      limit
    });

    const relations = [];
    const relatedEntities = new Set();

    if (depth === 1) {
      for (const record of relationResult.records) {
        const relation = record.get('r').properties;
        const relatedEntity = record.get('e2').properties;
        
        relations.push({
          relation,
          relatedEntity,
          distance: 1
        });
        
        relatedEntities.add(relatedEntity.id);
      }
    } else {
      // 处理路径结果
      for (const record of relationResult.records) {
        const path = record.get('path');
        const nodes = path.segments.map(segment => segment.end.properties);
        
        if (nodes.length > 0) {
          const lastNode = nodes[nodes.length - 1];
          relations.push({
            relatedEntity: lastNode,
            distance: path.length,
            path: nodes
          });
          
          relatedEntities.add(lastNode.id);
        }
      }
    }

    logger.info(`实体关系查询完成: ${entityName}`, { 
      relations: relations.length,
      relatedEntities: relatedEntities.size 
    });

    res.json({
      success: true,
      data: {
        entity,
        relations,
        totalRelatedEntities: relatedEntities.size,
        searchMeta: {
          depth,
          limit,
          searchedAt: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    logger.error('实体关系查询失败', { 
      error: error.message,
      entityName: req.params.entityName 
    });

    res.status(500).json({
      success: false,
      message: '实体关系查询失败',
      error: error.message
    });
  }
});

/**
 * 获取热门实体
 * GET /api/query/entities/trending
 */
router.get('/entities/trending', async (req, res) => {
  try {
    const querySchema = Joi.object({
      limit: Joi.number().integer().min(1).max(100).default(20),
      type: Joi.string().optional()
    });

    const { error, value } = querySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: `参数错误: ${error.details[0].message}`
      });
    }

    const { limit, type } = value;

    let query = 'MATCH (e:Entity) ';
    const params = { limit };

    if (type) {
      query += 'WHERE e.type = $type ';
      params.type = type;
    }

    query += 'RETURN e ORDER BY e.frequency DESC LIMIT $limit';

    const result = await neo4jStorage.runQuery(query, params);
    const entities = result.records.map(record => record.get('e').properties);

    res.json({
      success: true,
      data: {
        entities,
        searchMeta: {
          type: type || 'all',
          limit,
          searchedAt: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    logger.error('获取热门实体失败', { error: error.message });

    res.status(500).json({
      success: false,
      message: '获取热门实体失败',
      error: error.message
    });
  }
});

export default router;

/**
 * 删除文档（及其关联的块/图片）
 * DELETE /api/query/documents/:id
 */
router.delete('/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const out = await neo4jStorage.deleteDocument(id);
    logger.info('删除文档完成', { id, out });
    res.json({ success: true, data: out });
  } catch (error) {
    logger.error('删除文档失败', { error: error.message, id: req.params.id });
    res.status(500).json({ success: false, message: '删除文档失败', error: error.message });
  }
});

/**
 * 按文件名批量删除文档
 * DELETE /api/query/documents/by-filename?filename=xxx
 */
router.delete('/documents/by-filename', async (req, res) => {
  try {
    const schema = Joi.object({ filename: Joi.string().required() });
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const out = await neo4jStorage.deleteDocumentsByFilename(value.filename);
    logger.info('按文件名删除完成', { filename: value.filename, out });
    res.json({ success: true, data: out });
  } catch (error) {
    logger.error('按文件名删除失败', { error: error.message, filename: req.query?.filename });
    res.status(500).json({ success: false, message: '按文件名删除失败', error: error.message });
  }
});

/**
 * 清理服务缓存
 * POST /api/query/cache/clear
 */
router.post('/cache/clear', async (req, res) => {
  try {
    if (ragService.cache?.clear) {
      ragService.cache.clear();
    }
    res.json({ success: true, message: '缓存已清理' });
  } catch (error) {
    logger.error('清理缓存失败', { error: error.message });
    res.status(500).json({ success: false, message: '清理缓存失败', error: error.message });
  }
});

/**
 * 获取系统统计
 * GET /api/query/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await ragService.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('获取统计失败', { error: error.message });
    res.status(500).json({ success: false, message: '获取统计失败', error: error.message });
  }
});
