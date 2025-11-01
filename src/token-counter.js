import { encoding_for_model } from 'tiktoken';
import { imageSize } from 'image-size';
import { imageSizeFromFile } from 'image-size/fromFile';
import https from 'https';
import http from 'http';
import { readFileSync, createWriteStream, unlinkSync, existsSync, mkdirSync } from 'fs';
import { promisify } from 'util';

/**
 * Token计算工具类 - 支持文本和图片的token计算
 */
export class TokenCounter {
  constructor() {
    // 编码器缓存 - 避免重复创建
    this.encoders = new Map();
    // 图片尺寸缓存 - 避免重复计算网络图片
    this.imageSizeCache = new Map();
    // 临时文件目录
    this.tempDir = './temp';
    
    // 确保临时目录存在
    this.ensureTempDir();
  }

  /**
   * 确保临时文件目录存在
   */
  ensureTempDir() {
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * 获取指定模型的编码器
   * @param {string} modelName 模型名称
   * @returns {Object} tiktoken编码器
   */
  getEncoder(modelName) {
    if (!this.encoders.has(modelName)) {
      try {
        const encoder = encoding_for_model(modelName);
        this.encoders.set(modelName, encoder);
        return encoder;
      } catch (error) {
        console.warn(`不支持的模型: ${modelName}, 使用默认编码器`);
        // 使用GPT-4的编码器作为默认
        const encoder = encoding_for_model('gpt-4o');
        this.encoders.set(modelName, encoder);
        return encoder;
      }
    }
    return this.encoders.get(modelName);
  }

  /**
   * 计算文本的token数量
   * @param {string} text 文本内容
   * @param {string} modelName 模型名称
   * @returns {number} token数量
   */
  countTokens(text, modelName = 'gpt-4o-mini') {
    try {
      const encoder = this.getEncoder(modelName);
      const tokens = encoder.encode(text);
      return tokens.length;
    } catch (error) {
      console.error('计算token时出错:', error);
      return 0;
    }
  }

  /**
   * 计算消息列表的token数量
   * @param {Array} messages 消息列表
   * @param {string} modelName 模型名称
   * @returns {Promise<number>} token数量
   */
  async countMessageTokens(messages, modelName = 'gpt-4o-mini') {
    let totalTokens = 0;

    // 每条消息的基础开销
    const baseTokensPerMessage = 3;
    const tokensPerName = 1;

    for (const message of messages) {
      totalTokens += baseTokensPerMessage;

      // 处理消息名称
      if (message.name) {
        totalTokens += tokensPerName;
      }

      // 处理消息角色
      if (message.role) {
        totalTokens += this.countTokens(message.role, modelName);
      }

      // 处理消息内容
      if (message.content) {
        if (typeof message.content === 'string') {
          // 纯文本消息
          totalTokens += this.countTokens(message.content, modelName);
        } else if (Array.isArray(message.content)) {
          // 多模态消息（文本+图片）
          for (const item of message.content) {
            if (item.type === 'text') {
              totalTokens += this.countTokens(item.text, modelName);
            } else if (item.type === 'image_url') {
              totalTokens += await this.calculateImageTokens(item);
            }
          }
        }
      }
    }

    // 对话的额外开销
    totalTokens += 3;

    return totalTokens;
  }

  /**
   * 获取图片尺寸 - 统一处理本地文件和网络图片
   * @param {string} imagePath 图片路径或URL
   * @returns {Promise<Object>} 包含width和height的对象
   */
  async getImageDimensions(imagePath) {
    // 检查缓存
    if (this.imageSizeCache.has(imagePath)) {
      console.log(`使用缓存的图片尺寸: ${imagePath}`);
      return this.imageSizeCache.get(imagePath);
    }

    let dimensions = null;

    try {
      if (this.isUrl(imagePath)) {
        // 处理网络图片
        dimensions = await this.getNetworkImageDimensions(imagePath);
      } else {
        // 处理本地图片
        dimensions = await this.getLocalImageDimensions(imagePath);
      }

      // 验证尺寸有效性
      if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
        throw new Error(`无效的图片尺寸: ${JSON.stringify(dimensions)}`);
      }

      // 缓存结果
      this.imageSizeCache.set(imagePath, dimensions);
      console.log(`✅ 成功获取图片尺寸 ${imagePath}: ${dimensions.width}x${dimensions.height}`);
      return dimensions;

    } catch (error) {
      console.warn(`⚠️ 获取图片尺寸失败 ${imagePath}: ${error.message}`);
      
      // 使用智能默认值
      const fallbackDimensions = this.getSmartDefaultDimensions(imagePath);
      this.imageSizeCache.set(imagePath, fallbackDimensions);
      console.warn(`使用默认尺寸: ${fallbackDimensions.width}x${fallbackDimensions.height}`);
      return fallbackDimensions;
    }
  }

