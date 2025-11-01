import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import ragService from '../services/ragService.js';
import imageProcessor from '../services/imageProcessor.js';
import neo4jStorage from '../database/neo4j.js';

const logger = createLogger('DocumentsAPI');
const router = express.Router();

// 配置文件上传
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(config.storage.uploadDir, new Date().toISOString().split('T')[0]);
    await fs.ensureDir(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.storage.maxFileSize
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      ...config.storage.allowedTypes.text,
      ...config.storage.allowedTypes.image
    ];
    
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${ext}`), false);
    }
  }
});

// 文档上传验证模式
const uploadSchema = Joi.object({
  description: Joi.string().max(1000).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  category: Joi.string().max(50).optional()
});

/**
 * 上传文档
 * POST /api/documents/upload
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请选择要上传的文件'
      });
    }

    // 验证请求参数
    const { error, value } = uploadSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: `参数错误: ${error.details[0].message}`
      });
    }

    const { description = '', tags = [], category = 'general' } = value;

    logger.info(`收到文件上传请求: ${req.file.originalname}`);

    // 确定文件类型
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isImage = config.storage.allowedTypes.image.includes(ext);
    const isText = config.storage.allowedTypes.text.includes(ext);

    // 读取文件内容
    let content = '';
    if (isText) {
      content = await fs.readFile(req.file.path, 'utf-8');
    }

    // 构建文档对象
    const document = {
      id: uuidv4(),
      filename: req.file.originalname,
      type: isImage ? 'image' : 'text',
      size: req.file.size,
      path: req.file.path,
      mimeType: req.file.mimetype,
      content: content,
      description: description,
      metadata: {
        uploadedAt: new Date().toISOString(),
        tags: tags,
        category: category,
        uploader: req.ip
      }
    };

    // 插入到知识库
    const result = await ragService.insertDocument(document);

    logger.info(`文档上传成功: ${req.file.originalname}`, {
      id: document.id,
      type: document.type,
      size: document.size
    });

    res.status(201).json({
      success: true,
      message: '文档上传并处理成功',
      data: {
        id: document.id,
        filename: document.filename,
        type: document.type,
        size: document.size,
        processedAt: new Date().toISOString(),
        summary: result.summary || {}
      }
    });

  } catch (error) {
    logger.error('文档上传失败', { 
      error: error.message,
      filename: req.file?.originalname 
    });

    // 清理上传的文件
    if (req.file?.path) {
      await fs.remove(req.file.path).catch(() => {});
    }

    res.status(500).json({
      success: false,
      message: '文档上传处理失败',
      error: error.message
    });
  }
});

/**
 * 批量上传文档
 * POST /api/documents/upload/batch
 */
router.post('/upload/batch', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请选择要上传的文件'
      });
    }

    logger.info(`收到批量文件上传请求: ${req.files.length} 个文件`);

    const results = [];
    const errors = [];

    // 处理每个文件
    for (const file of req.files) {
      try {
        const ext = path.extname(file.originalname).toLowerCase();
        const isImage = config.storage.allowedTypes.image.includes(ext);
        const isText = config.storage.allowedTypes.text.includes(ext);

        let content = '';
        if (isText) {
          content = await fs.readFile(file.path, 'utf-8');
        }

        const document = {
          id: uuidv4(),
          filename: file.originalname,
          type: isImage ? 'image' : 'text',
          size: file.size,
          path: file.path,
          mimeType: file.mimetype,
          content: content,
          metadata: {
            uploadedAt: new Date().toISOString(),
            batch: true,
            uploader: req.ip
          }
        };

        const result = await ragService.insertDocument(document);
        results.push({
          id: document.id,
          filename: document.filename,
          type: document.type,
          success: true,
          summary: result.summary || {}
        });

      } catch (error) {
        errors.push({
          filename: file.originalname,
          error: error.message
        });

        // 清理失败的文件
        await fs.remove(file.path).catch(() => {});
      }
    }

    logger.info(`批量上传处理完成`, { 
      success: results.length,
      errors: errors.length
    });

    res.status(201).json({
      success: true,
      message: `批量上传完成: 成功 ${results.length}, 失败 ${errors.length}`,
      data: {
        successes: results,
        errors: errors,
        processedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('批量文档上传失败', { error: error.message });

    // 清理所有上传的文件
    if (req.files) {
      for (const file of req.files) {
        await fs.remove(file.path).catch(() => {});
      }
    }

    res.status(500).json({
      success: false,
      message: '批量文档上传处理失败',
      error: error.message
    });
  }
});

/**
 * 通过文本直接添加文档
 * POST /api/documents/text
 */
router.post('/text', async (req, res) => {
  try {
    const textSchema = Joi.object({
      title: Joi.string().required().max(200),
      content: Joi.string().required().min(10),
      description: Joi.string().max(1000).optional(),
      tags: Joi.array().items(Joi.string()).optional(),
      category: Joi.string().max(50).optional()
    });

    const { error, value } = textSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: `参数错误: ${error.details[0].message}`
      });
    }

    const { title, content, description = '', tags = [], category = 'general' } = value;

    logger.info(`收到文本文档添加请求: ${title}`);

    // 创建临时文件
    const tempDir = path.join(config.storage.uploadDir, 'text');
    await fs.ensureDir(tempDir);
    const filename = `${title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_')}.txt`;
    const filePath = path.join(tempDir, `${uuidv4()}_${filename}`);
    
    await fs.writeFile(filePath, content, 'utf-8');

    // 构建文档对象
    const document = {
      id: uuidv4(),
      filename: filename,
      type: 'text',
      size: Buffer.byteLength(content, 'utf-8'),
      path: filePath,
      mimeType: 'text/plain',
      content: content,
      description: description,
      metadata: {
        createdAt: new Date().toISOString(),
        title: title,
        tags: tags,
        category: category,
        source: 'direct_input'
      }
    };

    // 插入到知识库
    const result = await ragService.insertDocument(document);

    logger.info(`文本文档添加成功: ${title}`, {
      id: document.id,
      contentLength: content.length
    });

    res.status(201).json({
      success: true,
      message: '文本文档添加成功',
      data: {
        id: document.id,
        title: title,
        filename: filename,
        size: document.size,
        processedAt: new Date().toISOString(),
        summary: result.summary || {}
      }
    });

  } catch (error) {
    logger.error('文本文档添加失败', { error: error.message });

    res.status(500).json({
      success: false,
      message: '文本文档添加失败',
      error: error.message
    });
  }
});

