/**
 * Sentra RAG SDK
 * 提供所有核心功能的直接函数调用接口
 * 无需启动 HTTP 服务器，可直接在 Node.js 脚本中使用
 */

import neo4jStorage from '../database/neo4j.js';
import messageStorage from '../database/messageNeo4j.js';
import ragService from '../services/ragService.js';
import imageProcessor from '../services/imageProcessor.js';
import imageHashService from '../services/imageHashService.js';
import imageSearchService from '../services/imageSearchService.js';
import embeddingService from '../services/embedding.js';
import emotionService from '../services/emotionService.js';
import { createLogger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('SentraRAG-SDK');

/**
 * Sentra RAG SDK 主类
 */
class SentraRAG {
  constructor() {
    this.initialized = false;
  }

  /**
   * 按情绪/情感过滤检索
   * @param {Object} filters - { labels?: string|string[], match?: 'any'|'all', primaryLabel?, minPrimaryScore?, sentimentLabel?, minSentimentScore?, vad?: {...}, stress?: {...} }
   * @param {Object} options - { limit?, orderBy?, order? }
   * @returns {Promise<Array>} 结果列表（Chunk）
   */
  async searchByEmotion(filters = {}, options = {}) {
    this._ensureInitialized();
    try {
      const results = await neo4jStorage.searchChunksByEmotion(filters, options);
      return results;
    } catch (error) {
      logger.error('情绪检索失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 初始化 SDK（必须首先调用）
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      logger.info('SDK 已初始化');
      return;
    }

    try {
      logger.info('正在初始化 Sentra RAG SDK...');
      
      // 初始化 RAG 服务（内部会初始化数据库连接）
      await ragService.initialize();
      // 初始化消息数据库（OpenAI 风格消息）
      await messageStorage.initialize();
      
      this.initialized = true;
      logger.info('✅ Sentra RAG SDK 初始化成功');
    } catch (error) {
      logger.error('SDK 初始化失败', { error: error.message });
      throw new Error(`SDK 初始化失败: ${error.message}`);
    }
  }

  /**
   * 关闭 SDK（释放资源）
   * @returns {Promise<void>}
   */
  async close() {
    if (!this.initialized) {
      return;
    }

    try {
      // 通过 RAG 服务关闭，包含缓存清理
      await ragService.close();
      await messageStorage.close();
      this.initialized = false;
      logger.info('✅ Sentra RAG SDK 已关闭');
    } catch (error) {
      logger.error('SDK 关闭失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 确保已初始化
   * @private
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('SDK 未初始化，请先调用 initialize()');
    }
  }

  // ==================== 文档处理 ====================

  /**
   * 处理文本文档
   * @param {string} content - 文档内容
   * @param {Object} metadata - 元数据（可选）
   * @returns {Promise<Object>} 处理结果
   */
  async processDocument(content, metadata = {}) {
    this._ensureInitialized();
    
    try {
      logger.info('开始处理文档', { contentLength: content.length });
      
      const documentId = metadata.documentId || `doc_${uuidv4()}`;
      
      // 使用 RAG 服务处理文档
      const result = await ragService.processDocument(content, {
        documentId,
        title: metadata.title || '未命名文档',
        source: metadata.source || 'sdk',
        ...metadata
      });
      
      logger.info('文档处理完成', {
        documentId,
        chunks: result.chunks?.length || 0
      });
      
      return result;
    } catch (error) {
      logger.error('文档处理失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 处理文档文件
   * @param {string} filePath - 文件路径
   * @param {Object} metadata - 元数据（可选）
   * @returns {Promise<Object>} 处理结果
   */
  async processDocumentFile(filePath, metadata = {}) {
    this._ensureInitialized();
    
    try {
      // 读取文件内容
      const content = await fs.readFile(filePath, 'utf-8');
      const filename = path.basename(filePath);
      
      return await this.processDocument(content, {
        ...metadata,
        filename,
        source: filePath
      });
    } catch (error) {
      logger.error('文档文件处理失败', { error: error.message });
      throw error;
    }
  }

  // ==================== 图片处理 ====================

  /**
   * 智能处理图片（AI 分析 + 哈希计算）
   * @param {string} imagePath - 图片路径
   * @param {Object} options - 处理选项
   * @returns {Promise<Object>} 处理结果
   */
  async processImage(imagePath, options = {}) {
    this._ensureInitialized();
    
    try {
      logger.info('开始处理图片', { path: imagePath });
      
      const result = await imageProcessor.processImage(imagePath, {
        enableHash: true,      // 启用哈希计算
        enableOCR: true,       // 启用 OCR
        generateThumbnail: false,
        ...options
      });
      
      logger.info('图片处理完成', {
        id: result.id,
        title: result.title,
        hasHash: !!result.phash
      });
      
      return result;
    } catch (error) {
      logger.error('图片处理失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 存储图片到数据库
   * @param {Object} imageData - 图片处理结果
   * @param {string} documentId - 关联的文档 ID
   * @returns {Promise<Object>} 存储结果
   */
  async storeImage(imageData, documentId) {
    this._ensureInitialized();
    
    try {
      // 构建完整内容
      const fullContent = [
        `标题: ${imageData.title}`,
        `详细描述: ${imageData.description}`,
        imageData.summary ? `摘要: ${imageData.summary}` : '',
        imageData.keywords?.length ? `关键词: ${imageData.keywords.join(', ')}` : '',
        imageData.entities?.length ? `实体: ${imageData.entities.join(', ')}` : '',
        imageData.extractedText ? `图片文字: ${imageData.extractedText}` : ''
      ].filter(Boolean).join('\n');

      // 情绪分析（基于完整内容）
      const emo = await emotionService.analyzeText(fullContent);

      const chunkData = {
        id: imageData.id,
        document_id: documentId,
        content: fullContent,
        contextualized: fullContent,
        title: imageData.title,
        summary: imageData.summary || imageData.description?.substring(0, 100),
        keywords: imageData.keywords || [],
        entities: imageData.entities || [],
        embedding: imageData.embedding,
        // 图片哈希
        phash: imageData.phash,
        dhash: imageData.dhash,
        ahash: imageData.ahash,
        hash_algorithm: imageData.hash_algorithm,
        path: imageData.path,
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
        // 时间戳
        timestamp: imageData.timestamp,
        local_time: imageData.local_time,
        created_at: imageData.created_at,
        // 元数据
        metadata: imageData.metadata
      };

      await neo4jStorage.saveChunk(chunkData);
      
      logger.info('图片存储成功', { imageId: imageData.id });
      
      return { success: true, imageId: imageData.id };
    } catch (error) {
      logger.error('图片存储失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 处理并存储图片（一步完成）
   * @param {string} imagePath - 图片路径
   * @param {string} documentId - 文档 ID（可选）
   * @param {Object} options - 处理选项
   * @returns {Promise<Object>} 完整结果
   */
  async processAndStoreImage(imagePath, documentId = null, options = {}) {
    this._ensureInitialized();
    
    try {
      // 处理图片
      const imageData = await this.processImage(imagePath, options);
      
      // 存储到数据库
      const docId = documentId || `doc_${uuidv4()}`;
      await this.storeImage(imageData, docId);
      
      return {
        success: true,
        imageData,
        documentId: docId
      };
    } catch (error) {
      logger.error('处理并存储图片失败', { error: error.message });
      throw error;
    }
  }

  // ==================== 以图搜图 ====================

  /**
   * 以图搜图（通过图片路径）
   * @param {string} imagePath - 图片路径
   * @param {Object} options - 搜索选项
   * @returns {Promise<Object>} 搜索结果
   */
  async searchByImagePath(imagePath, options = {}) {
    this._ensureInitialized();
    
    try {
      logger.info('开始以图搜图', { path: imagePath });
      
      const result = await imageSearchService.searchByImage(imagePath, {
        limit: 20,
        ...options
      });
      
      logger.info('以图搜图完成', {
        resultCount: result.results.length,
        time: result.stats.totalTime
      });
      
      return result;
    } catch (error) {
      logger.error('以图搜图失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 以图搜图（通过 图片相似度）
   * @param {Object} options - 搜索选项
   * @returns {Promise<Object>} 搜索结果
   */
  async searchByImageBuffer(imageBuffer, options = {}) {
    this._ensureInitialized();
    
    try {
      logger.info('开始以图搜图');
      
      const result = await imageSearchService.searchByImage(imageBuffer, {
        limit: 20,
        ...options
      });
      
      logger.info('以图搜图完成', {
        resultCount: result.results.length
      });
      
      return result;
    } catch (error) {
      logger.error('以图搜图失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 查找重复图片
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 重复图片组
   */
  async findDuplicateImages(options = {}) {
    this._ensureInitialized();
    
    try {
      logger.info('开始查找重复图片');
      
      const duplicates = await imageSearchService.findDuplicateImages({
        limit: 1000,
        ...options
      });
      
      logger.info('重复图片查找完成', {
        groupCount: duplicates.length
      });
      
      return duplicates;
    } catch (error) {
      logger.error('查找重复图片失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 批量计算图片哈希
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 计算结果
   */
  async rebuildImageHash(options = {}) {
    this._ensureInitialized();
    
    try {
      logger.info('开始批量计算哈希');
      
      const result = await imageSearchService.rebuildHashIndex({
        forceRebuild: false,
        ...options
      });
      
      logger.info('批量哈希计算完成', result);
      
      return result;
    } catch (error) {
      logger.error('批量哈希计算失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 计算单张图片的哈希
   * @param {string} imagePath - 图片路径
   * @returns {Promise<Object>} 哈希值
   */
  async calculateImageHash(imagePath) {
    this._ensureInitialized();
    
    try {
      const hashes = await imageHashService.calculateAllHashes(imagePath);
      return hashes;
    } catch (error) {
      logger.error('哈希计算失败', { error: error.message });
      throw error;
    }
  }

  // ==================== 查询检索 ====================

  /**
   * 智能问答
   * @param {string} query - 问题
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>} 回答结果
   */
  async query(query, options = {}) {
    this._ensureInitialized();
    
    try {
      logger.info('开始智能问答', { query });
      
      const result = await ragService.query(query, {
        mode: 'hybrid',
        topK: 5,
        includeSource: true,
        ...options
      });
      
      logger.info('智能问答完成');
      
      return result;
    } catch (error) {
      logger.error('智能问答失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 文本搜索
   * @param {string} query - 搜索词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 搜索结果
   */
  async search(query, options = {}) {
    this._ensureInitialized();
    
    try {
      logger.info('开始搜索', { query });
      
      const results = await neo4jStorage.searchChunks(query, {
        limit: 20,
        mode: 'hybrid',
        ...options
      });
      
      logger.info('搜索完成', { resultCount: results.length });
      
      return results;
    } catch (error) {
      logger.error('搜索失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 向量相似性搜索
   * @param {Array<number>} embedding - 向量
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 搜索结果
   */
  async vectorSearch(embedding, options = {}) {
    this._ensureInitialized();
    
    try {
      const results = await neo4jStorage.vectorSimilaritySearch(embedding, {
        topK: 10,
        ...options
      });
      
      return results;
    } catch (error) {
      logger.error('向量搜索失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 时间段搜索
   * @param {Object} timeRange - 时间范围 {startTime, endTime}
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 搜索结果
   */
  async searchByTime(timeRange, options = {}) {
    this._ensureInitialized();
    
    try {
      const results = await neo4jStorage.searchChunksByTimestamp(timeRange, {
        limit: 100,
        ...options
      });
      
      return results;
    } catch (error) {
      logger.error('时间搜索失败', { error: error.message });
      throw error;
    }
  }

  // ==================== 向量服务 ====================

  /**
   * 生成文本向量
   * @param {string} text - 文本内容
   * @returns {Promise<Array<number>>} 向量
   */
  async getTextEmbedding(text) {
    this._ensureInitialized();
    
    try {
      const embedding = await embeddingService.getTextEmbedding(text);
      return embedding;
    } catch (error) {
      logger.error('向量生成失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 批量生成文本向量
   * @param {Array<string>} texts - 文本数组
   * @returns {Promise<Array<Array<number>>>} 向量数组
   */
  async getBatchEmbeddings(texts) {
    this._ensureInitialized();
    
    try {
      // embeddingService.getTextEmbedding 支持数组输入
      const embeddings = await embeddingService.getTextEmbedding(texts);
      return embeddings;
    } catch (error) {
      logger.error('批量向量生成失败', { error: error.message });
      throw error;
    }
  }

  // ==================== 数据库操作 ====================

  /**
   * 获取文档列表
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 文档列表
   */
  async getDocuments(options = {}) {
    this._ensureInitialized();
    
    try {
      const documents = await neo4jStorage.getDocuments({
        limit: 100,
        ...options
      });
      
      return documents;
    } catch (error) {
      logger.error('获取文档列表失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取文档详情
   * @param {string} documentId - 文档 ID
   * @returns {Promise<Object>} 文档详情
   */
  async getDocument(documentId) {
    this._ensureInitialized();
    
    try {
      const document = await neo4jStorage.getDocumentById(documentId);
      return document;
    } catch (error) {
      logger.error('获取文档详情失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 删除文档
   * @param {string} documentId - 文档 ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteDocument(documentId) {
    this._ensureInitialized();
    
    try {
      await neo4jStorage.deleteDocument(documentId);
      logger.info('文档删除成功', { documentId });
      return true;
    } catch (error) {
      logger.error('文档删除失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取系统统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
    this._ensureInitialized();
    
    try {
      // 使用 RAG 服务统计，包含缓存信息
      const stats = await ragService.getStats();
      // 附加消息库统计
      const msgStats = await messageStorage.getStats().catch(() => ({}));
      return { ...stats, messages: msgStats };
    } catch (error) {
      logger.error('获取统计信息失败', { error: error.message });
      throw error;
    }
  }

  // ==================== 消息数据库（OpenAI 风格） ====================

  /**
   * 保存一组 OpenAI 风格消息（会按 user→assistant 成对保存）
   * @param {Array<{role:string, content:any}>} messages
   * @param {Object} options { conversationId?, userId?, metadata? }
   * @returns {Promise<Array<{turn, user, assistant}>>}
   */
  async saveOpenAIMessages(messages = [], options = {}) {
    this._ensureInitialized();
    try {
      return await messageStorage.saveOpenAIMessages(messages, options);
    } catch (error) {
      logger.error('保存消息失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 按文本检索 assistant 消息（返回绑定的 user+assistant 成对）
   * @param {string} text
   * @param {Object} options { limit?, threshold? }
   */
  async searchAssistantMessages(text, options = {}) {
    this._ensureInitialized();
    try {
      return await messageStorage.searchAssistantByText(text, options);
    } catch (error) {
      logger.error('检索消息失败', { error: error.message });
      throw error;
    }
  }

  /** 获取会话内的 Turn 列表（倒序） */
  async getConversationTurns(conversationId, options = {}) {
    this._ensureInitialized();
    try {
      return await messageStorage.getConversationTurns(conversationId, options);
    } catch (error) {
      logger.error('获取会话消息失败', { error: error.message });
      throw error;
    }
  }

  /** 获取最近 Turn 列表 */
  async listRecentTurns(options = {}) {
    this._ensureInitialized();
    try {
      return await messageStorage.listRecentTurns(options);
    } catch (error) {
      logger.error('获取最近消息失败', { error: error.message });
      throw error;
    }
  }

  /** 按 userId 获取 Turn（可选限定 conversationId），倒序 */
  async getUserTurns(userId, options = {}) {
    this._ensureInitialized();
    try {
      return await messageStorage.getUserTurns(userId, options);
    } catch (error) {
      logger.error('获取用户会话失败', { error: error.message });
      throw error;
    }
  }

  /** 文本检索消息（默认 role='assistant'，可选 'user'|'assistant'|'both'） */
  async searchMessagesByText(keyword, options = {}) {
    this._ensureInitialized();
    try {
      return await messageStorage.searchMessagesByText(keyword, options);
    } catch (error) {
      logger.error('文本检索消息失败', { error: error.message });
      throw error;
    }
  }
}

// 导出单例
const sentraRAG = new SentraRAG();

export default sentraRAG;
export { SentraRAG };
