import crypto from 'crypto';
import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import neo4jStorage from '../database/neo4j.js';
import embeddingService from './embedding.js';
import textProcessor from './textProcessor.js';
import imageProcessor from './imageProcessor.js';
import emotionService from './emotionService.js';
import NodeCache from 'node-cache';

const logger = createLogger('RAGService');
const cache = new NodeCache();

/**
 * RAG (Retrieval-Augmented Generation) 核心服务
 * 整合文本处理、图片处理、向量检索和知识图谱功能
 */
class RAGService {
  constructor() {
    this.isInitialized = false;
    this.cache = new Map();
    this.cacheTimeout = config.cache.ttl * 1000; // 转换为毫秒
  }

  /**
   * 初始化 RAG 服务
   */
  async initialize() {
    try {
      logger.info('正在初始化 RAG 服务...');

      // 初始化数据库连接
      await neo4jStorage.initialize();

      this.isInitialized = true;
      logger.info('✅ RAG 服务初始化完成');

    } catch (error) {
      logger.error('❌ RAG 服务初始化失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 插入文档到知识库
   * @param {Object} document - 文档信息
   * @returns {Object} 插入结果
   */
  async insertDocument(document) {
    try {
      this.ensureInitialized();
      logger.info(`开始插入文档: ${document.filename}`);

      // 1. 创建文档节点
      const docNode = await neo4jStorage.createDocument({
        id: document.id,
        filename: document.filename,
        type: document.type,
        size: document.size,
        path: document.path,
        mimeType: document.mimeType || 'text/plain',
        metadata: JSON.stringify(document.metadata || {})
      });

      let result = { document: docNode };

      // 2. 根据文档类型处理内容
      if (document.type === 'text') {
        result = await this.insertTextDocument(document, docNode);
      } else if (document.type === 'image') {
        result = await this.insertImageDocument(document, docNode);
      }

      // 3. 清除相关缓存
      this.clearRelevantCache(document.filename);

      logger.info(`文档插入完成: ${document.filename}`, {
        chunks: result.chunks?.length || 0,
        entities: result.entities?.length || 0,
        relations: result.relations?.length || 0
      });

      return result;

    } catch (error) {
      logger.error(`文档插入失败: ${document.filename}`, { error: error.message });
      throw new Error(`文档插入失败: ${error.message}`);
    }
  }

  /**
   * 插入文本文档
   * @param {Object} document - 文档信息
   * @param {Object} docNode - 文档节点
   * @returns {Object} 插入结果
   */
  async insertTextDocument(document, docNode) {
    // 1. 处理文本内容
    const processed = await textProcessor.processDocument(document.content, document.id);

    // 2. 插入文本块
    const chunks = [];
    for (const chunk of processed.chunks) {
      // 情绪分析（基于上下文化文本优先，回退原文/摘要）
      const emoText = String(chunk.contextualized || chunk.content || chunk.summary || '').trim();
      const emo = await emotionService.analyzeText(emoText);
      const chunkNode = await neo4jStorage.createChunk({
        id: chunk.id,
        documentId: document.id,
        content: chunk.content,
        contextualized: chunk.contextualized || null,
        rawContent: chunk.rawContent || null,
        title: chunk.title || null,
        summary: chunk.summary || null,
        keywords: Array.isArray(chunk.keywords) ? chunk.keywords : null,
        entities: Array.isArray(chunk.entities) ? chunk.entities : null,
        sao: Array.isArray(chunk.sao) ? chunk.sao : null,
        index: Number.isFinite(chunk.index) ? chunk.index : null,
        start: Number.isFinite(chunk.start) ? chunk.start : null,
        end: Number.isFinite(chunk.end) ? chunk.end : null,
        tokens: chunk.tokens || 0,
        embedding: Array.isArray(chunk.embedding) ? chunk.embedding : null,
        position: chunk.position,
        // 情绪字段映射
        sentiment_label: emo.sentiment?.label || null,
        sentiment_positive: emo.sentiment?.scores?.positive,
        sentiment_negative: emo.sentiment?.scores?.negative,
        sentiment_neutral: emo.sentiment?.scores?.neutral,
        primary_emotion_label: Array.isArray(emo.emotions) && emo.emotions[0] ? emo.emotions[0].label : null,
        primary_emotion_score: Array.isArray(emo.emotions) && emo.emotions[0] ? emo.emotions[0].score : null,
        emotion_labels: emo.emotion_labels || [],
        emotion_values: emo.emotion_values || [],
        vad_valence: emo.vad?.valence,
        vad_arousal: emo.vad?.arousal,
        vad_dominance: emo.vad?.dominance,
        stress_score: emo.stress?.score,
        stress_level: emo.stress?.level
      });

      // 创建文档到块的关系
      await neo4jStorage.runQuery(
        'MATCH (d:Document {id: $docId}), (c:Chunk {id: $chunkId}) ' +
        'MERGE (d)-[:CONTAINS]->(c)',
        { docId: document.id, chunkId: chunk.id }
      );

      chunks.push(chunkNode);
    }

    // 3. 插入实体
    const entities = [];
    for (const entity of processed.entities) {
      // 检查实体是否已存在
      const existingEntity = await neo4jStorage.runQuery(
        'MATCH (e:Entity {name: $name, type: $type}) RETURN e',
        { name: entity.name, type: entity.type }
      );

      let entityNode;
      if (existingEntity.records.length > 0) {
        entityNode = existingEntity.records[0].get('e').properties;
        // 更新实体频率
        await neo4jStorage.runQuery(
          'MATCH (e:Entity {id: $id}) SET e.frequency = coalesce(e.frequency, 0) + $freq',
          { id: entityNode.id, freq: Number.isFinite(entity.frequency) ? entity.frequency : 1 }
        );
      } else {
        // 创建新实体
        const params = {
          id: entity.id,
          name: entity.name,
          type: entity.type,
          frequency: Number.isFinite(entity.frequency) ? entity.frequency : 1,
          confidence: typeof entity.confidence === 'number' ? entity.confidence : 1,
          context: entity.context ?? null,
          extractedBy: entity.extractedBy || 'openai'
        };
        const result = await neo4jStorage.runQuery(
          'CREATE (e:Entity {id: $id, name: $name, type: $type, frequency: $frequency, confidence: $confidence, created_at: datetime()}) RETURN e',
          params
        );
        entityNode = result.records[0].get('e').properties;
      }

      // 创建文档到实体的关系
      await neo4jStorage.runQuery(
        'MATCH (d:Document {id: $docId}), (e:Entity {id: $entityId}) ' +
        'MERGE (d)-[r:MENTIONS]->(e) ' +
        'ON CREATE SET r.count = 1, r.first_seen = datetime() ' +
        'ON MATCH SET r.count = coalesce(r.count, 0) + 1, r.last_seen = datetime()',
        { docId: document.id, entityId: entityNode.id }
      );

      entities.push(entityNode);
    }

    const normalizeName = s => String(s || '').trim().toLowerCase();
    const nameToId = new Map(entities.map(e => [normalizeName(e.name), e.id]));

    for (const ch of processed.chunks) {
      if (Array.isArray(ch.entities)) {
        for (const en of ch.entities) {
          const eid = nameToId.get(normalizeName(en));
          if (!eid) continue;
          await neo4jStorage.runQuery(
            'MATCH (c:Chunk {id: $chunkId}), (e:Entity {id: $entityId}) ' +
            'MERGE (c)-[r:MENTIONS]->(e) ' +
            'ON CREATE SET r.count = 1, r.first_seen = datetime() ' +
            'ON MATCH SET r.count = coalesce(r.count, 0) + 1, r.last_seen = datetime()',
            { chunkId: ch.id, entityId: eid }
          );
        }
      }
    }

    // 4. 插入关系
    const relations = [];
    for (const relation of processed.relations) {
      const srcName = normalizeName(relation.source);
      const tgtName = normalizeName(relation.target);
      let sourceId = nameToId.get(srcName);
      let targetId = nameToId.get(tgtName);
      if (!sourceId) {
        const q1 = await neo4jStorage.runQuery(
          'MATCH (e:Entity) WHERE toLower(e.name) = $name RETURN e LIMIT 1',
          { name: srcName }
        );
        if (q1.records.length > 0) sourceId = q1.records[0].get('e').properties.id;
      }
      if (!targetId) {
        const q2 = await neo4jStorage.runQuery(
          'MATCH (e:Entity) WHERE toLower(e.name) = $name RETURN e LIMIT 1',
          { name: tgtName }
        );
        if (q2.records.length > 0) targetId = q2.records[0].get('e').properties.id;
      }
      if (!sourceId || !targetId) continue;

      const result = await neo4jStorage.runQuery(
        'MATCH (e1:Entity {id: $sourceId}), (e2:Entity {id: $targetId}) ' +
        'MERGE (e1)-[r:RELATED {type: $type}]->(e2) ' +
        'ON CREATE SET r.id = $id, r.context = $context, r.confidence = $confidence, r.created_at = datetime(), r.count = 1 ' +
        'ON MATCH SET r.last_seen = datetime(), r.count = coalesce(r.count, 0) + 1 ' +
        'RETURN r',
        {
          id: relation.id,
          sourceId,
          targetId,
          type: relation.type || relation.relation || null,
          context: relation.context,
          confidence: relation.confidence
        }
      );

      if (result.records.length > 0) {
        relations.push(result.records[0].get('r').properties);
      }
    }

    return {
      document: docNode,
      chunks,
      entities,
      relations,
      summary: processed.summary
    };
  }

  /**
   * 插入图片文档
   * @param {Object} document - 文档信息
   * @param {Object} docNode - 文档节点
   * @returns {Object} 插入结果
   */
  async insertImageDocument(document, docNode) {
    // 1. 处理图片
    const processed = await imageProcessor.processImage(document.path, {
      description: document.description,
      generateDescription: true
    });

    // 2. 创建图片节点
    const imageNode = await neo4jStorage.createImage({
      id: processed.id,
      filename: processed.filename,
      path: processed.path,
      width: processed.width,
      height: processed.height,
      format: processed.format,
      size: processed.size,
      embedding: processed.embedding,
      description: processed.description,
      metadata: JSON.stringify(processed.metadata)
    });

    // 3. 创建文档到图片的关系
    await neo4jStorage.runQuery(
      'MATCH (d:Document {id: $docId}), (i:Image {id: $imageId}) ' +
      'MERGE (d)-[:CONTAINS]->(i)',
      { docId: document.id, imageId: processed.id }
    );

    // 4. 基于图片分析结果构建文本并进行情绪分析，然后创建对应的 Chunk（用于统一检索）
    const fullContent = [
      `标题: ${processed.title}`,
      `详细描述: ${processed.description}`,
      processed.summary ? `摘要: ${processed.summary}` : '',
      Array.isArray(processed.keywords) && processed.keywords.length ? `关键词: ${processed.keywords.join(', ')}` : '',
      Array.isArray(processed.entities) && processed.entities.length ? `实体: ${processed.entities.join(', ')}` : '',
      processed.extractedText ? `图片文字: ${processed.extractedText}` : ''
    ].filter(Boolean).join('\n');

    const emo = await emotionService.analyzeText(fullContent);

    const chunkNode = await neo4jStorage.createChunk({
      id: processed.id, // 与图片保持同一ID，便于关联
      documentId: document.id,
      content: fullContent,
      contextualized: fullContent,
      title: processed.title,
      summary: processed.summary || (processed.description ? processed.description.slice(0, 100) : ''),
      keywords: processed.keywords || [],
      entities: processed.entities || [],
      embedding: processed.embedding,
      // 图片哈希（以图搜图）
      phash: processed.phash,
      dhash: processed.dhash,
      ahash: processed.ahash,
      hash_algorithm: processed.hash_algorithm,
      path: processed.path,
      // 情绪字段
      sentiment_label: emo.sentiment?.label || null,
      sentiment_positive: emo.sentiment?.scores?.positive,
      sentiment_negative: emo.sentiment?.scores?.negative,
      sentiment_neutral: emo.sentiment?.scores?.neutral,
      primary_emotion_label: Array.isArray(emo.emotions) && emo.emotions[0] ? emo.emotions[0].label : null,
      primary_emotion_score: Array.isArray(emo.emotions) && emo.emotions[0] ? emo.emotions[0].score : null,
      emotion_labels: emo.emotion_labels || [],
      emotion_values: emo.emotion_values || [],
      vad_valence: emo.vad?.valence,
      vad_arousal: emo.vad?.arousal,
      vad_dominance: emo.vad?.dominance,
      stress_score: emo.stress?.score,
      stress_level: emo.stress?.level,
      // 时间
      timestamp: processed.timestamp,
      local_time: processed.local_time,
      created_at: processed.created_at,
      metadata: processed.metadata
    });

    // 文档 -> Chunk 关系
    await neo4jStorage.runQuery(
      'MATCH (d:Document {id: $docId}), (c:Chunk {id: $chunkId}) ' +
      'MERGE (d)-[:CONTAINS]->(c)',
      { docId: document.id, chunkId: processed.id }
    );

    return {
      document: docNode,
      image: imageNode,
      chunks: [chunkNode]
    };
  }

  /**
   * 处理纯文本文档（供 SDK 调用）
   * @param {string} content - 文本内容
   * @param {Object} options - 处理选项 { documentId, title, filename, source, metadata }
   * @returns {Object} 插入结果
   */
  async processDocument(content, options = {}) {
    this.ensureInitialized();
    const id = options.documentId || `doc_${crypto.randomUUID()}`;
    const title = options.title || '未命名文档';
    const filename = options.filename || `${title}.txt`;

    // 创建文档节点
    const docNode = await neo4jStorage.createDocument({
      id,
      filename,
      type: 'text',
      size: Buffer.byteLength(String(content || ''), 'utf-8'),
      path: options.source || '',
      mimeType: 'text/plain',
      metadata: JSON.stringify({
        title,
        source: options.source || 'sdk',
        ...(options.metadata || {})
      })
    });

    // 复用文本插入流程
    const result = await this.insertTextDocument({
      id,
      filename,
      type: 'text',
      size: docNode.size,
      path: docNode.path,
      mimeType: 'text/plain',
      content: String(content || ''),
      metadata: options.metadata || {}
    }, docNode);

    return result;
  }

  /**
   * 查询知识库
   * @param {string} query - 查询文本
   * @param {Object} options - 查询选项
   * @returns {Object} 查询结果
   */
  async query(query, options = {}) {
    try {
      this.ensureInitialized();
      logger.info(`开始查询: "${query}"`);

      const {
        mode = 'hybrid',
        limit = 10,
        threshold = 0.7,
        includeImages = true,
        includeEntities = true
      } = options;

      // 检查缓存
      const cacheKey = this.getCacheKey(query, options);
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        logger.info('返回缓存结果');
        return cached;
      }

      let results = {};

      // 1. 向量检索
      if (mode === 'vector' || mode === 'hybrid') {
        results.vectorResults = await this.vectorSearch(query, { limit, threshold });
      }

      // 2. 图谱检索
      if (mode === 'graph' || mode === 'hybrid') {
        results.graphResults = await this.graphSearch(query, { limit, includeEntities });
      }

      // 3. 图片检索
      if (includeImages && (mode === 'vector' || mode === 'hybrid')) {
        results.imageResults = await this.imageSearch(query, { limit, threshold });
      }

      // 4. 合并和排序结果
      const finalResults = await this.mergeResults(results, options);

      // 缓存结果
      this.setCache(cacheKey, finalResults);

      logger.info(`查询完成: "${query}"`, {
        vectorResults: results.vectorResults?.length || 0,
        graphResults: results.graphResults?.length || 0,
        imageResults: results.imageResults?.length || 0,
        finalResults: finalResults.length
      });

      return {
        query,
        results: finalResults,
        totalFound: finalResults.length,
        searchMeta: {
          mode,
          threshold,
          limit,
          searchTime: Date.now()
        }
      };

    } catch (error) {
      logger.error(`查询失败: "${query}"`, { error: error.message });
      throw new Error(`查询处理失败: ${error.message}`);
    }
  }

  /**
   * 向量搜索
   * @param {string} query - 查询文本
   * @param {Object} options - 搜索选项
   * @returns {Array} 搜索结果
   */
  async vectorSearch(query, options = {}) {
    const { limit = 10, threshold = 0.7 } = options;

    // 1. 生成查询向量
    const queryEmbedding = await embeddingService.getTextEmbedding(query);

    // 2. 搜索相似文本块
    const chunkResults = await neo4jStorage.vectorSearch(
      queryEmbedding, 'Chunk', limit, threshold
    );

    // 3. 获取相关文档信息
    const results = [];
    for (const result of chunkResults) {
      const docQuery = await neo4jStorage.runQuery(
        'MATCH (d:Document)-[:CONTAINS]->(c:Chunk {id: $chunkId}) RETURN d',
        { chunkId: result.node.id }
      );

      if (docQuery.records.length > 0) {
        const doc = docQuery.records[0].get('d').properties;
        results.push({
          type: 'text',
          score: result.score,
          content: result.node.content,
          title: result.node.title,
          summary: result.node.summary,
          keywords: result.node.keywords,
          entities: result.node.entities,
          sao: result.node.sao,
          timestamp: result.node.timestamp,
          document: doc,
          chunk: result.node
        });
      }
    }

    return results;
  }

  /**
   * 图谱搜索
   * @param {string} query - 查询文本
   * @param {Object} options - 搜索选项
   * @returns {Array} 搜索结果
   */
  async graphSearch(query, options = {}) {
    const { limit = 10, includeEntities = true } = options;

    // 1. 提取查询中的实体
    const queryEntities = await textProcessor.extractEntities(query);
    
    if (!Array.isArray(queryEntities) || queryEntities.length === 0) {
      return [];
    }

    const results = [];

    // 2. 查找匹配的实体
    for (const queryEntity of queryEntities.slice(0, 5)) { // 限制查询实体数量
      const entityQuery = await neo4jStorage.runQuery(
        'MATCH (e:Entity) WHERE e.name CONTAINS $name OR $name CONTAINS e.name ' +
        'RETURN e ORDER BY e.frequency DESC LIMIT toInteger($limit)',
        { name: queryEntity.name, limit: 5 }
      );

      // 3. 获取相关文档和关系
      for (const record of entityQuery.records) {
        const entity = record.get('e').properties;

        // 获取提及该实体的文档
        const docQuery = await neo4jStorage.runQuery(
          'MATCH (d:Document)-[:MENTIONS]->(e:Entity {id: $entityId}) RETURN d',
          { entityId: entity.id }
        );

        for (const docRecord of docQuery.records) {
          const doc = docRecord.get('d').properties;
          results.push({
            type: 'entity',
            score: entity.confidence || 0.5,
            entity,
            document: doc,
            relevantTo: queryEntity.name
          });
        }

        // 获取相关实体关系
        if (includeEntities) {
          const relationQuery = await neo4jStorage.runQuery(
            'MATCH (e1:Entity {id: $entityId})-[r:RELATED]-(e2:Entity) ' +
            'RETURN e1, r, e2 LIMIT 5',
            { entityId: entity.id }
          );

          for (const relRecord of relationQuery.records) {
            const relation = relRecord.get('r').properties;
            const relatedEntity = relRecord.get('e2').properties;
            
            results.push({
              type: 'relation',
              score: relation.confidence || 0.5,
              entity,
              relatedEntity,
              relation,
              relevantTo: queryEntity.name
            });
          }
        }
      }
    }

    return results.slice(0, limit);
  }

  /**
   * 图片搜索
   * @param {string} query - 查询文本
   * @param {Object} options - 搜索选项
   * @returns {Array} 搜索结果
   */
  async imageSearch(query, options = {}) {
    const { limit = 10, threshold = 0.7 } = options;

    // 1. 生成查询向量
    const queryEmbedding = await embeddingService.getTextEmbedding(query);

    // 2. 搜索相似图片
    const imageResults = await neo4jStorage.vectorSearch(
      queryEmbedding, 'Image', limit, threshold
    );

    // 3. 获取相关文档信息
    const results = [];
    for (const result of imageResults) {
      const docQuery = await neo4jStorage.runQuery(
        'MATCH (d:Document)-[:CONTAINS]->(i:Image {id: $imageId}) RETURN d',
        { imageId: result.node.id }
      );

      if (docQuery.records.length > 0) {
        const doc = docQuery.records[0].get('d').properties;
        results.push({
          type: 'image',
          score: result.score,
          description: result.node.description,
          document: doc,
          image: result.node
        });
      }
    }

    return results;
  }

  /**
   * 合并和排序搜索结果
   * @param {Object} results - 各类搜索结果
   * @param {Object} options - 合并选项
   * @returns {Array} 最终结果
   */
  async mergeResults(results, options = {}) {
    const { limit = 10 } = options;
    const allResults = [];

    // 收集所有结果
    if (results.vectorResults) allResults.push(...results.vectorResults);
    if (results.graphResults) allResults.push(...results.graphResults);
    if (results.imageResults) allResults.push(...results.imageResults);

    // 按分数排序并去重
    const uniqueResults = this.deduplicateResults(allResults);
    uniqueResults.sort((a, b) => b.score - a.score);

    return uniqueResults.slice(0, limit);
  }

  /**
   * 去重结果
   * @param {Array} results - 结果数组
   * @returns {Array} 去重后的结果
   */
  deduplicateResults(results) {
    const seen = new Set();
    return results.filter(result => {
      const key = result.document?.id + '_' + result.type;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 生成缓存键
   * @param {string} query - 查询
   * @param {Object} options - 选项
   * @returns {string} 缓存键
   */
  getCacheKey(query, options) {
    const key = JSON.stringify({ query, options });
    return crypto.createHash('md5').update(key).digest('hex');
  }

  /**
   * 从缓存获取结果
   * @param {string} key - 缓存键
   * @returns {any} 缓存值
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  /**
   * 设置缓存
   * @param {string} key - 缓存键
   * @param {any} data - 数据
   */
  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });

    // 清理过期缓存
    if (this.cache.size > config.cache.maxKeys) {
      this.cleanCache();
    }
  }

  /**
   * 清理过期缓存
   */
  cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp >= this.cacheTimeout) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 清除相关缓存
   * @param {string} filename - 文件名
   */
  clearRelevantCache(filename) {
    // 简单清除所有缓存，可以后续优化为智能清除
    this.cache.clear();
    logger.debug(`已清除缓存: ${filename}`);
  }

  /**
   * 确保服务已初始化
   */
  ensureInitialized() {
    if (!this.isInitialized) {
      throw new Error('RAG 服务未初始化，请先调用 initialize() 方法');
    }
  }

  /**
   * 获取知识库统计信息
   * @returns {Object} 统计信息
   */
  async getStats() {
    this.ensureInitialized();
    const dbStats = await neo4jStorage.getStats();
    return {
      ...dbStats,
      cacheSize: this.cache.size,
      embeddingCacheSize: embeddingService.getCacheStats().size
    };
  }

  /**
   * 关闭服务
   */
  async close() {
    if (this.isInitialized) {
      await neo4jStorage.close();
      this.cache.clear();
      this.isInitialized = false;
      logger.info('RAG 服务已关闭');
    }
  }
}

// 创建单例实例
const ragService = new RAGService();

export default ragService;
