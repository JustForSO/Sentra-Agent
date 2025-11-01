import { Jimp } from 'jimp';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ImageHashService');

/**
 * 图片哈希服务（纯 JavaScript 实现，无 C++ 依赖）
 * 支持多种哈希算法用于以图搜图
 */
class ImageHashService {
  constructor() {
    // 哈希算法配置
    this.hashSize = 8; // 8x8 哈希矩阵
    this.hashBits = this.hashSize * this.hashSize; // 64位
    
    // 相似度阈值定义
    this.THRESHOLDS = {
      IDENTICAL: 0,         // 完全相同
      VERY_SIMILAR: 5,      // 非常相似（轻微修改）
      SIMILAR: 10,          // 相似（压缩、缩放）
      SOMEWHAT_SIMILAR: 15, // 有些相似
      DIFFERENT: 20         // 不同
    };
  }

  /**
   * 计算感知哈希（pHash - DCT 算法）
   * 对图片缩放、压缩、亮度调整有很好的容忍度
   * @param {string|Buffer} input - 图片路径或 Buffer
   * @returns {Promise<string>} 64位十六进制哈希
   */
  async calculatePHash(input) {
    try {
      const startTime = Date.now();
      
      // 读取图片
      const image = await Jimp.read(input);
      
      // 1. 缩放到 32x32（用于 DCT 变换）
      image.resize({ w: 32, h: 32 });
      image.greyscale();
      
      // 2. 获取像素矩阵
      const pixels = [];
      for (let y = 0; y < 32; y++) {
        const row = [];
        for (let x = 0; x < 32; x++) {
          // 直接从 bitmap 读取像素
          const idx = (y * image.bitmap.width + x) * 4;
          const r = image.bitmap.data[idx];
          row.push(r); // 灰度图 R=G=B
        }
        pixels.push(row);
      }
      
      // 3. 计算 DCT（离散余弦变换）
      const dctMatrix = this.computeDCT(pixels);
      
      // 4. 提取左上角 8x8 低频分量
      const lowFreq = [];
      for (let y = 0; y < this.hashSize; y++) {
        for (let x = 0; x < this.hashSize; x++) {
          lowFreq.push(dctMatrix[y][x]);
        }
      }
      
      // 5. 计算中值
      const sorted = [...lowFreq].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      
      // 6. 生成哈希（大于中值为1，小于为0）
      let hash = '';
      for (let i = 0; i < lowFreq.length; i++) {
        hash += lowFreq[i] > median ? '1' : '0';
      }
      
      // 7. 转换为十六进制
      const hexHash = this.binaryToHex(hash);
      
      const elapsed = Date.now() - startTime;
      logger.debug(`pHash 计算完成: ${hexHash} (${elapsed}ms)`);
      
      return hexHash;
      
    } catch (error) {
      logger.error('pHash 计算失败', { error: error.message });
      throw new Error(`pHash 计算失败: ${error.message}`);
    }
  }

  /**
   * 计算差异哈希（dHash - 梯度算法）
   * 速度更快，但对缩放和旋转敏感度较高
   * @param {string|Buffer} input - 图片路径或 Buffer
   * @returns {Promise<string>} 64位十六进制哈希
   */
  async calculateDHash(input) {
    try {
      const startTime = Date.now();
      
      // 读取图片
      const image = await Jimp.read(input);
      
      // 1. 缩放到 9x8（多一列用于计算差异）
      image.resize({ w: this.hashSize + 1, h: this.hashSize });
      image.greyscale();
      
      // 2. 计算水平梯度
      let hash = '';
      for (let y = 0; y < this.hashSize; y++) {
        for (let x = 0; x < this.hashSize; x++) {
          const leftIdx = (y * image.bitmap.width + x) * 4;
          const rightIdx = (y * image.bitmap.width + (x + 1)) * 4;
          const leftPixel = image.bitmap.data[leftIdx];
          const rightPixel = image.bitmap.data[rightIdx];
          hash += leftPixel < rightPixel ? '1' : '0';
        }
      }
      
      // 3. 转换为十六进制
      const hexHash = this.binaryToHex(hash);
      
      const elapsed = Date.now() - startTime;
      logger.debug(`dHash 计算完成: ${hexHash} (${elapsed}ms)`);
      
      return hexHash;
      
    } catch (error) {
      logger.error('dHash 计算失败', { error: error.message });
      throw new Error(`dHash 计算失败: ${error.message}`);
    }
  }

