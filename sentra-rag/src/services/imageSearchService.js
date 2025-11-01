import imageHashService from './imageHashService.js';
import imageProcessor from './imageProcessor.js';
import embeddingService from './embedding.js';
import neo4jStorage from '../database/neo4j.js';
import { createLogger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';

const logger = createLogger('ImageSearchService');

/**
 * 图片搜索服务
 * 实现以图搜图功能，支持多层级搜索策略
 */
class ImageSearchService {
  constructor() {
    // 默认配置
    this.defaultOptions = {
      limit: 20,              // 最终返回结果数量
      includeMetadata: true   // 是否包含详细元数据
    };
  }

  /**
   * 以图搜图主入口
   * @param {string|Buffer} input - 图片路径或 Buffer
   * @param {Object} options - 搜索选项
   * @returns {Promise<Object>} 搜索结果
   */
  async searchByImage(input, options = {}) {
    const startTime = Date.now();
    const opts = { ...this.defaultOptions, ...options };
    
    try {
      logger.info('开始以图搜图（哈希精确匹配）');
      
      // 仅使用哈希精确匹配
      const results = await this.searchByHashExact(input);
      const totalTime = Date.now() - startTime;
      
      logger.info('以图搜图完成', {
        resultCount: results.length,
        totalTime: `${totalTime}ms`
      });
      
      return {
        success: true,
        method: 'hash_exact',
        results: results.slice(0, opts.limit),
        stats: {
          hashSearchTime: totalTime,
          totalTime,
          resultCount: results.length
        }
      };
      
    } catch (error) {
      logger.error('以图搜图失败', { error: error.message });
      throw new Error(`以图搜图失败: ${error.message}`);
    }
  }


  /**
   * 精确哈希匹配（完全相同的图片）
   * @param {string|Buffer} input - 图片
   * @returns {Promise<Array>} 完全相同的图片
   */
  async searchByHashExact(input) {
    try {
      // 计算目标图片的哈希
      const phash = await imageHashService.calculatePHash(input);
      
      // 在数据库中查找完全相同的哈希
      const results = await neo4jStorage.searchImagesByHash(phash);
      
      return results.map(r => ({
        ...r,
        similarity: 1.0,
        matchType: 'identical'
      }));
      
    } catch (error) {
      logger.error('精确哈希匹配失败', { error: error.message });
      return [];
    }
  }


  /**
   * 查找图片的相似图片（基于已存储图片的 ID）
   * @param {string} imageId - 图片 ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 相似图片列表
   */
  async findSimilarImages(imageId, options = {}) {
    try {
      const opts = { ...this.defaultOptions, ...options };
      
      // 1. 获取源图片信息
      const sourceImage = await neo4jStorage.getChunkById(imageId);
      if (!sourceImage) {
        throw new Error(`图片不存在: ${imageId}`);
      }
      
      // 2. 使用向量搜索查找语义相似的图片
      let results = [];
      
      if (sourceImage.embedding) {
        const topK = Math.max(1, Math.trunc(opts.vectorTopK || 20));
        const vectorResults = await neo4jStorage.vectorSimilaritySearch(
          sourceImage.embedding,
          { topK }
        );

        results = vectorResults
          .filter(r => r.id !== imageId)
          .map(r => ({
            ...r,
            matchType: 'vector_semantic',
            similarity: typeof r.score === 'number' ? r.score : parseFloat(r.score) || 0
          }));
      }
      
      return {
        success: true,
        sourceImage: {
          id: sourceImage.id,
          title: sourceImage.title,
          path: sourceImage.path,
          phash: sourceImage.phash
        },
        similarImages: results.slice(0, opts.limit)
      };
      
    } catch (error) {
      logger.error('查找相似图片失败', { imageId, error: error.message });
      throw error;
    }
  }

  /**
   * 批量查找完全相同的图片（基于哈希精确匹配）
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 重复图片组列表
   */
  async findDuplicateImages(options = {}) {
    try {
      logger.info('开始查找完全相同的图片');
      
      // 获取所有有哈希的图片
      const allImages = await neo4jStorage.getAllImagesWithHash(options);
      
      if (allImages.length === 0) {
        return [];
      }
      
      // 按哈希分组
      const hashGroups = new Map();
      
      for (const image of allImages) {
        if (!image.phash) continue;
        
        if (!hashGroups.has(image.phash)) {
          hashGroups.set(image.phash, []);
        }
        hashGroups.get(image.phash).push(image);
      }
      
      // 过滤出重复的组（哈希相同的图片 >= 2）
      const duplicateGroups = Array.from(hashGroups.values())
        .filter(group => group.length > 1);
      
      logger.info('完全相同图片查找完成', { 
        totalImages: allImages.length,
        uniqueHashes: hashGroups.size,
        duplicateGroups: duplicateGroups.length,
        duplicateImages: duplicateGroups.reduce((sum, g) => sum + g.length, 0)
      });
      
      return duplicateGroups;
      
    } catch (error) {
      logger.error('查找重复图片失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 为现有图片批量计算哈希
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 更新统计
   */
  async rebuildHashIndex(options = {}) {
    try {
      logger.info('开始批量计算图片哈希');
      
      // 获取所有没有哈希的图片
      const images = options.forceRebuild 
        ? await neo4jStorage.getAllImages()
        : await neo4jStorage.getImagesWithoutHash();
      
      if (images.length === 0) {
        logger.info('没有需要计算哈希的图片');
        return { updated: 0, failed: 0, total: 0 };
      }
      
      let updated = 0;
      let failed = 0;
      
      for (const image of images) {
        try {
          // 检查图片文件是否存在
          if (!await fs.pathExists(image.path)) {
            logger.warn('图片文件不存在，跳过', { path: image.path });
            failed++;
            continue;
          }
          
          // 计算哈希
          const hashes = await imageHashService.calculateAllHashes(image.path);
          
          // 更新数据库
          await neo4jStorage.updateImageHash(image.id, {
            phash: hashes.phash,
            dhash: hashes.dhash,
            ahash: hashes.ahash,
            hash_algorithm: hashes.algorithm
          });
          
          updated++;
          
          if (updated % 10 === 0) {
            logger.info(`批量哈希计算进度: ${updated}/${images.length}`);
          }
          
        } catch (error) {
          logger.error('计算图片哈希失败', { 
            imageId: image.id, 
            path: image.path,
            error: error.message 
          });
          failed++;
        }
      }
      
      logger.info('批量哈希计算完成', { 
        total: images.length,
        updated,
        failed
      });
      
      return { updated, failed, total: images.length };
      
    } catch (error) {
      logger.error('批量哈希计算失败', { error: error.message });
      throw error;
    }
  }
}

// 创建单例
const imageSearchService = new ImageSearchService();

export default imageSearchService;
