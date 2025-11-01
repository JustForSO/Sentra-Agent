import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import sizeOf from 'image-size';
import mimeTypes from 'mime-types';
import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import embeddingService from './embedding.js';
import imageHashService from './imageHashService.js';
import { OpenAI } from 'openai';

const logger = createLogger('ImageProcessor');

/**
 * 图片处理服务
 * 负责图片信息提取、描述生成、向量化、实体提取等功能
 * 支持类似文本处理的增强功能
 */
class ImageProcessor {
  constructor() {
    // 支持的图片格式及对应MIME类型
    this.supportedFormats = new Map([
      ['jpg', 'image/jpeg'],
      ['jpeg', 'image/jpeg'],
      ['png', 'image/png'],
      ['gif', 'image/gif'],
      ['webp', 'image/webp'],
      ['bmp', 'image/bmp'],
      ['tiff', 'image/tiff'],
      ['tif', 'image/tiff'],
      ['svg', 'image/svg+xml'],
      ['ico', 'image/x-icon'],
      ['heic', 'image/heic'],
      ['heif', 'image/heif']
    ]);
    this.maxImageSize = config.storage.maxFileSize || 50 * 1024 * 1024; // 50MB default
    
    // 初始化视觉模型客户端
    this.visionClient = new OpenAI({
      apiKey: process.env.VISION_API_KEY || process.env.OPENAI_API_KEY,
      baseURL: process.env.VISION_BASE_URL || process.env.OPENAI_BASE_URL
    });
    
    // 视觉模型配置
    this.visionModel = process.env.VISION_MODEL || 'gpt-4o-mini';
    this.visionMaxTokens = process.env.VISION_MAX_TOKENS === '-1' ? undefined : parseInt(process.env.VISION_MAX_TOKENS) || 1000;

    // 文本模型客户端（用于对视觉描述做结构化抽取/Tools）
    this.textClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL
    });
    this.textModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  /**
   * 处理图片文件（增强版）
   * @param {string} imagePath - 图片文件路径 
   * @param {Object} options - 处理选项
   * @returns {Object} 处理结果
   */
  async processImage(imagePath, options = {}) {
    try {
      logger.info(`开始智能处理图片: ${imagePath}`);

      // 1. 验证图片文件（基于MIME类型）
      const validation = await this.validateImageEnhanced(imagePath);
      
      // 2. 提取图片基本信息和元数据
      const imageInfo = await this.extractImageInfoEnhanced(imagePath);

      // 3. 智能图片分析（描述、实体、关键词、情感）
      const analysis = await this.analyzeImageWithAI(imagePath, options);

      // 4. OCR文字提取（如果图片包含文字）
      let extractedText = '';
      if (options.enableOCR !== false) {
        extractedText = await this.extractTextFromImageAI(imagePath);
      }

      // 5. 计算图片哈希（用于以图搜图）
      let hashes = null;
      if (options.enableHash !== false) {
        try {
          hashes = await imageHashService.calculateAllHashes(imagePath);
          logger.debug('图片哈希计算完成', { phash: hashes.phash, dhash: hashes.dhash });
        } catch (hashError) {
          logger.warn('图片哈希计算失败，跳过', { error: hashError.message });
        }
      }

      // 6. 生成增强向量（融合描述、OCR文字、关键词）
      const enrichedContent = this.buildEnrichedContent(analysis, extractedText, imageInfo);
      const embedding = await embeddingService.getTextEmbedding(enrichedContent);

      // 7. 生成缩略图路径
      let thumbnailPath = null;
      if (options.generateThumbnail) {
        thumbnailPath = await this.generateThumbnailPath(imagePath);
      }

      const result = {
        id: this.generateImageId(),
        filename: path.basename(imagePath),
        path: imagePath,
        thumbnailPath,
        ...imageInfo,
        // AI分析结果
        description: analysis.description || '',
        title: analysis.title || path.basename(imagePath, path.extname(imagePath)),
        summary: analysis.summary || '',
        keywords: analysis.keywords || [],
        entities: analysis.entities || [],
        emotions: analysis.emotions || [],
        colors: analysis.colors || [],
        objects: analysis.objects || [],
        // OCR结果
        extractedText,
        // 图片哈希（用于以图搜图）
        ...(hashes && {
          phash: hashes.phash,
          dhash: hashes.dhash,
          ahash: hashes.ahash,
          hash_algorithm: hashes.algorithm
        }),
        // 向量和元数据
        embedding,
        timestamp: Date.now(),
        local_time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        created_at: new Date().toISOString(),
        metadata: {
          processedAt: new Date().toISOString(),
          processingOptions: options,
          validation,
          enrichedContentLength: enrichedContent.length,
          ...(hashes && { hashAlgorithm: hashes.algorithm })
        }
      };

      logger.info(`图片智能处理完成: ${imagePath}`, {
        size: imageInfo.size,
        dimensions: `${imageInfo.width}x${imageInfo.height}`,
        format: imageInfo.format,
        mimeType: imageInfo.mimeType,
        descriptionLength: analysis.description?.length || 0,
        keywordCount: analysis.keywords?.length || 0,
        entityCount: analysis.entities?.length || 0,
        extractedTextLength: extractedText.length
      });

      return result;

    } catch (error) {
      logger.error(`图片处理失败: ${imagePath}`, { error: error.message });
      throw new Error(`图片处理失败: ${error.message}`);
    }
  }

  /**
   * 增强图片验证（基于MIME类型）
   * @param {string} imagePath - 图片路径
   * @returns {Object} 验证结果
   */
  async validateImageEnhanced(imagePath) {
    const validation = {
      exists: false,
      validSize: false,
      validFormat: false,
      mimeType: null,
      detectedFormat: null,
      fileSize: 0
    };

    try {
      // 1. 检查文件是否存在
      if (!await fs.pathExists(imagePath)) {
        throw new Error('图片文件不存在');
      }
      validation.exists = true;

      // 2. 获取文件统计信息
      const stats = await fs.stat(imagePath);
      validation.fileSize = stats.size;

      // 3. 检查文件大小
      if (stats.size > this.maxImageSize) {
        throw new Error(`图片文件过大: ${Math.round(stats.size / 1024 / 1024)}MB > ${Math.round(this.maxImageSize / 1024 / 1024)}MB`);
      }
      validation.validSize = true;

      // 4. 基于MIME类型检测格式
      const detectedMimeType = mimeTypes.lookup(imagePath);
      const ext = path.extname(imagePath).toLowerCase().slice(1);
      
      validation.mimeType = detectedMimeType;
      validation.detectedFormat = ext;

      // 5. 验证是否为支持的图片格式
      if (!this.supportedFormats.has(ext)) {
        throw new Error(`不支持的图片格式: ${ext} (MIME: ${detectedMimeType})`);
      }

      // 6. 验证MIME类型一致性
      const expectedMimeType = this.supportedFormats.get(ext);
      if (detectedMimeType && detectedMimeType !== expectedMimeType) {
        logger.warn(`MIME类型不匹配: 扩展名=${ext}, 检测到=${detectedMimeType}, 期望=${expectedMimeType}`);
      }
      validation.validFormat = true;

      logger.debug(`图片验证通过: ${imagePath}`, validation);
      return validation;

    } catch (error) {
      logger.error(`图片验证失败: ${imagePath}`, { error: error.message, validation });
      throw error;
    }
  }

  /**
   * 增强图片信息提取
   * @param {string} imagePath - 图片路径
   * @returns {Object} 增强图片信息
   */
  async extractImageInfoEnhanced(imagePath) {
    try {
      // 1. 获取图片尺寸信息
      const dimensions = sizeOf(imagePath);
      
      // 2. 获取文件统计信息
      const stats = await fs.stat(imagePath);
      
      // 3. 获取精确的MIME类型
      const mimeType = mimeTypes.lookup(imagePath) || 'application/octet-stream';
      const ext = path.extname(imagePath).toLowerCase().slice(1);
      
      // 4. 计算衍生信息
      const aspectRatio = dimensions.width / dimensions.height;
      const megapixels = Math.round((dimensions.width * dimensions.height) / 1000000 * 100) / 100;
      const sizeInKB = Math.round(stats.size / 1024 * 100) / 100;
      const sizeInMB = Math.round(stats.size / 1024 / 1024 * 100) / 100;
      
      // 5. 图片质量和特征分析
      const isHighRes = dimensions.width >= 1920 || dimensions.height >= 1080;
      const isPortrait = aspectRatio < 1;
      const isLandscape = aspectRatio > 1;
      const isSquare = Math.abs(aspectRatio - 1) < 0.1;

      const info = {
        // 基础信息
        width: dimensions.width,
        height: dimensions.height,
        format: dimensions.type || ext,
        size: stats.size,
        sizeInKB,
        sizeInMB,
        mimeType,
        extension: ext,
        
        // 计算属性
        aspectRatio: Math.round(aspectRatio * 100) / 100,
        megapixels,
        dimensions: `${dimensions.width}x${dimensions.height}`,
        
        // 分类特征
        isHighRes,
        isPortrait,
        isLandscape,
        isSquare,
        orientation: isPortrait ? 'portrait' : isLandscape ? 'landscape' : 'square',
        
        // 时间信息
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        
        // 质量评估
        quality: this.assessImageQuality(dimensions, stats.size)
      };

      logger.debug(`增强图片信息提取完成: ${imagePath}`, {
        dimensions: info.dimensions,
        format: info.format,
        size: `${info.sizeInMB}MB`,
        quality: info.quality,
        orientation: info.orientation
      });
      
      return info;

    } catch (error) {
      logger.error(`提取图片信息失败: ${imagePath}`, { error: error.message });
      throw new Error(`提取图片信息失败: ${error.message}`);
    }
  }

  /**
   * 使用AI智能分析图片（Tools结构化分析）
   * @param {string} imagePath - 图片路径
   * @param {Object} options - 分析选项
   * @returns {Object} AI分析结果
   */
  async analyzeImageWithAI(imagePath, options = {}) {
    try {
      logger.info(`开始AI智能分析图片: ${imagePath}`);

      // 1) 视觉模型：仅做内容识别 -> 返回原始描述文本
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = mimeTypes.lookup(imagePath) || 'image/webp';
      const visionText = await this.describeImageWithVision(base64Image, mimeType);

      // 2) 文本模型（Tools）：根据视觉描述做结构化抽取
      let analysis;
      try {
        analysis = await this.structureVisionDescriptionWithTools(visionText);
      } catch (e) {
        logger.warn(`文本Tools结构化失败，回退到JSON: ${e.message}`);
        analysis = await this.structureVisionDescriptionWithJSON(visionText);
      }

      // 3) 兜底：标题与必要字段
      const title = analysis.title && String(analysis.title).trim()
        ? analysis.title
        : this.deriveTitleFromText(visionText, analysis.keywords, analysis.entities);

      return {
        title,
        description: analysis.description && analysis.description.trim() ? analysis.description : visionText,
        summary: analysis.summary || '',
        keywords: Array.isArray(analysis.keywords) ? analysis.keywords : [],
        entities: Array.isArray(analysis.entities) ? analysis.entities : [],
        emotions: Array.isArray(analysis.emotions) ? analysis.emotions : [],
        colors: Array.isArray(analysis.colors) ? analysis.colors : [],
        objects: Array.isArray(analysis.objects) ? analysis.objects : []
      };

    } catch (error) {
      logger.error(`AI图片分析失败: ${imagePath}`, { error: error.message });
      return {
        description: `图片文件: ${path.basename(imagePath)}`,
        title: path.basename(imagePath, path.extname(imagePath)),
        summary: '图片内容分析失败',
        keywords: [],
        entities: [],
        emotions: [],
        colors: [],
        objects: []
      };
    }
  }

  /**
   * 视觉模型仅返回纯文本描述
   */
  async describeImageWithVision(base64Image, mimeType) {
    const resp = await this.visionClient.chat.completions.create({
      model: this.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请用中文详细描述这张图片的内容与场景、主体、颜色、状态与动作，仅输出纯文本描述。' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ],
      ...(this.visionMaxTokens && { max_tokens: this.visionMaxTokens }),
      temperature: 0.3
    });
    const text = resp.choices?.[0]?.message?.content || '';
    return (text || '').trim();
  }

  /**
   * 使用文本模型 Tools 将视觉描述结构化
   */
  async structureVisionDescriptionWithTools(descriptionText) {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'structure_image_description',
          description: '将图片的文字描述结构化为标题、描述、摘要、关键词、实体、情感、颜色、对象',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '简洁标题' },
              description: { type: 'string', description: '详细描述（直接来源于输入或润色）' },
              summary: { type: 'string', description: '摘要，1-2 句' },
              keywords: { type: 'array', items: { type: 'string' } },
              entities: { type: 'array', items: { type: 'string' } },
              emotions: { type: 'array', items: { type: 'string' } },
              colors: { type: 'array', items: { type: 'string' } },
              objects: { type: 'array', items: { type: 'string' } }
            },
            required: ['title', 'description', 'summary', 'keywords', 'entities']
          }
        }
      }
    ];

    const response = await this.textClient.chat.completions.create({
      model: this.textModel,
      messages: [
        { role: 'system', content: '你是一个专业的内容结构化助手。' },
        { role: 'user', content: `请将以下图片描述结构化为统一字段。\n\n描述：\n${descriptionText}` }
      ],
      tools,
      tool_choice: { type: 'function', function: { name: 'structure_image_description' } },
      temperature: 0.2
    });

    const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      return JSON.parse(toolCall.function.arguments);
    }
    throw new Error('Tools 未返回结构化结果');
  }

  /**
   * 文本模型 JSON 回退：让模型直接输出 JSON，再解析
   */
  async structureVisionDescriptionWithJSON(descriptionText) {
    const response = await this.textClient.chat.completions.create({
      model: this.textModel,
      messages: [
        { role: 'system', content: '你是一个专业的内容结构化助手。' },
        { role: 'user', content: `请将以下图片描述整理为 JSON，包含字段：title, description, summary, keywords[], entities[], emotions[], colors[], objects[]。只输出 JSON。\n\n描述：\n${descriptionText}` }
      ],
      temperature: 0.2
    });
    const content = response.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch {}
    }
    return {
      title: this.deriveTitleFromText(descriptionText),
      description: descriptionText,
      summary: descriptionText.split(/[。.!?\n]/).slice(0, 2).join(' ').trim(),
      keywords: [],
      entities: [],
      emotions: [],
      colors: [],
      objects: []
    };
  }

  /**
   * 基于文本简单生成标题（兜底）
   */
  deriveTitleFromText(text, keywords = [], entities = []) {
    const firstSentence = (text || '').split(/[。.!?\n]/)[0]?.trim() || '';
    if (Array.isArray(keywords) && keywords.length) {
      const k = keywords.slice(0, 3).join('、');
      return `${k}${firstSentence ? ' | ' + firstSentence.slice(0, 16) : ''}`.slice(0, 32) || '图片内容';
    }
    if (Array.isArray(entities) && entities.length) {
      const e = entities[0];
      return `${e}${firstSentence ? ' | ' + firstSentence.slice(0, 16) : ''}`.slice(0, 32) || '图片内容';
    }
    return firstSentence.slice(0, 24) || '图片内容';
  }

  /**
   * 使用Tools进行结构化图片分析
   * @param {string} base64Image - base64图片数据
   * @param {string} mimeType - 图片MIME类型
   * @returns {Object} 结构化分析结果
   */
  async analyzeImageWithTools(base64Image, mimeType) {
    const response = await this.visionClient.chat.completions.create({
      model: this.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: '请分析这张图片并提供结构化信息。识别主要内容、生成标题摘要、提取关键词和实体。' 
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
      tools: [
        {
          type: 'function',
          function: {
            name: 'analyze_image_content',
            description: '分析图片内容并返回结构化信息',
            parameters: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: '图片的简洁标题'
                },
                description: {
                  type: 'string',
                  description: '图片的详细描述，包含场景、对象、活动等'
                },
                summary: {
                  type: 'string',
                  description: '图片内容的简要摘要，1-2句话'
                },
                keywords: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '描述图片的关键词，5-8个'
                },
                entities: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '图片中的主要实体，如人物、地点、物品等'
                },
                emotions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '图片传达的情感色调或氛围'
                },
                colors: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '图片的主要颜色'
                },
                objects: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '图片中可识别的主要对象'
                }
              },
              required: ['title', 'description', 'summary', 'keywords', 'entities']
            }
          }
        }
      ],
      tool_choice: { type: 'function', function: { name: 'analyze_image_content' } },
      ...(this.visionMaxTokens && { max_tokens: this.visionMaxTokens })
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      return JSON.parse(toolCall.function.arguments);
    }
    
    throw new Error('Tools分析未返回预期结果');
  }

  /**
   * 使用JSON格式进行图片分析（回退方案）
   * @param {string} base64Image - base64图片数据
   * @param {string} mimeType - 图片MIME类型
   * @returns {Object} 分析结果
   */
  async analyzeImageWithJSON(base64Image, mimeType) {
    const response = await this.visionClient.chat.completions.create({
      model: this.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: '请分析这张图片并返回JSON格式的结构化信息，包含：title(标题)、description(详细描述)、summary(摘要)、keywords(关键词数组)、entities(实体数组)、emotions(情感数组)、colors(颜色数组)、objects(对象数组)。' 
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
      ...(this.visionMaxTokens && { max_tokens: this.visionMaxTokens }),
      temperature: 0.1
    });

    const content = response.choices[0]?.message?.content || '';
    
    // 尝试提取JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        logger.warn('JSON解析失败，返回基础结果');
      }
    }
    
    // 最终回退
    return {
      title: '图片内容',
      description: content.substring(0, 200) || '无法分析图片内容',
      summary: '图片分析结果',
      keywords: [],
      entities: [],
      emotions: [],
      colors: [],
      objects: []
    };
  }


  /**
   * 提取图片中的主要文字内容
   * @param {string} imagePath - 图片路径
   * @returns {string} 提取的文字
   */
  async extractTextFromImageAI(imagePath) {
    try {
      logger.info(`开始提取图片文字: ${imagePath}`);
      
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = mimeTypes.lookup(imagePath) || 'image/jpeg';

      const response = await this.visionClient.chat.completions.create({
        model: this.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: '提取图片中的主要文字内容。只返回清晰可读的文字，忽略模糊或不重要的文字。如果没有文字则返回空字符串。' 
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
        max_tokens: 300,
        temperature: 0
      });

      const extractedText = response.choices[0]?.message?.content?.trim() || '';
      
      logger.info(`图片文字提取完成: ${imagePath}`, { 
        textLength: extractedText.length,
        hasText: extractedText.length > 0
      });
      
      return extractedText;

    } catch (error) {
      logger.error(`图片文字提取失败: ${imagePath}`, { error: error.message });
      return '';
    }
  }

  /**
   * 构建增强内容（用于向量生成）
   * @param {Object} analysis - AI分析结果
   * @param {string} extractedText - OCR提取的文字
   * @param {Object} imageInfo - 图片信息
   * @returns {string} 增强内容
   */
  buildEnrichedContent(analysis, extractedText, imageInfo) {
    const parts = [];
    
    // 标题（作为主要标识）
    if (analysis.title) {
      parts.push(`标题: ${analysis.title}`);
    }
    
    // 详细描述（核心内容）
    if (analysis.description) {
      parts.push(`详细描述: ${analysis.description}`);
    }
    
    // 摘要
    if (analysis.summary) {
      parts.push(`摘要: ${analysis.summary}`);
    }
    
    // 关键词
    if (Array.isArray(analysis.keywords) && analysis.keywords.length) {
      parts.push(`关键词: ${analysis.keywords.join(', ')}`);
    }
    
    // 实体
    if (Array.isArray(analysis.entities) && analysis.entities.length) {
      parts.push(`实体: ${analysis.entities.join(', ')}`);
    }
    
    // 情感色调
    if (Array.isArray(analysis.emotions) && analysis.emotions.length) {
      parts.push(`情感色调: ${analysis.emotions.join(', ')}`);
    }
    
    // 主要颜色
    if (Array.isArray(analysis.colors) && analysis.colors.length) {
      parts.push(`主要颜色: ${analysis.colors.join(', ')}`);
    }
    
    // 检测对象
    if (Array.isArray(analysis.objects) && analysis.objects.length) {
      parts.push(`检测对象: ${analysis.objects.join(', ')}`);
    }
    
    // OCR提取的文字
    if (extractedText) {
      parts.push(`图片文字: ${extractedText}`);
    }
    
    // 图片技术信息
    parts.push(`图片信息: ${imageInfo.dimensions}, ${imageInfo.format}, ${imageInfo.orientation}, ${imageInfo.quality}`);
    
    return parts.join('\n');
  }

  /**
   * 评估图片质量
   * @param {Object} dimensions - 图片尺寸
   * @param {number} fileSize - 文件大小
   * @returns {string} 质量评级
   */
  assessImageQuality(dimensions, fileSize) {
    const pixels = dimensions.width * dimensions.height;
    const compressionRatio = fileSize / pixels; // 每像素字节数
    
    if (pixels >= 8000000 && compressionRatio > 3) { // 8MP+, 高压缩比
      return '高质量';
    } else if (pixels >= 2000000 && compressionRatio > 1) { // 2MP+, 中等压缩比
      return '中等质量';
    } else if (pixels >= 500000) { // 0.5MP+
      return '标准质量';
    } else {
      return '低质量';
    }
  }


  /**
   * 生成缩略图路径（计划功能）
   * @param {string} imagePath - 原图片路径
   * @returns {string} 缩略图路径
   */
  async generateThumbnailPath(imagePath) {
    const ext = path.extname(imagePath);
    const basename = path.basename(imagePath, ext);
    const dirname = path.dirname(imagePath);
    
    return path.join(dirname, 'thumbnails', `${basename}_thumb${ext}`);
  }

  /**
   * 处理文档图片（兼容旧版本）
   * @param {string} imagePath - 图片路径
   * @param {string} documentId - 文档ID
   * @returns {Object} 处理结果
   */
  async processDocumentImage(imagePath, documentId) {
    try {
      const result = await this.processImage(imagePath, {
        generateDescription: true,
        enableOCR: true,
        generateThumbnail: false
      });
      
      // 添加文档关联信息
      result.documentId = documentId;
      result.type = 'document_image';
      
      return result;
      
    } catch (error) {
      logger.error(`处理文档图片失败: ${imagePath}`, { documentId, error: error.message });
      throw error;
    }
  }

  /**
   * 验证并转换图片格式
   * @param {string} inputPath - 输入图片路径
   * @param {string} outputPath - 输出图片路径
   * @param {string} targetFormat - 目标格式
   * @param {Object} options - 转换选项
   * @returns {Object} 转换结果
   */
  async convertImageFormat(inputPath, outputPath, targetFormat, options = {}) {
    // 这是一个计划功能，可以集成图片转换库如Sharp
    logger.info(`图片格式转换功能计划中: ${inputPath} -> ${outputPath} (${targetFormat})`);
    return {
      success: false,
      message: '图片格式转换功能暂未实现，可集成Sharp等库'
    };
  }

  /**
   * 生成图片缩略图
   * @param {string} inputPath - 输入图片路径
   * @param {string} outputPath - 输出缩略图路径
   * @param {Object} options - 缩略图选项
   * @returns {Object} 生成结果
   */
  async generateThumbnail(inputPath, outputPath, options = {}) {
    // 这是一个计划功能，可以集成图片处理库
    const { width = 200, height = 200, quality = 80 } = options;
    logger.info(`缩略图生成功能计划中: ${inputPath} -> ${outputPath} (${width}x${height})`);
    return {
      success: false,
      message: '缩略图生成功能暂未实现，可集成Sharp等库'
    };
  }

  /**
   * 批量智能处理图片
   * @param {Array} imagePaths - 图片路径数组
   * @param {Object} options - 处理选项
   * @returns {Array} 处理结果数组
   */
  async processImagesEnhanced(imagePaths, options = {}) {
    try {
      logger.info(`开始批量智能处理图片: ${imagePaths.length} 个文件`);

      const results = [];
      const batchSize = options.batchSize || 5; // 减少并发数以避免API限制

      for (let i = 0; i < imagePaths.length; i += batchSize) {
        const batch = imagePaths.slice(i, i + batchSize);
        logger.info(`处理批次: ${i + 1}-${Math.min(i + batchSize, imagePaths.length)}/${imagePaths.length}`);

        const batchPromises = batch.map(imagePath => 
          this.processImage(imagePath, options).catch(error => ({
            error: error.message,
            imagePath,
            id: `error_${crypto.randomUUID()}`
          }))
        );

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // 避免API请求过于频繁
        if (i + batchSize < imagePaths.length) {
          await this.delay(2000); // 增加延迟
        }
      }

      const successCount = results.filter(r => !r.error).length;
      const errorCount = results.filter(r => r.error).length;

      logger.info(`批量图片智能处理完成`, { 
        total: imagePaths.length,
        success: successCount,
        errors: errorCount
      });

      return results;

    } catch (error) {
      logger.error('批量图片处理失败', { error: error.message });
      throw new Error(`批量图片处理失败: ${error.message}`);
    }
  }

  /**
   * 获取支持的图片格式详细信息
   * @returns {Object} 格式信息
   */
  getSupportedFormatsInfo() {
    const formats = {};
    for (const [ext, mimeType] of this.supportedFormats) {
      formats[ext] = {
        extension: ext,
        mimeType,
        description: this.getFormatDescription(ext)
      };
    }
    return formats;
  }

  /**
   * 获取格式描述
   * @param {string} ext - 文件扩展名
   * @returns {string} 格式描述
   */
  getFormatDescription(ext) {
    const descriptions = {
      'jpg': 'JPEG 压缩图片，适合照片',
      'jpeg': 'JPEG 压缩图片，适合照片',
      'png': 'PNG 无损图片，支持透明度',
      'gif': 'GIF 动图，支持动画',
      'webp': 'WebP 现代格式，高压缩比',
      'bmp': 'BMP 位图，无压缩',
      'tiff': 'TIFF 专业格式，高质量',
      'tif': 'TIFF 专业格式，高质量',
      'svg': 'SVG 矢量图，可缩放',
      'ico': 'ICO 图标格式',
      'heic': 'HEIC 苹果格式，高效压缩',
      'heif': 'HEIF 高效图片格式'
    };
    return descriptions[ext] || '支持的图片格式';
  }

  /**
   * 生成图片ID
   * @returns {string} 唯一ID
   */
  generateImageId() {
    return `image_${crypto.randomUUID()}`;
  }

  /**
   * 延迟函数
   * @param {number} ms - 延迟毫秒数
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取支持的图片格式
   * @returns {Array} 支持的格式列表
   */
  getSupportedFormats() {
    return Array.from(this.supportedFormats.keys());
  }

  /**
   * 获取支持的MIME类型列表
   * @returns {Array} MIME类型列表
   */
  getSupportedMimeTypes() {
    return Array.from(this.supportedFormats.values());
  }

  /**
   * 检查文件是否为支持的图片格式
   * @param {string} filename - 文件名
   * @returns {boolean} 是否支持
   */
  isSupportedImageFormat(filename) {
    const ext = path.extname(filename).toLowerCase().slice(1);
    return this.supportedFormats.has(ext);
  }

  /**
   * 根据MIME类型检查是否为支持的图片
   * @param {string} mimeType - MIME类型
   * @returns {boolean} 是否支持
   */
  isSupportedMimeType(mimeType) {
    return Array.from(this.supportedFormats.values()).includes(mimeType);
  }

  /**
   * 获取文件的MIME类型
   * @param {string} filePath - 文件路径
   * @returns {string} MIME类型
   */
  getMimeType(filePath) {
    return mimeTypes.lookup(filePath) || 'application/octet-stream';
  }

  /**
   * 根据MIME类型获取建议的文件扩展名
   * @param {string} mimeType - MIME类型
   * @returns {string} 文件扩展名
   */
  getExtensionByMimeType(mimeType) {
    return mimeTypes.extension(mimeType) || 'bin';
  }
}

// 创建单例实例
const imageProcessor = new ImageProcessor();

export default imageProcessor;
