import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

/**
 * 从环境变量获取配置
 * @returns {Object} 配置对象
 */
export const getConfigFromEnv = () => ({
  apiBaseUrl: process.env.API_BASE_URL || 'https://yuanplus.cloud/v1/',
  apiKey: process.env.API_KEY || 'sk-ZsC6m89ewvSfx29HqOIEVBPCZOCrhjO0dv3ZhYEmCBl9ijzz',
  modelName: process.env.MODEL_NAME || 'gpt-4o-mini',
  temperature: parseFloat(process.env.TEMPERATURE) || 0.7,
  maxTokens: parseInt(process.env.MAX_TOKENS) || 1000,
  maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
  timeout: parseInt(process.env.TIMEOUT) || 60000
});

/**
 * 配置类
 */
export class Config {
  constructor(config = {}) {
    const defaultConfig = getConfigFromEnv();
    const finalConfig = { ...defaultConfig, ...config };

    this.apiBaseUrl = finalConfig.apiBaseUrl;
    this.apiKey = finalConfig.apiKey;
    this.modelName = finalConfig.modelName;
    this.temperature = finalConfig.temperature;
    this.maxTokens = finalConfig.maxTokens;
    this.maxRetries = finalConfig.maxRetries;
    this.timeout = finalConfig.timeout;
  }

  /**
   * 获取默认配置
   * @returns {Config} 默认配置实例
   */
  static getDefault() {
    return new Config();
  }

  /**
   * 创建自定义配置
   * @param {Object} config 自定义配置
   * @returns {Config} 配置实例
   */
  static create(config = {}) {
    return new Config(config);
  }

  /**
   * 验证配置
   * @returns {boolean} 配置是否有效
   */
  isValid() {
    return !!(this.apiKey && this.modelName && this.apiBaseUrl);
  }
}

// 导出默认配置实例
export const defaultConfig = getConfigFromEnv();

