import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getConfigFromEnv } from './config.js';

/**
 * LLM翻译工具类
 * 支持多语言到英文的翻译功能
 */
export class Translator {
  constructor(config = {}) {
    const defaultConfig = getConfigFromEnv();
    const finalConfig = { ...defaultConfig, ...config };

    this.llm = new ChatOpenAI({
      openAIApiKey: finalConfig.apiKey,
      modelName: finalConfig.modelName,
      temperature: finalConfig.temperature,
      maxTokens: finalConfig.maxTokens,
      timeout: finalConfig.timeout,
      maxRetries: finalConfig.maxRetries,
      configuration: {
        baseURL: finalConfig.apiBaseUrl
      }
    });
  }

  /**
   * 智能翻译 - 自动检测源语言并翻译为英文
   * @param {string} text 要翻译的文本
   * @param {Object} options 翻译选项
   * @returns {Promise<string>} 翻译后的英文文本
   */
  async smartTranslate(text, options = {}) {
    const { context = '', preserveFormat = false } = options;

    try {
      const systemPrompt = `你是一个专业的翻译助手。请将用户提供的文本翻译成英文。
${context ? `翻译上下文：${context}` : ''}
${preserveFormat ? '请保持原文的格式和结构。' : ''}
请只返回翻译后的英文文本，不要添加任何解释或注释。`;

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(text)
      ];

      const response = await this.llm.invoke(messages);
      return response.content.trim();
    } catch (error) {
      console.error('智能翻译失败:', error);
      throw new Error(`智能翻译失败: ${error.message}`);
    }
  }

  /**
   * 指定源语言翻译为英文
   * @param {string} text 要翻译的文本
   * @param {Object} options 翻译选项
   * @returns {Promise<string>} 翻译后的英文文本
   */
  async translateToEnglish(text, options = {}) {
    const {
      sourceLanguage = 'auto',
      context = '',
      preserveFormat = false
    } = options;

    try {
      let languageHint = '';
      if (sourceLanguage !== 'auto') {
        languageHint = `源语言是${this.getLanguageName(sourceLanguage)}。`;
      }

      const systemPrompt = `你是一个专业的翻译助手。请将用户提供的文本从${languageHint}翻译成英文。
${context ? `翻译上下文：${context}` : ''}
${preserveFormat ? '请保持原文的格式和结构。' : ''}
请只返回翻译后的英文文本，不要添加任何解释或注释。`;

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(text)
      ];

      const response = await this.llm.invoke(messages);
      return response.content.trim();
    } catch (error) {
      console.error('翻译失败:', error);
      throw new Error(`翻译失败: ${error.message}`);
    }
  }

  /**
   * 保持格式的翻译
   * @param {string} text 要翻译的文本
   * @param {Object} options 翻译选项
   * @returns {Promise<string>} 翻译后的英文文本
   */
  async translateWithFormat(text, options = {}) {
    return this.translateToEnglish(text, {
      ...options,
      preserveFormat: true
    });
  }

  /**
   * 批量翻译
   * @param {Array} texts 要翻译的文本数组
   * @param {Object} options 翻译选项
   * @returns {Promise<Array>} 翻译结果数组
   */
  async translateBatch(texts, options = {}) {
    const results = [];

    for (const text of texts) {
      try {
        const translated = await this.translateToEnglish(text, options);
        results.push({
          original: text,
          translated: translated,
          success: true
        });
      } catch (error) {
        results.push({
          original: text,
          translated: null,
          error: error.message,
          success: false
        });
      }
    }

    return results;
  }

  /**
   * 获取语言名称
   * @param {string} languageCode 语言代码
   * @returns {string} 语言名称
   */
  getLanguageName(languageCode) {
    const languageMap = {
      'zh': '中文',
      'en': '英文',
      'ja': '日文',
      'ko': '韩文',
      'fr': '法文',
      'de': '德文',
      'es': '西班牙文',
      'pt': '葡萄牙文',
      'ru': '俄文',
      'ar': '阿拉伯文',
      'hi': '印地文',
      'th': '泰文',
      'vi': '越南文',
      'it': '意大利文',
      'nl': '荷兰文',
      'sv': '瑞典文',
      'da': '丹麦文',
      'no': '挪威文',
      'fi': '芬兰文',
      'pl': '波兰文',
      'tr': '土耳其文',
      'he': '希伯来文',
      'cs': '捷克文',
      'hu': '匈牙利文',
      'ro': '罗马尼亚文',
      'bg': '保加利亚文',
      'hr': '克罗地亚文',
      'sk': '斯洛伐克文',
      'sl': '斯洛文尼亚文',
      'et': '爱沙尼亚文',
      'lv': '拉脱维亚文',
      'lt': '立陶宛文',
      'mt': '马耳他文',
      'ga': '爱尔兰文',
      'cy': '威尔士文',
      'is': '冰岛文',
      'sq': '阿尔巴尼亚文',
      'mk': '马其顿文',
      'bs': '波斯尼亚文',
      'sr': '塞尔维亚文',
      'me': '黑山文',
      'auto': '自动检测'
    };

    return languageMap[languageCode] || languageCode;
  }

  /**
   * 检测文本语言
   * @param {string} text 文本内容
   * @returns {Promise<string>} 检测到的语言代码
   */
  async detectLanguage(text) {
    try {
      const systemPrompt = '你是一个语言检测专家。请分析用户提供的文本，确定其主要语言。只返回语言代码（如：zh, en, ja, ko, fr, de, es, pt, ru, ar）。';

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(text)
      ];

      const response = await this.llm.invoke(messages);
      return response.content.trim().toLowerCase();
    } catch (error) {
      console.error('语言检测失败:', error);
      return 'unknown';
    }
  }
}

// 导出默认实例
export const translator = new Translator();