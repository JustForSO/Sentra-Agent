import express from 'express';
import multer from 'multer';
import imageSearchService from '../services/imageSearchService.js';
import { createLogger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';

const router = express.Router();
const logger = createLogger('ImageSearchAPI');

// 配置 multer 用于文件上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的图片格式'));
    }
  }
});

/**
 * POST /api/search/image
 * 上传图片进行以图搜图（哈希精确匹配）
 * 
 * Body参数：
 * - image: File (必需) - 图片文件
 * - limit: Number (可选) - 返回结果数量，默认 20
 */
router.post('/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '请上传图片文件'
      });
    }

    const options = {
      limit: parseInt(req.body.limit) || 20
    };

    logger.info('收到以图搜图请求', {
      filename: req.file.originalname,
      size: req.file.size
    });

    // 使用 Buffer 进行搜索（哈希精确匹配）
    const result = await imageSearchService.searchByImage(req.file.buffer, options);

    res.json(result);

  } catch (error) {
    logger.error('以图搜图失败', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/search/duplicates
 * 查找所有完全相同的图片（基于哈希）
 * 
 * Query参数：
 * - limit: Number (可选) - 查询的图片总数限制，默认 1000
 */
router.get('/duplicates', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000;

    logger.info('查找完全相同的图片', { limit });

    const duplicateGroups = await imageSearchService.findDuplicateImages({ limit });

    res.json({
      success: true,
      duplicateGroups,
      stats: {
        totalGroups: duplicateGroups.length,
        totalDuplicates: duplicateGroups.reduce((sum, g) => sum + g.length, 0)
      }
    });

  } catch (error) {
    logger.error('查找重复图片失败', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/search/rebuild-hash
 * 为现有图片批量计算哈希
 */
router.post('/rebuild-hash', async (req, res) => {
  try {
    const forceRebuild = req.body.force === true;

    logger.info('开始批量哈希重建', { forceRebuild });

    const result = await imageSearchService.rebuildHashIndex({ forceRebuild });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('批量哈希重建失败', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
