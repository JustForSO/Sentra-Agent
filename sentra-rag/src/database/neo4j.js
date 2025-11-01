import neo4j from 'neo4j-driver';
import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import embeddingService from '../services/embedding.js';

const logger = createLogger('Neo4j');

/**
 * Neo4j 数据库连接管理器
 * 提供数据库连接、会话管理和基础CRUD操作
 */
class Neo4jStorage {
  constructor() {
    this.driver = null;
    this.isConnected = false;
  }

  /**
   * 按情绪/情感过滤搜索文本块
   * @param {Object} filters - 过滤条件
   *   { labels?: string|string[], match?: 'any'|'all',
   *     primaryLabel?: string, minPrimaryScore?: number,
   *     sentimentLabel?: 'positive'|'negative'|'neutral', minSentimentScore?: number,
   *     vad?: { minValence?, maxValence?, minArousal?, maxArousal?, minDominance?, maxDominance? },
   *     stress?: { minScore?, level? } }
   * @param {Object} options - 选项 { limit?: number, orderBy?: string, order?: 'asc'|'desc' }
   * @returns {Array} 文本块列表
   */
  async searchChunksByEmotion(filters = {}, options = {}) {
    const labels = Array.isArray(filters.labels)
      ? filters.labels.filter(Boolean).map(String)
      : (filters.labels ? [String(filters.labels)] : []);
    const match = (filters.match || 'any').toLowerCase();
    const primaryLabel = filters.primaryLabel ? String(filters.primaryLabel) : null;
    const minPrimaryScore = Number.isFinite(filters.minPrimaryScore) ? filters.minPrimaryScore : null;
    const sentimentLabel = filters.sentimentLabel && ['positive','negative','neutral'].includes(String(filters.sentimentLabel))
      ? String(filters.sentimentLabel) : null;
    const minSentimentScore = Number.isFinite(filters.minSentimentScore) ? filters.minSentimentScore : null;
    const vad = filters.vad || {};
    const stress = filters.stress || {};

    const { limit = 10, orderBy = 'primary', order = 'desc' } = options;

    const where = [];
    const params = { limit: neo4j.int(Math.trunc(limit)) };

    if (labels.length > 0) {
      params.labels = labels;
      if (match === 'all') {
        where.push('all(lbl IN $labels WHERE lbl IN coalesce(c.emotion_labels, []))');
      } else {
        where.push('any(lbl IN $labels WHERE lbl IN coalesce(c.emotion_labels, []))');
      }
    }

    if (primaryLabel) {
      params.primaryLabel = primaryLabel;
      where.push('c.primary_emotion_label = $primaryLabel');
    }
    if (minPrimaryScore !== null) {
      params.minPrimaryScore = minPrimaryScore;
      where.push('c.primary_emotion_score >= $minPrimaryScore');
    }

    if (sentimentLabel) {
      params.sentimentLabel = sentimentLabel;
      where.push('c.sentiment_label = $sentimentLabel');
      if (minSentimentScore !== null) {
        const fieldMap = {
          positive: 'c.sentiment_positive',
          negative: 'c.sentiment_negative',
          neutral: 'c.sentiment_neutral'
        };
        params.minSentimentScore = minSentimentScore;
        where.push(`${fieldMap[sentimentLabel]} >= $minSentimentScore`);
      }
    }

    if (Number.isFinite(vad.minValence)) { params.minValence = vad.minValence; where.push('c.vad_valence >= $minValence'); }
    if (Number.isFinite(vad.maxValence)) { params.maxValence = vad.maxValence; where.push('c.vad_valence <= $maxValence'); }
    if (Number.isFinite(vad.minArousal)) { params.minArousal = vad.minArousal; where.push('c.vad_arousal >= $minArousal'); }
    if (Number.isFinite(vad.maxArousal)) { params.maxArousal = vad.maxArousal; where.push('c.vad_arousal <= $maxArousal'); }
    if (Number.isFinite(vad.minDominance)) { params.minDominance = vad.minDominance; where.push('c.vad_dominance >= $minDominance'); }
    if (Number.isFinite(vad.maxDominance)) { params.maxDominance = vad.maxDominance; where.push('c.vad_dominance <= $maxDominance'); }

    if (Number.isFinite(stress.minScore)) { params.minStressScore = stress.minScore; where.push('c.stress_score >= $minStressScore'); }
    if (stress.level) { params.stressLevel = String(stress.level); where.push('c.stress_level = $stressLevel'); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orderKey = (orderBy || 'primary').toLowerCase();
    const orderFieldMap = {
      primary: 'c.primary_emotion_score',
      'sentiment_positive': 'c.sentiment_positive',
      'sentiment_negative': 'c.sentiment_negative',
      'sentiment_neutral': 'c.sentiment_neutral',
      'vad_valence': 'c.vad_valence',
      'vad_arousal': 'c.vad_arousal',
      'vad_dominance': 'c.vad_dominance',
      'stress_score': 'c.stress_score',
      timestamp: 'c.timestamp'
    };
    const orderField = orderFieldMap[orderKey] || 'c.primary_emotion_score';
    const orderDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const query = `
      MATCH (c:Chunk)
      ${whereClause}
      RETURN c
      ORDER BY ${orderField} ${orderDir}
      LIMIT $limit
    `;

    const result = await this.runQuery(query, params);
    return result.records.map(r => r.get('c').properties);
  }

  /**
   * 确保指定的向量索引存在且维度正确；若不匹配则重建
   */
  async ensureVectorIndex(session, { indexName, label, property, dim }) {
    try {
      const show = await session.run('SHOW INDEXES YIELD name, options RETURN name, options');
      const rows = show.records.map(r => ({ name: r.get('name'), options: r.get('options') }));
      const found = rows.find(r => r.name === indexName);
      let currentDim;
      if (found && found.options) {
        try {
          // options.indexConfig['vector.dimensions']
          const cfg = found.options.indexConfig || found.options['indexConfig'];
          currentDim = cfg ? (cfg['vector.dimensions'] || cfg["vector.dimensions"]) : undefined;
        } catch {}
      }

      if (found && Number.isFinite(currentDim) && Math.trunc(currentDim) === Math.trunc(dim)) {
        logger.info(`✅ 向量索引已存在且维度匹配: ${indexName} (dim=${currentDim})`);
        return;
      }

      if (found) {
        // 尝试删除后重建
        try {
          await session.run(`DROP INDEX ${indexName} IF EXISTS`);
          logger.warn(`🔧 已删除维度不匹配的索引: ${indexName} (was ${currentDim})`);
        } catch (e) {
          logger.warn(`⚠️ 删除索引失败: ${indexName} - ${e.message}`);
        }
      }

      // 创建新索引
      try {
        await session.run(`
          CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
          FOR (n:${label}) ON (n.${property})
          OPTIONS {
            indexConfig: {
              \`vector.dimensions\`: ${Math.trunc(dim)},
              \`vector.similarity_function\`: 'cosine'
            }
          }
        `);
        logger.info(`✅ 向量索引创建成功: ${indexName} (dim=${dim})`);
      } catch (error1) {
        try {
          await session.run(`CREATE INDEX IF NOT EXISTS FOR (n:${label}) ON (n.${property}_hash)`);
          logger.warn(`⚠️ 未支持向量索引，已创建哈希索引: ${indexName}`);
        } catch (error2) {
          logger.warn(`⚠️ 无法创建向量/哈希索引: ${indexName} - ${error1.message}`);
        }
      }
    } catch (err) {
      logger.warn(`⚠️ 确保向量索引失败: ${indexName} - ${err.message}`);
    }
  }

  /**
   * 获取嵌入向量维度：优先使用配置，缺省则探测一次
   */
  async getEmbeddingDimension() {
    if (Number.isFinite(config.openai.embeddingDimensions)) {
      return Math.trunc(config.openai.embeddingDimensions);
    }
    try {
      const probe = await embeddingService.getTextEmbedding('dimension_probe');
      const dim = Array.isArray(probe) ? probe.length : (Array.isArray(probe?.[0]) ? probe[0].length : undefined);
      if (Number.isFinite(dim) && dim > 0) {
        logger.info(`探测到嵌入维度: ${dim}`);
        return dim;
      }
    } catch (e) {
      logger.warn('无法探测嵌入维度，使用默认 1536（仅用于索引创建）', { error: e.message });
    }
    return 1536;
  }

  /**
   * 初始化数据库连接
   */
  async initialize() {
    try {
      logger.info('正在连接到 Neo4j 数据库...');
      
      // 输出连接参数用于调试
      logger.debug('Neo4j 连接参数:', {
        uri: config.neo4j.uri,
        username: config.neo4j.username,
        passwordSet: !!config.neo4j.password,
        database: config.neo4j.database,
        connectionTimeout: config.neo4j.connectionTimeout
      });

      if (!config.neo4j.password) {
        throw new Error('Neo4j 密码未设置，请检查环境变量 NEO4J_PASSWORD');
      }
      
      this.driver = neo4j.driver(
        config.neo4j.uri,
        neo4j.auth.basic(config.neo4j.username, config.neo4j.password),
        {
          maxConnectionPoolSize: config.neo4j.maxConnectionPoolSize,
          connectionTimeout: config.neo4j.connectionTimeout,
          disableLosslessIntegers: true
        }
      );

      logger.info('验证 Neo4j 连接...');
      // 验证连接
      await this.driver.verifyConnectivity();
      logger.info('✅ Neo4j 连接验证成功');
      
      // 测试简单查询
      logger.info('执行测试查询...');
      const session = this.driver.session();
      try {
        const result = await session.run('RETURN 1 as test');
        if (result.records.length > 0) {
          logger.info('✅ Neo4j 测试查询成功');
        }
      } finally {
        await session.close();
      }
      
      // 创建必要的索引和约束
      logger.info('创建数据库索引...');
      await this.createIndexes();
      
      this.isConnected = true;
      logger.info('✅ Neo4j 数据库初始化完成');
    } catch (error) {
      logger.error('❌ Neo4j 数据库连接失败', { 
        error: error.message,
        code: error.code,
        uri: config.neo4j.uri,
        username: config.neo4j.username
      });
      
      // 提供具体的解决建议
      if (error.code === 'ServiceUnavailable') {
        logger.error('💡 建议: Neo4j 服务未启动或无法访问，请检查服务状态');
      } else if (error.code === 'Neo.ClientError.Security.Unauthorized') {
        logger.error('💡 建议: 用户名或密码错误，请检查认证信息');
      }
      
      throw error;
    }
  }

  /**
   * 创建数据库索引和约束
   */
  async createIndexes() {
    const session = this.driver.session();
    try {
      // 解析或探测嵌入维度
      const dim = await this.getEmbeddingDimension();
      const basicIndexes = [
        // 文档节点索引
        'CREATE INDEX IF NOT EXISTS FOR (d:Document) ON (d.id)',
        'CREATE INDEX IF NOT EXISTS FOR (d:Document) ON (d.filename)',
        'CREATE INDEX IF NOT EXISTS FOR (d:Document) ON (d.created_at)',
        
        // 文本块节点索引
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.id)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.document_id)',
        'CREATE FULLTEXT INDEX chunk_content IF NOT EXISTS FOR (c:Chunk) ON EACH [c.content, c.contextualized, c.title, c.summary]',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.keywords)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.entities)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.sentiment_label)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.primary_emotion_label)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.emotion_labels)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.primary_emotion_score)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.vad_valence)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.vad_arousal)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.vad_dominance)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.stress_score)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.timestamp)',
        'CREATE INDEX IF NOT EXISTS FOR (c:Chunk) ON (c.local_time)',
        
        // 实体节点索引
        'CREATE INDEX IF NOT EXISTS FOR (e:Entity) ON (e.id)',
        'CREATE INDEX IF NOT EXISTS FOR (e:Entity) ON (e.name)',
        'CREATE INDEX IF NOT EXISTS FOR (e:Entity) ON (e.type)',
        
        // 图片节点索引
        'CREATE INDEX IF NOT EXISTS FOR (i:Image) ON (i.id)',
        'CREATE INDEX IF NOT EXISTS FOR (i:Image) ON (i.filename)'
      ];

      // 创建基础索引
      for (const query of basicIndexes) {
        try {
          await session.run(query);
          logger.debug(`✅ 索引创建成功: ${query.substring(0, 50)}...`);
        } catch (error) {
          logger.warn(`⚠️ 索引创建跳过: ${error.message}`);
        }
      }

      // 确保向量索引维度与配置匹配
      await this.ensureVectorIndex(session, {
        indexName: 'chunk_embeddings',
        label: 'Chunk',
        property: 'embedding',
        dim
      });
      await this.ensureVectorIndex(session, {
        indexName: 'image_embeddings',
        label: 'Image',
        property: 'embedding',
        dim
      });
      
      logger.info('✅ 数据库索引创建完成');
    } catch (error) {
      logger.error('❌ 创建数据库索引失败', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * 获取数据库会话
   * @param {string} database - 数据库名称
   * @returns {Object} Neo4j 会话对象
   */
  getSession(database = config.neo4j.database) {
    if (!this.isConnected) {
      throw new Error('数据库未连接，请先调用 initialize() 方法');
    }
    return this.driver.session({ database });
  }

  /**
   * 执行单个查询
   * @param {string} query - Cypher 查询语句
   * @param {Object} params - 查询参数
   * @returns {Object} 查询结果
   */
  async runQuery(query, params = {}) {
    const session = this.getSession();
    try {
      logger.debug('执行查询', { query, params });
      const result = await session.run(query, params);
      return result;
    } catch (error) {
      logger.error('查询执行失败', { query, params, error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * 执行事务性查询
   * @param {Function} transactionWork - 事务工作函数
   * @returns {any} 事务结果
   */
  async runTransaction(transactionWork) {
    const session = this.getSession();
    try {
      return await session.executeWrite(transactionWork);
    } catch (error) {
      logger.error('事务执行失败', { error: error.message });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * 创建文档节点
   * @param {Object} document - 文档信息
   * @returns {Object} 创建的文档节点
   */
  async createDocument(document) {
    const query = `
      CREATE (d:Document {
        id: $id,
        filename: $filename,
        type: $type,
        size: $size,
        path: $path,
        mime_type: $mimeType,
        created_at: datetime(),
        updated_at: datetime(),
        metadata: $metadata
      })
      RETURN d
    `;
    
    const result = await this.runQuery(query, document);
    return result.records[0]?.get('d').properties;
  }

  /**
   * 创建文本块节点
   * @param {Object} chunk - 文本块信息
   * @returns {Object} 创建的文本块节点
   */
  async createChunk(chunk) {
    // 标准化输入
    const now = new Date();
    const keywords = Array.isArray(chunk.keywords)
      ? chunk.keywords.map(String)
      : (typeof chunk.keywords === 'string' && chunk.keywords ? [String(chunk.keywords)] : null);
    const entities = Array.isArray(chunk.entities)
      ? chunk.entities.map(String)
      : (typeof chunk.entities === 'string' && chunk.entities ? [String(chunk.entities)] : null);
    const sao = Array.isArray(chunk.sao)
      ? chunk.sao.map(s => {
          if (typeof s === 'string') return s;
          try {
            const subj = s?.subject ?? '';
            const act = s?.action ?? '';
            const obj = s?.object ?? '';
            return [subj, act, obj].filter(Boolean).join('-');
          } catch { return ''; }
        }).filter(Boolean)
      : null;

    const params = {
      id: chunk.id,
      document_id: chunk.document_id || chunk.documentId,
      content: chunk.content,
      contextualized: chunk.contextualized || null,
      rawContent: chunk.rawContent || null,
      title: chunk.title || null,
      summary: chunk.summary || null,
      keywords,
      entities,
      sao,
      index: Number.isFinite(chunk.index) ? chunk.index : (Number.isFinite(chunk.position) ? chunk.position : null),
      tokens: chunk.tokens || 0,
      start: Number.isFinite(chunk.start) ? chunk.start : null,
      end: Number.isFinite(chunk.end) ? chunk.end : null,
      embedding: Array.isArray(chunk.embedding) ? chunk.embedding : null,
      // 图片哈希字段（用于以图搜图）
      phash: chunk.phash || null,
      dhash: chunk.dhash || null,
      ahash: chunk.ahash || null,
      hash_algorithm: chunk.hash_algorithm || null,
      path: chunk.path || null,
      // 情绪/情感字段
      sentiment_label: chunk.sentiment_label ?? null,
      sentiment_positive: Number.isFinite(chunk.sentiment_positive) ? chunk.sentiment_positive : null,
      sentiment_negative: Number.isFinite(chunk.sentiment_negative) ? chunk.sentiment_negative : null,
      sentiment_neutral: Number.isFinite(chunk.sentiment_neutral) ? chunk.sentiment_neutral : null,
      primary_emotion_label: chunk.primary_emotion_label ?? null,
      primary_emotion_score: Number.isFinite(chunk.primary_emotion_score) ? chunk.primary_emotion_score : null,
      emotion_labels: Array.isArray(chunk.emotion_labels) ? chunk.emotion_labels.map(String) : null,
      emotion_values: Array.isArray(chunk.emotion_values) ? chunk.emotion_values.map(Number) : null,
      vad_valence: Number.isFinite(chunk.vad_valence) ? chunk.vad_valence : null,
      vad_arousal: Number.isFinite(chunk.vad_arousal) ? chunk.vad_arousal : null,
      vad_dominance: Number.isFinite(chunk.vad_dominance) ? chunk.vad_dominance : null,
      stress_score: Number.isFinite(chunk.stress_score) ? chunk.stress_score : null,
      stress_level: chunk.stress_level ?? null,
      // 时间戳
      timestamp: chunk.timestamp || now.getTime(),
      local_time: chunk.local_time || now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      created_at: chunk.created_at || now.toISOString(),
      // 元数据（转为JSON字符串，因为Neo4j不支持嵌套对象）
      metadata: chunk.metadata ? JSON.stringify(chunk.metadata) : null
    };

    const query = `
      CREATE (c:Chunk {
        id: $id,
        document_id: $document_id,
        content: $content,
        contextualized: $contextualized,
        rawContent: $rawContent,
        title: $title,
        summary: $summary,
        keywords: $keywords,
        entities: $entities,
        sao: $sao,
        index: $index,
        tokens: $tokens,
        start: $start,
        end: $end,
        embedding: $embedding,
        phash: $phash,
        dhash: $dhash,
        ahash: $ahash,
        hash_algorithm: $hash_algorithm,
        path: $path,
        sentiment_label: $sentiment_label,
        sentiment_positive: $sentiment_positive,
        sentiment_negative: $sentiment_negative,
        sentiment_neutral: $sentiment_neutral,
        primary_emotion_label: $primary_emotion_label,
        primary_emotion_score: $primary_emotion_score,
        emotion_labels: $emotion_labels,
        emotion_values: $emotion_values,
        vad_valence: $vad_valence,
        vad_arousal: $vad_arousal,
        vad_dominance: $vad_dominance,
        stress_score: $stress_score,
        stress_level: $stress_level,
        timestamp: $timestamp,
        local_time: $local_time,
        created_at: $created_at,
        metadata: $metadata
      })
      RETURN c
    `;
    
    const result = await this.runQuery(query, params);
    return result.records[0]?.get('c').properties;
  }

  /**
   * 创建图片节点
   * @param {Object} image - 图片信息
   * @returns {Object} 创建的图片节点
   */
  async createImage(image) {
    const query = `
      CREATE (i:Image {
        id: $id,
        filename: $filename,
        path: $path,
        width: $width,
        height: $height,
        format: $format,
        size: $size,
        embedding: $embedding,
        description: $description,
        created_at: datetime(),
        metadata: $metadata
      })
      RETURN i
    `;
    
    const result = await this.runQuery(query, image);
    return result.records[0]?.get('i').properties;
  }

  /**
   * 向量相似性搜索
   * @param {Array} embedding - 查询向量
   * @param {string} nodeType - 节点类型 (Chunk 或 Image)
   * @param {number} limit - 返回结果数量
   * @param {number} threshold - 相似度阈值
   * @returns {Array} 相似节点列表
   */
  async vectorSearch(embedding, nodeType = 'Chunk', limit = 10, threshold = 0.7) {
    const indexName = nodeType === 'Chunk' ? 'chunk_embeddings' : 'image_embeddings';
    const query = `
      CALL db.index.vector.queryNodes($indexName, $limit, $embedding)
      YIELD node, score
      WHERE score >= $threshold
      RETURN node, score
      ORDER BY score DESC
    `;
    
    const result = await this.runQuery(query, {
      indexName,
      limit: neo4j.int(Math.trunc(limit)),
      embedding,
      threshold
    });
    
    return result.records.map(record => ({
      node: record.get('node').properties,
      score: record.get('score')
    }));
  }

  /**
   * 关闭数据库连接
   */
  async close() {
    if (this.driver) {
      await this.driver.close();
      this.isConnected = false;
      logger.info('🔌 Neo4j 数据库连接已关闭');
    }
  }

  /**
   * 保存文档
   * @param {Object} document - 文档对象
   * @returns {Object} 保存结果
   */
  async saveDocument(document) {
    const query = `
      CREATE (d:Document {
        id: $id,
        title: $title,
        content: $content,
        filename: $filename,
        type: $type,
        size: $size,
        created_at: $created_at,
        updated_at: datetime()
      })
      RETURN d
    `;
    
    const result = await this.runQuery(query, document);
    return result.records[0]?.get('d').properties;
  }

  /**
   * 保存文本块
   * @param {Object} chunk - 文本块对象
   * @returns {Object} 保存结果
   */
  async saveChunk(chunk) {
    // 添加时间戳信息
    const now = new Date();
    // 规范化字段
    const keywords = Array.isArray(chunk.keywords)
      ? chunk.keywords.map(String)
      : (typeof chunk.keywords === 'string' && chunk.keywords ? [String(chunk.keywords)] : null);
    const entities = Array.isArray(chunk.entities)
      ? chunk.entities.map(String)
      : (typeof chunk.entities === 'string' && chunk.entities ? [String(chunk.entities)] : null);
    const sao = Array.isArray(chunk.sao)
      ? chunk.sao.map(s => {
          if (typeof s === 'string') return s;
          try {
            const subj = s?.subject ?? '';
            const act = s?.action ?? '';
            const obj = s?.object ?? '';
            return [subj, act, obj].filter(Boolean).join('-');
          } catch { return ''; }
        }).filter(Boolean)
      : null;
    const chunkWithTimestamp = {
      // 基本标识
      id: chunk.id,
      document_id: chunk.document_id ?? chunk.documentId ?? null,
      // 文本内容与派生信息
      content: chunk.content ?? null,
      contextualized: chunk.contextualized ?? null,
      rawContent: chunk.rawContent ?? null,
      title: chunk.title ?? null,
      summary: chunk.summary ?? null,
      keywords,
      entities,
      sao,
      // 位置与统计
      index: Number.isFinite(chunk.index) ? chunk.index : null,
      tokens: Number.isFinite(chunk.tokens) ? chunk.tokens : 0,
      start: Number.isFinite(chunk.start) ? chunk.start : null,
      end: Number.isFinite(chunk.end) ? chunk.end : null,
      embedding: Array.isArray(chunk.embedding) ? chunk.embedding : null,
      // 图片哈希（用于以图搜图）
      phash: chunk.phash ?? null,
      dhash: chunk.dhash ?? null,
      ahash: chunk.ahash ?? null,
      hash_algorithm: chunk.hash_algorithm ?? null,
      path: chunk.path ?? null,
      // 情绪/情感字段
      sentiment_label: chunk.sentiment_label ?? null,
      sentiment_positive: Number.isFinite(chunk.sentiment_positive) ? chunk.sentiment_positive : null,
      sentiment_negative: Number.isFinite(chunk.sentiment_negative) ? chunk.sentiment_negative : null,
      sentiment_neutral: Number.isFinite(chunk.sentiment_neutral) ? chunk.sentiment_neutral : null,
      primary_emotion_label: chunk.primary_emotion_label ?? null,
      primary_emotion_score: Number.isFinite(chunk.primary_emotion_score) ? chunk.primary_emotion_score : null,
      emotion_labels: Array.isArray(chunk.emotion_labels) ? chunk.emotion_labels.map(String) : null,
      emotion_values: Array.isArray(chunk.emotion_values) ? chunk.emotion_values.map(Number) : null,
      vad_valence: Number.isFinite(chunk.vad_valence) ? chunk.vad_valence : null,
      vad_arousal: Number.isFinite(chunk.vad_arousal) ? chunk.vad_arousal : null,
      vad_dominance: Number.isFinite(chunk.vad_dominance) ? chunk.vad_dominance : null,
      stress_score: Number.isFinite(chunk.stress_score) ? chunk.stress_score : null,
      stress_level: chunk.stress_level ?? null,
      // 时间戳（保留原有时间戳或使用当前时间）
      timestamp: chunk.timestamp ?? now.getTime(),
      local_time: chunk.local_time ?? now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      created_at: chunk.created_at ?? now.toISOString(),
      // 元数据（转为JSON字符串，因为Neo4j不支持嵌套对象）
      metadata: chunk.metadata ? JSON.stringify(chunk.metadata) : null
    };

    const query = `
      CREATE (c:Chunk {
        id: $id,
        document_id: $document_id,
        content: $content,
        contextualized: $contextualized,
        rawContent: $rawContent,
        title: $title,
        summary: $summary,
        keywords: $keywords,
        entities: $entities,
        sao: $sao,
        index: $index,
        tokens: $tokens,
        start: $start,
        end: $end,
        embedding: $embedding,
        phash: $phash,
        dhash: $dhash,
        ahash: $ahash,
        hash_algorithm: $hash_algorithm,
        path: $path,
        sentiment_label: $sentiment_label,
        sentiment_positive: $sentiment_positive,
        sentiment_negative: $sentiment_negative,
        sentiment_neutral: $sentiment_neutral,
        primary_emotion_label: $primary_emotion_label,
        primary_emotion_score: $primary_emotion_score,
        emotion_labels: $emotion_labels,
        emotion_values: $emotion_values,
        vad_valence: $vad_valence,
        vad_arousal: $vad_arousal,
        vad_dominance: $vad_dominance,
        stress_score: $stress_score,
        stress_level: $stress_level,
        timestamp: $timestamp,
        local_time: $local_time,
        created_at: $created_at,
        metadata: $metadata
      })
      RETURN c
    `;
    
    const result = await this.runQuery(query, chunkWithTimestamp);
    return result.records[0]?.get('c').properties;
  }

  /**
   * 获取文档列表
   * @param {Object} options - 查询选项
   * @returns {Array} 文档列表
   */
  async getDocuments(options = {}) {
    const { limit = 50, offset = 0 } = options;
    
    const query = `
      MATCH (d:Document)
      RETURN d
      ORDER BY d.created_at DESC
      SKIP $offset
      LIMIT $limit
    `;
    
    const result = await this.runQuery(query, { limit: neo4j.int(Math.trunc(limit)), offset: neo4j.int(Math.trunc(offset)) });
    return result.records.map(record => record.get('d').properties);
  }

  /**
   * 根据文档ID获取文档详情
   * @param {string} documentId - 文档ID
   * @returns {Object|null} 文档
   */
  async getDocumentById(documentId) {
    const query = `
      MATCH (d:Document {id: $documentId})
      RETURN d
    `;
    const result = await this.runQuery(query, { documentId });
    if (result.records.length === 0) return null;
    return result.records[0].get('d').properties;
  }

  /**
   * 根据文档ID获取文本块
   * @param {string} documentId - 文档ID
   * @returns {Array} 文本块列表
   */
  async getChunksByDocumentId(documentId) {
    const query = `
      MATCH (c:Chunk {document_id: $documentId})
      RETURN c
      ORDER BY c.index
    `;
    
    const result = await this.runQuery(query, { documentId });
    return result.records.map(record => record.get('c').properties);
  }

  /**
   * 搜索文本块（增强版：支持多字段和关键词匹配）
   * @param {string} searchText - 搜索文本
   * @param {Object} options - 搜索选项
   * @returns {Array} 搜索结果
   */
  async searchChunks(searchText, options = {}) {
    const { limit = 10, mode = 'hybrid' } = options;
    const results = [];
    // 本地兜底生成标题，避免出现空标题
    const ensureTitle = (p) => {
      const out = { ...p };
      let title = out.title;
      const ctx = (out.contextualized || out.content || '').trim();
      if (!title || !String(title).trim()) {
        if (Array.isArray(out.keywords) && out.keywords.length) {
          title = `${out.keywords.slice(0, 2).join('、')} | ${ctx.slice(0, 24)}`;
        } else if (Array.isArray(out.entities) && out.entities.length) {
          title = `${out.entities[0]} | ${ctx.slice(0, 24)}`;
        } else {
          title = ctx.slice(0, 24) || '未命名段落';
        }
      }
      out.title = title;
      return out;
    };
    
    // 1. 精确关键词匹配（最高优先级）
    if (mode === 'keyword' || mode === 'hybrid') {
      try {
        // 1.1 完全精确匹配
        const exactQuery = `
          MATCH (c:Chunk)
          WHERE any(keyword IN coalesce(c.keywords, []) WHERE keyword = $searchText)
             OR any(entity IN coalesce(c.entities, []) WHERE entity = $searchText)
             OR c.title = $searchText
          RETURN c, 'exact_match' as matchType, 1.0 as score
          ORDER BY c.created_at DESC
          LIMIT $limit
        `;
        const exactResult = await this.runQuery(exactQuery, { searchText, limit: neo4j.int(Math.trunc(limit)) });
        exactResult.records.forEach(record => {
          const p = ensureTitle(record.get('c').properties);
          results.push({
            ...p,
            matchType: 'exact',
            score: 1.0
          });
        });

        // 1.2 包含匹配（如果精确匹配不够）
        if (results.length < limit) {
          const partialQuery = `
            MATCH (c:Chunk)
            WHERE (any(keyword IN coalesce(c.keywords, []) WHERE keyword CONTAINS $searchText)
               OR any(entity IN coalesce(c.entities, []) WHERE entity CONTAINS $searchText)
               OR c.title CONTAINS $searchText)
              AND NOT c.id IN $excludeIds
            RETURN c, 'keyword_match' as matchType, 0.9 as score
            ORDER BY c.created_at DESC
            LIMIT $remainingLimit
          `;
          const excludeIds = results.map(r => r.id);
          const remainingLimit = limit - results.length;
          const partialResult = await this.runQuery(partialQuery, { 
            searchText, 
            excludeIds,
            remainingLimit: neo4j.int(Math.trunc(remainingLimit)) 
          });
          partialResult.records.forEach(record => {
            const p = ensureTitle(record.get('c').properties);
            results.push({
              ...p,
              matchType: 'keyword',
              score: 0.9
            });
          });
        }
      } catch (e) {
        logger.warn('关键词搜索失败，跳过', { error: e.message });
      }
    }
    
    // 2. 全文搜索（中等优先级）
    if (mode === 'fulltext' || mode === 'hybrid') {
      try {
        // 简化全文搜索，避免索引问题
        const simpleQuery = `
          MATCH (c:Chunk)
          WHERE c.content CONTAINS $searchText 
             OR c.contextualized CONTAINS $searchText
             OR c.title CONTAINS $searchText
             OR c.summary CONTAINS $searchText
          RETURN c, 'fulltext_match' as matchType, 0.7 as score
          ORDER BY c.created_at DESC
          LIMIT $limit
        `;
        const fulltextResult = await this.runQuery(simpleQuery, { 
          searchText,
          limit: neo4j.int(Math.trunc(limit)) 
        });
        fulltextResult.records.forEach(record => {
          const props = record.get('c').properties;
          const existing = results.find(r => r.id === props.id);
          if (!existing) {
            const p = ensureTitle(props);
            results.push({
              ...p,
              matchType: 'fulltext',
              score: Number(record.get('score'))
            });
          }
        });
      } catch (e) {
        logger.warn('全文搜索失败，使用基础搜索', { error: e.message });
        // 回退到基础搜索
        const basicQuery = `
          MATCH (c:Chunk)
          WHERE c.content CONTAINS $searchText 
             OR c.contextualized CONTAINS $searchText
             OR c.summary CONTAINS $searchText
          RETURN c, 'basic_match' as matchType, 0.6 as score
          ORDER BY c.created_at DESC
          LIMIT $limit
        `;
        const basicResult = await this.runQuery(basicQuery, { searchText, limit: neo4j.int(Math.trunc(limit)) });
        basicResult.records.forEach(record => {
          const props = record.get('c').properties;
          const existing = results.find(r => r.id === props.id);
          if (!existing) {
            const p = ensureTitle(props);
            results.push({
              ...p,
              matchType: 'basic',
              score: 0.6
            });
          }
        });
      }
    }
    
    // 按分数排序并限制结果数量
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * 向量相似度搜索（优先使用Neo4j向量索引，失败则JS回退）
   * @param {number[]} embedding - 查询向量
   * @param {Object} options - 搜索参数 { topK }
   * @returns {Array} [{ id, content, score }]
   */
  async vectorSimilaritySearch(embedding, options = {}) {
    const topK = Math.max(1, Math.trunc(options.topK || 5));
    // 优先尝试Neo4j向量索引
    try {
      const session = this.getSession();
      try {
        const result = await session.run(
          `CALL db.index.vector.queryNodes('chunk_embeddings', $topK, $embedding) YIELD node, score
           RETURN node, score
           ORDER BY score DESC
           LIMIT $topK`,
          { topK: neo4j.int(topK), embedding }
        );
        return result.records.map(r => ({
          ...r.get('node').properties,
          score: r.get('score')
        }));
      } finally {
        await session.close();
      }
    } catch (err) {
      // 回退：JS侧计算余弦相似
      const all = await this.runQuery(`MATCH (c:Chunk) WHERE c.embedding IS NOT NULL RETURN c`);
      const rows = all.records.map(r => r.get('c').properties).filter(p => Array.isArray(p.embedding));
      const withScore = rows.map(p => ({
        ...p,
        score: this.cosineSimilarity(embedding, p.embedding)
      }));
      withScore.sort((a, b) => b.score - a.score);
      return withScore.slice(0, topK);
    }
  }

  /**
   * 按时间戳范围搜索文本块
   * @param {Object} timeRange - 时间范围 { startTime, endTime }
   * @param {Object} options - 搜索选项
   * @returns {Array} 搜索结果
   */
  async searchChunksByTimestamp(timeRange = {}, options = {}) {
    // 兼容旧签名 (startTime, endTime, options)
    let startTime, endTime, opts = options;
    if (typeof timeRange === 'number') {
      // 使用 arguments 安全获取参数
      const args = Array.from(arguments);
      startTime = args[0];
      endTime = typeof args[1] === 'number' ? args[1] : undefined;
      opts = (args[2] && typeof args[2] === 'object') ? args[2] : (typeof args[1] === 'object' ? args[1] : {});
    } else if (timeRange && typeof timeRange === 'object') {
      ({ startTime, endTime } = timeRange);
    } else {
      startTime = undefined;
      endTime = undefined;
      opts = options || {};
    }

    const { limit = 10, orderBy = 'desc', includeNulls = false } = opts || {};
    
    let whereConditions = [];
    let params = { limit: neo4j.int(Math.trunc(limit)) };
    
    if (Number.isFinite(startTime)) {
      whereConditions.push('c.timestamp >= $startTime');
      params.startTime = neo4j.int(Math.trunc(startTime));
    }
    
    if (Number.isFinite(endTime)) {
      whereConditions.push('c.timestamp <= $endTime');
      params.endTime = neo4j.int(Math.trunc(endTime));
    }

    // 默认排除没有时间戳的旧数据，避免出现 null
    if (!includeNulls && !startTime && !endTime) {
      whereConditions.push('c.timestamp IS NOT NULL');
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const orderClause = orderBy === 'asc' ? 'ORDER BY c.timestamp ASC' : 'ORDER BY c.timestamp DESC';
    
    const query = `
      MATCH (c:Chunk)
      ${whereClause}
      RETURN c, c.timestamp as timestamp, c.local_time as localTime
      ${orderClause}
      LIMIT $limit
    `;
    
    const result = await this.runQuery(query, params);
    return result.records.map(record => ({
      ...record.get('c').properties,
      timestamp: record.get('timestamp'),
      localTime: record.get('localTime')
    }));
  }

  /**
   * 计算余弦相似度
   */
  cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    na = Math.sqrt(na); nb = Math.sqrt(nb);
    if (na === 0 || nb === 0) return 0;
    return dot / (na * nb);
  }

  /**
   * 删除文档及其相关数据
   * @param {string} documentId - 文档ID
   * @returns {Object} 删除结果
   */
  async deleteDocument(documentId) {
    const query = `
      MATCH (d:Document {id: $documentId})
      OPTIONAL MATCH (d)-[:CONTAINS]->(cRel:Chunk)
      OPTIONAL MATCH (cProp:Chunk {document_id: $documentId})
      OPTIONAL MATCH (d)-[:CONTAINS]->(img:Image)
      WITH d, collect(DISTINCT cRel) + collect(DISTINCT cProp) AS chunkNodes, collect(DISTINCT img) AS images
      UNWIND chunkNodes AS c
      FOREACH (x IN CASE WHEN c IS NULL THEN [] ELSE [c] END | DETACH DELETE x)
      FOREACH (x IN images | DETACH DELETE x)
      DETACH DELETE d
      RETURN 1 as ok
    `;
    const result = await this.runQuery(query, { documentId });
    return { deletedDocuments: 1, deletedChunks: null };
  }

  /**
   * 根据文件名删除文档及其相关数据（用于测试清理）
   */
  async deleteDocumentsByFilename(filename) {
    const query = `
      MATCH (d:Document {filename: $filename})
      OPTIONAL MATCH (d)-[:CONTAINS]->(c1:Chunk)
      OPTIONAL MATCH (c2:Chunk {document_id: d.id})
      OPTIONAL MATCH (d)-[:CONTAINS]->(img:Image)
      WITH d, collect(DISTINCT c1) + collect(DISTINCT c2) AS chunkNodes, collect(DISTINCT img) AS images
      UNWIND chunkNodes AS c
      FOREACH (x IN CASE WHEN c IS NULL THEN [] ELSE [c] END | DETACH DELETE x)
      FOREACH (x IN images | DETACH DELETE x)
      DETACH DELETE d
      RETURN count(*) as done
    `;
    const result = await this.runQuery(query, { filename });
    const done = result.records[0]?.get('done');
    const toNum = v => (v && typeof v.toNumber === 'function') ? v.toNumber() : Number(v || 0);
    return { deleted: toNum(done) };
  }

  /**
   * 根据哈希精确搜索图片（完全相同）
   * @param {string} hash - 图片哈希值
   * @returns {Array} 完全匹配的图片列表
   */
  async searchImagesByHash(hash) {
    const query = `
      MATCH (c:Chunk)
      WHERE c.phash = $hash
      RETURN c.id as id, c.phash as phash, c.title as title, 
             c.content as content, c.path as path, 
             c.metadata as metadata, c.timestamp as timestamp
      LIMIT 100
    `;
    const result = await this.runQuery(query, { hash });
    return result.records.map(r => ({
      id: r.get('id'),
      phash: r.get('phash'),
      title: r.get('title'),
      content: r.get('content'),
      path: r.get('path'),
      metadata: r.get('metadata'),
      timestamp: r.get('timestamp')
    }));
  }

  /**
   * 获取所有有哈希值的图片（用于统计和管理）
   * @param {Object} options - 查询选项
   * @returns {Array} 图片列表
   */
  async getAllImagesWithHash(options = {}) {
    const limit = options.limit || 1000;
    const query = `
      MATCH (c:Chunk)
      WHERE c.phash IS NOT NULL
      RETURN c.id as id, c.phash as phash, 
             c.title as title, c.path as path, 
             c.timestamp as timestamp
      ORDER BY c.timestamp DESC
      LIMIT $limit
    `;
    const result = await this.runQuery(query, { limit: neo4j.int(limit) });
    return result.records.map(r => ({
      id: r.get('id'),
      phash: r.get('phash'),
      title: r.get('title'),
      path: r.get('path'),
      timestamp: r.get('timestamp')
    }));
  }

  /**
   * 获取所有图片
   * @returns {Array} 图片列表
   */
  async getAllImages() {
    const query = `
      MATCH (c:Chunk)
      WHERE c.metadata.type = 'image' OR c.path =~ '.*\\.(jpg|jpeg|png|gif|webp|bmp)$'
      RETURN c.id as id, c.title as title, c.path as path, 
             c.phash as phash, c.timestamp as timestamp
      ORDER BY c.timestamp DESC
    `;
    const result = await this.runQuery(query);
    return result.records.map(r => ({
      id: r.get('id'),
      title: r.get('title'),
      path: r.get('path'),
      phash: r.get('phash'),
      timestamp: r.get('timestamp')
    }));
  }

  /**
   * 获取没有哈希值的图片
   * @returns {Array} 图片列表
   */
  async getImagesWithoutHash() {
    const query = `
      MATCH (c:Chunk)
      WHERE (c.metadata.type = 'image' OR c.path =~ '.*\\.(jpg|jpeg|png|gif|webp|bmp)$')
        AND c.phash IS NULL
      RETURN c.id as id, c.title as title, c.path as path, c.timestamp as timestamp
      ORDER BY c.timestamp DESC
    `;
    const result = await this.runQuery(query);
    return result.records.map(r => ({
      id: r.get('id'),
      title: r.get('title'),
      path: r.get('path'),
      timestamp: r.get('timestamp')
    }));
  }

  /**
   * 更新图片哈希值
   * @param {string} imageId - 图片ID
   * @param {Object} hashes - 哈希值对象 {phash, dhash, ahash, hash_algorithm}
   * @returns {Object} 更新结果
   */
  async updateImageHash(imageId, hashes) {
    const query = `
      MATCH (c:Chunk {id: $imageId})
      SET c.phash = $phash,
          c.dhash = $dhash,
          c.ahash = $ahash,
          c.hash_algorithm = $hash_algorithm,
          c.hash_updated_at = datetime()
      RETURN c
    `;
    const result = await this.runQuery(query, {
      imageId,
      phash: hashes.phash,
      dhash: hashes.dhash,
      ahash: hashes.ahash,
      hash_algorithm: hashes.hash_algorithm
    });
    return result.records.length > 0;
  }

  /**
   * 根据ID获取文本块
   * @param {string} chunkId - 文本块ID
   * @returns {Object} 文本块
   */
  async getChunkById(chunkId) {
    const query = `
      MATCH (c:Chunk {id: $chunkId})
      RETURN c
    `;
    const result = await this.runQuery(query, { chunkId });
    if (result.records.length === 0) {
      return null;
    }
    return result.records[0].get('c').properties;
  }

  /**
   * 获取数据库统计信息
   * @returns {Object} 统计信息
   */
  async getStats() {
    const queries = [
      'MATCH (d:Document) RETURN count(d) as documents',
      'MATCH (c:Chunk) RETURN count(c) as chunks',
      'MATCH (i:Image) RETURN count(i) as images',
      'MATCH (e:Entity) RETURN count(e) as entities',
      'MATCH ()-[r]->() RETURN count(r) as relationships'
    ];

    const stats = {};
    for (const query of queries) {
      try {
        const result = await this.runQuery(query);
        if (result.records.length > 0) {
          const key = result.records[0].keys[0];
          const val = result.records[0].get(key);
          stats[key] = (val && typeof val.toNumber === 'function') ? val.toNumber() : Number(val || 0);
        }
      } catch (error) {
        logger.warn(`统计查询失败: ${query}`, { error: error.message });
      }
    }

    return stats;
  }
}

// 创建单例实例
const neo4jStorage = new Neo4jStorage();

export default neo4jStorage;
