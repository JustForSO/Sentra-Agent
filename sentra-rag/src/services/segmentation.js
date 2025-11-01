import Segment from 'segment';
import natural from 'natural';

// 初始化分词器
const chineseSegment = new Segment();
chineseSegment.useDefault();

/**
 * 独立的分词工具类
 * 提供中英混合文本的分词功能
 */
class TextSegmentation {
  constructor() {
    this.chineseSegment = chineseSegment;
    this.englishTokenizer = new natural.WordTokenizer();
  }

  /**
   * 检测文本语言 - 修正版
   * @param {string} text 文本内容
   * @returns {string} 语言代码 ('zh' | 'en' | 'mixed')
   */
  detectLanguage(text) {
    // 统计中文字符、英文字符数量
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length;

    if (chineseChars > 0 && englishChars > 0) {
      return 'mixed'; // 混合文本
    } else if (chineseChars > 0) {
      return 'zh'; // 纯中文
    } else if (englishChars > 0) {
      return 'en'; // 纯英文
    } else {
      return 'en'; // 默认为英文
    }
  }

  /**
   * 检测文本中的语言块
   * @param {string} text 文本内容
   * @returns {Array} 语言块数组，每个元素包含文本和语言类型
   */
  detectLanguageBlocks(text) {
    const blocks = [];
    let currentBlock = '';
    let currentLang = null;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const isChinese = /[\u4e00-\u9fff]/.test(char);
      const isEnglish = /[a-zA-Z]/.test(char);

      if (isChinese || isEnglish) {
        let charLang = 'other';
        if (isChinese) charLang = 'zh';
        else if (isEnglish) charLang = 'en';

        if (currentLang === null) {
          currentLang = charLang;
        }

        if (currentLang === charLang) {
          currentBlock += char;
        } else {
          // 语言发生变化，保存当前块
          if (currentBlock) {
            blocks.push({
              text: currentBlock,
              language: currentLang
            });
          }
          currentBlock = char;
          currentLang = charLang;
        }
      } else {
        // 遇到标点符号或其他字符
        if (currentBlock) {
          blocks.push({
            text: currentBlock,
            language: currentLang
          });
          currentBlock = '';
          currentLang = null;
        }
        // 保留标点符号
        blocks.push({
          text: char,
          language: 'punctuation'
        });
      }
    }

    // 处理最后一个块
    if (currentBlock) {
      blocks.push({
        text: currentBlock,
        language: currentLang
      });
    }

    return blocks;
  }

  /**
   * 中文分词
   * @param {string} text 中文文本
   * @returns {Array} 分词结果数组
   */
  segmentChinese(text) {
    try {
      return this.chineseSegment.doSegment(text, {
        simple: true,  // 使用简化模式
        stripPunctuation: false  // 保留标点符号
      });
    } catch (error) {
      console.warn('中文分词失败，使用原始文本:', error.message);
      return [text]; // 返回原始文本作为单个token
    }
  }

  /**
   * 英文分词
   * @param {string} text 英文文本
   * @returns {Array} 分词结果数组
   */
  segmentEnglish(text) {
    try {
      return this.englishTokenizer.tokenize(text) || [text];
    } catch (error) {
      console.warn('英文分词失败，使用原始文本:', error.message);
      return [text];
    }
  }

  /**
   * 智能分词 - 中英分别处理
   * @param {string} text 文本内容
   * @param {Object} options 分词选项
   * @returns {Array} 分词结果数组
   */
  segment(text, options = {}) {
    const { useSegmentation = true } = options;

    if (!useSegmentation) {
      return [text]; // 不使用分词，直接返回原始文本
    }

    const language = this.detectLanguage(text);

    // 根据语言类型选择分词策略
    if (language === 'mixed') {
      // 混合文本使用高级分词（按语言块分别处理）
      return this.segmentAdvanced(text, options);
    } else if (language === 'zh') {
      // 纯中文使用中文分词
      return this.segmentChinese(text);
    } else {
      // 纯英文或其他语言使用英文分词
      return this.segmentEnglish(text);
    }
  }

  /**
   * 高级分词 - 基于语言块分别处理
   * @param {string} text 文本内容
   * @param {Object} options 分词选项
   * @returns {Array} 分词结果数组
   */
  segmentAdvanced(text, options = {}) {
    const { useSegmentation = true } = options;

    if (!useSegmentation) {
      return [text];
    }

    const blocks = this.detectLanguageBlocks(text);
    const segments = [];

    for (const block of blocks) {
      if (block.language === 'zh') {
        segments.push(...this.segmentChinese(block.text));
      } else if (block.language === 'en') {
        segments.push(...this.segmentEnglish(block.text));
      } else {
        // 标点符号或其他字符直接添加
        segments.push(block.text);
      }
    }

    return segments;
  }

  /**
   * 获取分词统计信息
   * @param {string} text 文本内容
   * @param {Object} options 分词选项
   * @returns {Object} 统计信息
   */
  getSegmentationStats(text, options = {}) {
    const language = this.detectLanguage(text);
    const segments = this.segment(text, options);

    // 详细的语言块分析
    const blocks = this.detectLanguageBlocks(text);

    return {
      originalText: text,
      primaryLanguage: language,
      segmentCount: segments.length,
      segments: segments,
      totalLength: text.length,
      averageSegmentLength: segments.length > 0 ? text.length / segments.length : 0,
      languageBlocks: blocks
    };
  }

  /**
   * 分析文本语言分布
   * @param {string} text 文本内容
   * @returns {Object} 语言分布统计
   */
  analyzeLanguageDistribution(text) {
    const blocks = this.detectLanguageBlocks(text);

    const stats = {
      total: text.length,
      chinese: 0,
      english: 0,
      punctuation: 0,
      other: 0,
      blocks: blocks
    };

    for (const block of blocks) {
      switch (block.language) {
        case 'zh':
          stats.chinese += block.text.length;
          break;
        case 'en':
          stats.english += block.text.length;
          break;
        case 'punctuation':
          stats.punctuation += block.text.length;
          break;
        default:
          stats.other += block.text.length;
      }
    }

    return {
      ...stats,
      chineseRatio: stats.chinese / stats.total,
      englishRatio: stats.english / stats.total,
      punctuationRatio: stats.punctuation / stats.total,
      otherRatio: stats.other / stats.total
    };
  }
}

// 导出默认实例
export const textSegmentation = new TextSegmentation();