  /**
   * 计算平均哈希（aHash - 最简单快速）
   * 速度最快，但准确性较低
   * @param {string|Buffer} input - 图片路径或 Buffer
   * @returns {Promise<string>} 64位十六进制哈希
   */
  async calculateAHash(input) {
    try {
      const startTime = Date.now();
      
      // 读取图片
      const image = await Jimp.read(input);
      
      // 1. 缩放到 8x8
      image.resize({ w: this.hashSize, h: this.hashSize });
      image.greyscale();
      
      // 2. 计算平均值
      let sum = 0;
      for (let y = 0; y < this.hashSize; y++) {
        for (let x = 0; x < this.hashSize; x++) {
          const idx = (y * image.bitmap.width + x) * 4;
          sum += image.bitmap.data[idx];
        }
      }
      const average = sum / this.hashBits;
      
      // 3. 生成哈希（大于平均值为1，小于为0）
      let hash = '';
      for (let y = 0; y < this.hashSize; y++) {
        for (let x = 0; x < this.hashSize; x++) {
          const idx = (y * image.bitmap.width + x) * 4;
          const r = image.bitmap.data[idx];
          hash += r > average ? '1' : '0';
        }
      }
      
      // 4. 转换为十六进制
      const hexHash = this.binaryToHex(hash);
      
      const elapsed = Date.now() - startTime;
      logger.debug(`aHash 计算完成: ${hexHash} (${elapsed}ms)`);
      
      return hexHash;
      
    } catch (error) {
      logger.error('aHash 计算失败', { error: error.message });
      throw new Error(`aHash 计算失败: ${error.message}`);
    }
  }