  /**
   * 获取本地图片尺寸
   * @param {string} filePath 本地文件路径
   * @returns {Promise<Object>} 图片尺寸
   */
  async getLocalImageDimensions(filePath) {
    try {
      // 使用新版 image-size API 的异步文件读取
      const dimensions = await imageSizeFromFile(filePath);
      return { width: dimensions.width, height: dimensions.height };
    } catch (error) {
      console.warn(`imageSizeFromFile失败，尝试buffer方式: ${error.message}`);
      
      // 降级方案：手动读取文件为buffer
      try {
        const buffer = readFileSync(filePath);
        const dimensions = imageSize(buffer);
        return { width: dimensions.width, height: dimensions.height };
      } catch (bufferError) {
        throw new Error(`无法读取本地图片文件: ${bufferError.message}`);
      }
    }
  }

  /**
   * 获取网络图片尺寸
   * @param {string} url 图片URL
   * @returns {Promise<Object>} 图片尺寸
   */
  async getNetworkImageDimensions(url) {
    let tempFilePath = null;
    
    try {
      console.log(`开始处理网络图片: ${url}`);
      
      // 下载图片到临时文件
      tempFilePath = await this.downloadImageToTemp(url);
      
      // 读取临时文件获取尺寸
      const buffer = readFileSync(tempFilePath);
      const dimensions = imageSize(buffer);
      
      if (!dimensions || !dimensions.width || !dimensions.height) {
        throw new Error('无法解析图片尺寸');
      }
      
      return { width: dimensions.width, height: dimensions.height };
      
    } finally {
      // 清理临时文件
      if (tempFilePath) {
        this.cleanupTempFile(tempFilePath);
      }
    }
  }