/**
 * 获取文档列表
 * GET /api/documents
 */
router.get('/', async (req, res) => {
  try {
    const querySchema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      type: Joi.string().valid('text', 'image').optional(),
      category: Joi.string().optional(),
      search: Joi.string().optional()
    });

    const { error, value } = querySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: `参数错误: ${error.details[0].message}`
      });
    }

    const { page, limit, type, category, search } = value;
    const skip = (page - 1) * limit;

    // 构建查询
    let query = 'MATCH (d:Document) ';
    const params = { limit, skip };

    const conditions = [];
    if (type) {
      conditions.push('d.type = $type');
      params.type = type;
    }
    if (category) {
      conditions.push('d.metadata CONTAINS $category');
      params.category = category;
    }
    if (search) {
      conditions.push('(d.filename CONTAINS $search OR d.metadata CONTAINS $search)');
      params.search = search;
    }

    if (conditions.length > 0) {
      query += 'WHERE ' + conditions.join(' AND ') + ' ';
    }

    query += 'RETURN d ORDER BY d.created_at DESC SKIP $skip LIMIT $limit';

    const result = await neo4jStorage.runQuery(query, params);
    const documents = result.records.map(record => record.get('d').properties);

    // 获取总数
    let countQuery = 'MATCH (d:Document) ';
    if (conditions.length > 0) {
      countQuery += 'WHERE ' + conditions.join(' AND ') + ' ';
    }
    countQuery += 'RETURN count(d) as total';

    const countResult = await neo4jStorage.runQuery(countQuery, params);
    const total = countResult.records[0].get('total');

    res.json({
      success: true,
      data: {
        documents: documents,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    logger.error('获取文档列表失败', { error: error.message });

    res.status(500).json({
      success: false,
      message: '获取文档列表失败',
      error: error.message
    });
  }
});

/**
 * 获取文档详情
 * GET /api/documents/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await neo4jStorage.runQuery(
      'MATCH (d:Document {id: $id}) RETURN d',
      { id }
    );

    if (result.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    const document = result.records[0].get('d').properties;

    // 获取相关的块和实体
    const chunksResult = await neo4jStorage.runQuery(
      'MATCH (d:Document {id: $id})-[:CONTAINS]->(c:Chunk) RETURN c ORDER BY c.index',
      { id }
    );

    const entitiesResult = await neo4jStorage.runQuery(
      'MATCH (d:Document {id: $id})-[:MENTIONS]->(e:Entity) RETURN e ORDER BY e.frequency DESC',
      { id }
    );

    res.json({
      success: true,
      data: {
        document,
        chunks: chunksResult.records.map(r => r.get('c').properties),
        entities: entitiesResult.records.map(r => r.get('e').properties)
      }
    });

  } catch (error) {
    logger.error('获取文档详情失败', { error: error.message, id: req.params.id });

    res.status(500).json({
      success: false,
      message: '获取文档详情失败',
      error: error.message
    });
  }
});

/**
 * 删除文档
 * DELETE /api/documents/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 获取文档信息
    const docResult = await neo4jStorage.runQuery(
      'MATCH (d:Document {id: $id}) RETURN d',
      { id }
    );

    if (docResult.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    const document = docResult.records[0].get('d').properties;

    // 删除文档及相关数据（统一走存储层，确保与索引维度等配置一致）
    await neo4jStorage.deleteDocument(id);

    // 删除文件系统中的文件
    if (document.path) {
      await fs.remove(document.path).catch(err => {
        logger.warn('删除文件失败', { path: document.path, error: err.message });
      });
    }

    logger.info(`文档删除成功: ${document.filename}`, { id });

    res.json({
      success: true,
      message: '文档删除成功',
      data: {
        id,
        filename: document.filename,
        deletedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('删除文档失败', { error: error.message, id: req.params.id });

    res.status(500).json({
      success: false,
      message: '删除文档失败',
      error: error.message
    });
  }
});

export default router;
