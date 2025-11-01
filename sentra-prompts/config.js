/**
 * 配置加载模块
 * 负责加载和解析 .env 文件配置
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 加载 .env 文件配置
 * @param {string} envPath - .env 文件路径
 * @returns {Object} 配置对象
 */
export function loadEnvConfig(envPath = null) {
  if (!envPath) {
    envPath = path.join(__dirname, '.env');
  }

  if (!fs.existsSync(envPath)) {
    console.warn(`警告: 配置文件 ${envPath} 不存在`);
    return {};
  }

  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    return parseEnvContent(content);
  } catch (error) {
    console.error(`错误: 读取配置文件失败:`, error.message);
    return {};
  }
}

/**
 * 解析 .env 文件内容
 * @param {string} content - .env 文件内容
 * @returns {Object} 配置对象
 */
function parseEnvContent(content) {
  const config = {};
  const lines = content.split('\n');

  for (const line of lines) {
    // 跳过空行和注释
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    // 解析 KEY=VALUE 格式
    const equalIndex = trimmedLine.indexOf('=');
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmedLine.substring(0, equalIndex).trim();
    const value = trimmedLine.substring(equalIndex + 1).trim();

    if (key) {
      config[key] = value;
    }
  }

  return config;
}

/**
 * 加载 JSON 配置文件
 * @param {string} jsonPath - JSON 文件路径
 * @returns {Object} 配置对象
 */
export function loadJsonConfig(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`配置文件 ${jsonPath} 不存在`);
  }

  try {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`解析 JSON 配置文件失败: ${error.message}`);
  }
}

/**
 * 保存配置到 JSON 文件
 * @param {string} jsonPath - JSON 文件路径
 * @param {Object} config - 配置对象
 */
export function saveJsonConfig(jsonPath, config) {
  try {
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(jsonPath, content, 'utf-8');
  } catch (error) {
    throw new Error(`保存 JSON 配置文件失败: ${error.message}`);
  }
}

/**
 * 获取所有可用的占位符列表
 * @returns {string[]} 占位符名称数组
 */
export function getAvailablePlaceholders() {
  const config = loadEnvConfig();
  return Object.keys(config);
}