  /**
   * 下载网络图片到临时文件
   * @param {string} url 图片URL
   * @returns {Promise<string>} 临时文件路径
   */
  async downloadImageToTemp(url) {
    const filename = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.tmp`;
    const tempPath = `${this.tempDir}/${filename}`;

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https:') ? https : http;

      const request = protocol.get(url, (response) => {
        // 检查HTTP状态码
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        // 检查内容类型
        const contentType = response.headers['content-type'];
        if (contentType && !contentType.startsWith('image/')) {
          reject(new Error(`不是图片文件，内容类型: ${contentType}`));
          return;
        }

        const fileStream = createWriteStream(tempPath);
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            console.log(`图片下载完成: ${tempPath}`);
            resolve(tempPath);
          });
        });

        fileStream.on('error', (error) => {
          this.cleanupTempFile(tempPath);
          reject(error);
        });
      });

      request.on('error', (error) => {
        reject(new Error(`网络请求失败: ${error.message}`));
      });

      // 设置30秒超时
      request.setTimeout(30000, () => {
        request.destroy();
        this.cleanupTempFile(tempPath);
        reject(new Error('下载超时（30秒）'));
      });
    });
  }

  /**
   * 根据OpenAI公式计算图片的token数量
   * @param {Object} imageItem 图片项目，包含image_url和可选的detail参数
   * @returns {Promise<number>} token数量
   */
  async calculateImageTokens(imageItem) {
    const detail = imageItem.detail || 'auto';
    const imageUrl = imageItem.image_url?.url || imageItem.image_url;

    if (!imageUrl) {
      throw new Error('图片URL不能为空');
    }

    try {
      // 获取图片实际尺寸
      const dimensions = await this.getImageDimensions(imageUrl);
      
      // 计算tile信息
      const tileInfo = this.calculateImageTiles(dimensions.width, dimensions.height, detail);
      
      // 根据OpenAI公式计算token
      const baseTokens = 85; // 基础开销
      let tokensPerTile;

      if (detail === 'low') {
        tokensPerTile = 85;
      } else if (detail === 'high') {
        tokensPerTile = 170;
      } else { // auto模式
        // 根据图片复杂度智能选择
        const area = dimensions.width * dimensions.height;
        if (area < 262144) { // 512x512以下
          tokensPerTile = 85;
        } else {
          tokensPerTile = 170;
        }
      }

      const totalTokens = baseTokens + (tileInfo.totalTiles * tokensPerTile);

      // 调试信息
      if (process.env.NODE_ENV === 'development') {
        console.log('🔍 图片token计算详情:', {
          url: imageUrl,
          dimensions,
          detail,
          tiles: tileInfo.totalTiles,
          tokensPerTile,
          totalTokens
        });
      }

      return totalTokens;

    } catch (error) {
      console.warn(`计算图片token失败: ${error.message}`);
      // 返回保守估计值
      return detail === 'high' ? 255 : 170; // 85基础 + 1tile * 85或170
    }
  }

  /**
   * 计算图片需要的tile数量（基于OpenAI算法）
   * @param {number} width 图片宽度
   * @param {number} height 图片高度
   * @param {string} detail 分辨率模式
   * @returns {Object} tile信息
   */
  calculateImageTiles(width, height, detail = 'auto') {
    // OpenAI的tile计算算法
    let scaledWidth, scaledHeight;

    if (detail === 'low') {
      // 低分辨率模式：固定使用1个tile
      return {
        scaledWidth: 512,
        scaledHeight: 512,
        tilesX: 1,
        tilesY: 1,
        totalTiles: 1
      };
    }

    // 高分辨率模式或auto模式
    // 1. 将图片缩放到最长边不超过2048像素
    const maxDimension = Math.max(width, height);
    if (maxDimension > 2048) {
      const scale = 2048 / maxDimension;
      scaledWidth = Math.round(width * scale);
      scaledHeight = Math.round(height * scale);
    } else {
      scaledWidth = width;
      scaledHeight = height;
    }

    // 2. 将最短边缩放到768像素
    const minDimension = Math.min(scaledWidth, scaledHeight);
    if (minDimension > 768) {
      const scale = 768 / minDimension;
      scaledWidth = Math.round(scaledWidth * scale);
      scaledHeight = Math.round(scaledHeight * scale);
    }

    // 3. 计算需要多少个512x512的tile
    const tilesX = Math.ceil(scaledWidth / 512);
    const tilesY = Math.ceil(scaledHeight / 512);
    const totalTiles = tilesX * tilesY;

    return {
      scaledWidth,
      scaledHeight,
      tilesX,
      tilesY,
      totalTiles
    };
  }

  /**
   * 判断是否为URL
   * @param {string} str 字符串
   * @returns {boolean} 是否为URL
   */
  isUrl(str) {
    return str.startsWith('http://') || str.startsWith('https://');
  }

  /**
   * 获取智能默认尺寸
   * @param {string} imagePath 图片路径
   * @returns {Object} 默认尺寸
   */
  getSmartDefaultDimensions(imagePath) {
    const pathLower = imagePath.toLowerCase();
    
    // 根据文件扩展名提供合理默认值
    if (pathLower.includes('.gif')) {
      return { width: 400, height: 400 };
    } else if (pathLower.includes('.svg')) {
      return { width: 800, height: 600 };
    } else if (pathLower.includes('thumb') || pathLower.includes('small')) {
      return { width: 300, height: 200 };
    } else if (pathLower.includes('avatar') || pathLower.includes('profile')) {
      return { width: 200, height: 200 };
    } else {
      return { width: 1024, height: 768 }; // 常见的图片尺寸
    }
  }

  /**
   * 清理临时文件
   * @param {string} tempPath 临时文件路径
   */
  cleanupTempFile(tempPath) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
        console.log(`🗑️ 临时文件已清理: ${tempPath}`);
      }
    } catch (error) {
      console.warn(`清理临时文件失败: ${tempPath}`, error.message);
    }
  }

  /**
   * 获取文本统计信息
   * @param {string} text 文本内容
   * @param {string} modelName 模型名称
   * @returns {Object} 统计信息
   */
  getTextStats(text, modelName = 'gpt-4o-mini') {
    const tokenCount = this.countTokens(text, modelName);
    const charCount = text.length;
    const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;

    return {
      charCount,
      wordCount,
      tokenCount,
      model: modelName,
      tokensPerChar: charCount > 0 ? (tokenCount / charCount).toFixed(3) : 0,
      charsPerToken: tokenCount > 0 ? (charCount / tokenCount).toFixed(1) : 0
    };
  }

  /**
   * 估算请求的最大token数
   * @param {Array} messages 消息列表
   * @param {number} maxTokens 最大输出token数
   * @param {string} modelName 模型名称
   * @returns {Promise<number>} 估算的总token数
   */
  async estimateMaxTokens(messages, maxTokens = 4096, modelName = 'gpt-4o-mini') {
    const messageTokens = await this.countMessageTokens(messages, modelName);
    return messageTokens + maxTokens;
  }

  /**
   * 清理所有缓存和资源
   */
  cleanup() {
    // 释放编码器资源
    for (const encoder of this.encoders.values()) {
      if (encoder.free) {
        encoder.free();
      }
    }
    this.encoders.clear();
    this.imageSizeCache.clear();
    
    console.log('✨ TokenCounter资源已清理');
  }

  /**
   * 获取缓存统计信息
   * @returns {Object} 缓存统计
   */
  getCacheStats() {
    return {
      encoderCount: this.encoders.size,
      cachedImageCount: this.imageSizeCache.size
    };
  }

  /**
   * 获取缓存的图片数量
   * @returns {number} 缓存的图片数量
   */
  getCachedImageCount() {
    return this.imageSizeCache.size;
  }

  /**
   * 批量计算多个文本的token数量
   * @param {Array<string>} texts 文本数组
   * @param {string} modelName 模型名称
   * @returns {Array<Object>} 包含每个文本的token计算结果
   */
  countMultipleTokens(texts, modelName = 'gpt-4o-mini') {
    return texts.map(text => ({
      text,
      tokenCount: this.countTokens(text, modelName),
      length: text.length
    }));
  }

  /**
   * 批量计算多个图片的token数量
   * @param {Array<Object>} imageItems 图片项目数组
   * @returns {Promise<Array<Object>>} 包含每个图片的token计算结果
   */
  async calculateMultipleImageTokens(imageItems) {
    const results = [];
    
    for (const imageItem of imageItems) {
      try {
        const tokens = await this.calculateImageTokens(imageItem);
        results.push({
          imageUrl: imageItem.image_url?.url || imageItem.image_url,
          detail: imageItem.detail || 'auto',
          tokens,
          success: true
        });
      } catch (error) {
        results.push({
          imageUrl: imageItem.image_url?.url || imageItem.image_url,
          detail: imageItem.detail || 'auto',
          tokens: 0,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

// 导出单例实例
export const tokenCounter = new TokenCounter();