  /**
   * 计算所有哈希（推荐用于索引）
   * @param {string|Buffer} input - 图片路径或 Buffer
   * @returns {Promise<Object>} 所有哈希值
   */
  async calculateAllHashes(input) {
    try {
      const [phash, dhash, ahash] = await Promise.all([
        this.calculatePHash(input),
        this.calculateDHash(input),
        this.calculateAHash(input)
      ]);
      
      return {
        phash,
        dhash,
        ahash,
        algorithm: 'pHash+dHash+aHash',
        hashSize: this.hashSize,
        hashBits: this.hashBits
      };
      
    } catch (error) {
      logger.error('计算哈希失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 计算汉明距离（两个哈希的差异度）
   * @param {string} hash1 - 十六进制哈希1
   * @param {string} hash2 - 十六进制哈希2
   * @returns {number} 汉明距离 (0-64)
   */
  hammingDistance(hash1, hash2) {
    if (!hash1 || !hash2) {
      throw new Error('哈希值不能为空');
    }
    
    if (hash1.length !== hash2.length) {
      throw new Error(`哈希长度不一致: ${hash1.length} vs ${hash2.length}`);
    }
    
    let distance = 0;
    
    for (let i = 0; i < hash1.length; i++) {
      const byte1 = parseInt(hash1[i], 16);
      const byte2 = parseInt(hash2[i], 16);
      
      // XOR 后统计1的个数
      let xor = byte1 ^ byte2;
      while (xor > 0) {
        distance += xor & 1;
        xor >>= 1;
      }
    }
    
    return distance;
  }

  /**
   * 计算相似度（0-1，1表示完全相同）
   * @param {string} hash1 - 哈希1
   * @param {string} hash2 - 哈希2
   * @returns {number} 相似度 (0-1)
   */
  similarity(hash1, hash2) {
    const distance = this.hammingDistance(hash1, hash2);
    return 1 - (distance / this.hashBits);
  }

  /**
   * 判断相似度等级
   * @param {number} distance - 汉明距离
   * @returns {string} 相似度等级
   */
  getSimilarityLevel(distance) {
    if (distance === this.THRESHOLDS.IDENTICAL) {
      return 'identical';
    } else if (distance <= this.THRESHOLDS.VERY_SIMILAR) {
      return 'very_similar';
    } else if (distance <= this.THRESHOLDS.SIMILAR) {
      return 'similar';
    } else if (distance <= this.THRESHOLDS.SOMEWHAT_SIMILAR) {
      return 'somewhat_similar';
    } else {
      return 'different';
    }
  }

  /**
   * 批量比较图片与哈希列表
   * @param {string} targetHash - 目标图片哈希
   * @param {Array} hashList - 哈希列表 [{id, hash}, ...]
   * @param {number} threshold - 相似度阈值（汉明距离）
   * @returns {Array} 相似的图片列表，按相似度排序
   */
  findSimilarHashes(targetHash, hashList, threshold = 10) {
    const results = [];
    
    for (const item of hashList) {
      const distance = this.hammingDistance(targetHash, item.hash);
      
      if (distance <= threshold) {
        results.push({
          ...item,
          hammingDistance: distance,
          similarity: this.similarity(targetHash, item.hash),
          level: this.getSimilarityLevel(distance)
        });
      }
    }
    
    // 按汉明距离排序（越小越相似）
    results.sort((a, b) => a.hammingDistance - b.hammingDistance);
    
    return results;
  }

  /**
   * 计算图片的唯一指纹（MD5 哈希）
   * 用于精确匹配完全相同的图片文件
   * @param {string|Buffer} input - 图片路径或 Buffer
   * @returns {Promise<string>} MD5 哈希
   */
  async calculateMD5(input) {
    try {
      let buffer;
      if (typeof input === 'string') {
        const image = await Jimp.read(input);
        buffer = await image.getBufferAsync(Jimp.MIME_PNG);
      } else {
        buffer = input;
      }
      
      const hash = crypto.createHash('md5');
      hash.update(buffer);
      return hash.digest('hex');
      
    } catch (error) {
      logger.error('MD5 计算失败', { error: error.message });
      throw new Error(`MD5 计算失败: ${error.message}`);
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 计算 DCT（离散余弦变换）
   * @param {Array<Array<number>>} matrix - 像素矩阵
   * @returns {Array<Array<number>>} DCT 系数矩阵
   */
  computeDCT(matrix) {
    const N = matrix.length;
    const dct = Array(N).fill(0).map(() => Array(N).fill(0));
    
    for (let u = 0; u < N; u++) {
      for (let v = 0; v < N; v++) {
        let sum = 0;
        
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            sum += matrix[i][j] * 
                   Math.cos((Math.PI * (2 * i + 1) * u) / (2 * N)) *
                   Math.cos((Math.PI * (2 * j + 1) * v) / (2 * N));
          }
        }
        
        const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
        const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
        
        dct[u][v] = (2 / N) * cu * cv * sum;
      }
    }
    
    return dct;
  }

  /**
   * 二进制字符串转十六进制
   * @param {string} binary - 二进制字符串
   * @returns {string} 十六进制字符串
   */
  binaryToHex(binary) {
    let hex = '';
    for (let i = 0; i < binary.length; i += 4) {
      const chunk = binary.substr(i, 4);
      hex += parseInt(chunk, 2).toString(16);
    }
    return hex;
  }

  /**
   * 十六进制转二进制字符串
   * @param {string} hex - 十六进制字符串
   * @returns {string} 二进制字符串
   */
  hexToBinary(hex) {
    let binary = '';
    for (let i = 0; i < hex.length; i++) {
      binary += parseInt(hex[i], 16).toString(2).padStart(4, '0');
    }
    return binary;
  }
}

// 创建单例
const imageHashService = new ImageHashService();

export default imageHashService;
