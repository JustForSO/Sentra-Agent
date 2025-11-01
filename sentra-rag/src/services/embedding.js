import { OpenAI } from 'openai';
import crypto from 'crypto';
import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import NodeCache from 'node-cache';

// 日志实例
const logger = createLogger('EmbeddingService');

/**
 * 向量嵌入服务
 * 负责文本和图片的向量化处理，支持 OpenAI API
 */
class EmbeddingService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseURL,
      timeout: config.openai.timeout,
      maxRetries: config.openai.maxRetries
    });
    
    this.embeddingCache = new Map();
    this.requestQueue = [];
    this.isProcessing = false;
  }

  /**
   * 获取文本嵌入向量
   * @param {string|Array} input - 单个文本或文本数组
   * @returns {Array} 嵌入向量或向量数组
   */
  async getTextEmbedding(input) {
    try {
      const isArray = Array.isArray(input);
      const texts = isArray ? input : [input];
      
      // 检查缓存
      const uncachedTexts = [];
      const cachedResults = new Map();
      
      for (const text of texts) {
        const cacheKey = this.getCacheKey(text);
        if (this.embeddingCache.has(cacheKey)) {
          cachedResults.set(text, this.embeddingCache.get(cacheKey));
        } else {
          uncachedTexts.push(text);
        }
      }

      logger.info(`文本嵌入请求: 总计 ${texts.length}, 缓存命中 ${cachedResults.size}, 需要处理 ${uncachedTexts.length}`);

      let newEmbeddings = [];
      if (uncachedTexts.length > 0) {
        // 批量处理未缓存的文本
        newEmbeddings = await this.batchTextEmbedding(uncachedTexts);
        
        // 缓存新结果
        uncachedTexts.forEach((text, index) => {
          const cacheKey = this.getCacheKey(text);
          this.embeddingCache.set(cacheKey, newEmbeddings[index]);
          cachedResults.set(text, newEmbeddings[index]);
        });
      }

      // 按原始顺序返回结果
      const results = texts.map(text => cachedResults.get(text));
      return isArray ? results : results[0];

    } catch (error) {
      logger.error('获取文本嵌入向量失败', { error: error.message });
      throw new Error(`文本嵌入处理失败: ${error.message}`);
    }
  }

  /**
   * 批量处理文本嵌入
   * @param {Array} texts - 文本数组
   * @returns {Array} 嵌入向量数组
   */
  async batchTextEmbedding(texts) {
    const embeddings = [];
    const batchSize = config.processing.embeddingBatchSize;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      logger.debug(`处理嵌入批次: ${i + 1}-${Math.min(i + batchSize, texts.length)}/${texts.length}`);

      try {
        const response = await this.openai.embeddings.create({
          model: config.openai.embeddingModel,
          input: batch,
          encoding_format: "float"
        });

        const batchEmbeddings = response.data.map(item => item.embedding);
        embeddings.push(...batchEmbeddings);

        // 记录 token 使用情况
        if (response.usage) {
          logger.info(`批次嵌入完成`, { 
            tokens: response.usage.total_tokens,
            texts: batch.length 
          });
        }

        // 避免请求过于频繁
        if (i + batchSize < texts.length) {
          await this.delay(100);
        }

      } catch (error) {
        logger.error(`批次嵌入失败 (${i + 1}-${i + batchSize})`, { error: error.message });
        throw error;
      }
    }

    return embeddings;
  }

  /**
   * 获取图片嵌入向量
   * @param {string} imagePath - 图片路径
   * @param {string} description - 图片描述文本
   * @returns {Array} 嵌入向量
   */
  async getImageEmbedding(imagePath, description = '') {
    try {
      // 对于图片，我们使用描述文本来生成嵌入
      // 如果没有描述，可以使用图片分析API获取描述
      let embeddingText = description;
      
      if (!embeddingText) {
        embeddingText = await this.analyzeImage(imagePath);
      }

      const embedding = await this.getTextEmbedding(embeddingText);
      logger.info('图片嵌入向量生成成功', { imagePath, descriptionLength: embeddingText.length });
      
      return embedding;

    } catch (error) {
      logger.error('获取图片嵌入向量失败', { imagePath, error: error.message });
      throw new Error(`图片嵌入处理失败: ${error.message}`);
    }
  }

  /**
   * 使用视觉模型分析图片内容
   * @param {string} imagePath - 图片路径
   * @returns {string} 图片描述
   */
  async analyzeImage(imagePath) {
    try {
      // 读取图片文件并转换为 base64
      const fs = await import('fs');
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = this.getMimeType(imagePath);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini', // 使用支持视觉的模型
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '请详细描述这张图片的内容，包括主要对象、颜色、场景、文字等信息。用中文回答。'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 500
      });

      const description = response.choices[0]?.message?.content || '图片内容分析失败';
      logger.info('图片内容分析完成', { imagePath, descriptionLength: description.length });
      
      return description;

    } catch (error) {
      logger.error('图片内容分析失败', { imagePath, error: error.message });
      return `图片文件: ${imagePath.split('/').pop()}`;
    }
  }

  /**
   * 计算向量相似度 (余弦相似度)
   * @param {Array} vecA - 向量A
   * @param {Array} vecB - 向量B
   * @returns {number} 相似度分数 (0-1)
   */
  calculateSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
      throw new Error('向量维度不匹配');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * 生成缓存键
   * @param {string} text - 文本内容
   * @returns {string} 缓存键
   */
  getCacheKey(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  /**
   * 获取文件 MIME 类型
   * @param {string} filePath - 文件路径
   * @returns {string} MIME 类型
   */
  getMimeType(filePath) {
    const ext = filePath.toLowerCase().split('.').pop();
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp'
    };
    return mimeTypes[ext] || 'image/jpeg';
  }

  /**
   * 延迟函数
   * @param {number} ms - 延迟毫秒数
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清除嵌入缓存
   */
  clearCache() {
    this.embeddingCache.clear();
    logger.info('嵌入向量缓存已清除');
  }

  /**
   * 获取缓存统计信息
   * @returns {Object} 缓存统计
   */
  getCacheStats() {
    return {
      size: this.embeddingCache.size,
      memoryUsage: process.memoryUsage().heapUsed
    };
  }
}

// 创建单例实例
const embeddingService = new EmbeddingService();

export default embeddingService;
