/**
 * 占位符解析器
 * 负责解析模板字符串中的占位符 {{placeholder}} 并替换为实际值
 */

import { loadEnvConfig } from './config.js';
import { getFunctionRegistry } from './functions/registry.js';

/**
 * 解析模板字符串，替换所有占位符
 * @param {string} template - 包含占位符的模板字符串
 * @param {Object} envConfig - 环境变量配置对象
 * @param {Object} functionRegistry - 函数注册表
 * @returns {string} 解析后的字符串
 */
export async function parseTemplate(template, envConfig = null, functionRegistry = null) {
  if (typeof template !== 'string') {
    return template;
  }

  // 如果没有传入配置，则加载默认配置
  if (!envConfig) {
    envConfig = loadEnvConfig();
  }

  if (!functionRegistry) {
    functionRegistry = getFunctionRegistry();
  }

  // 匹配所有 {{placeholder}} 格式的占位符
  const placeholderRegex = /\{\{(\w+)\}\}/g;
  
  // 收集所有需要解析的占位符
  const placeholders = [];
  let match;
  while ((match = placeholderRegex.exec(template)) !== null) {
    placeholders.push(match[1]);
  }

  // 解析每个占位符的值
  const values = {};
  for (const placeholder of placeholders) {
    values[placeholder] = await resolvePlaceholder(placeholder, envConfig, functionRegistry);
  }

  // 替换模板中的所有占位符
  let result = template;
  for (const [placeholder, value] of Object.entries(values)) {
    const regex = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }

  return result;
}

/**
 * 解析单个占位符的值
 * @param {string} placeholder - 占位符名称
 * @param {Object} envConfig - 环境变量配置
 * @param {Object} functionRegistry - 函数注册表
 * @returns {string} 解析后的值
 */
async function resolvePlaceholder(placeholder, envConfig, functionRegistry) {
  // 检查环境变量配置中是否定义了该占位符
  if (!(placeholder in envConfig)) {
    console.warn(`警告: 占位符 {{${placeholder}}} 未在 .env 文件中定义`);
    return `{{${placeholder}}}`;
  }

  const configValue = envConfig[placeholder];

  // 如果配置值是一个函数名，则尝试执行该函数
  if (functionRegistry && typeof functionRegistry[configValue] === 'function') {
    try {
      const result = await functionRegistry[configValue]();
      return String(result);
    } catch (error) {
      console.error(`错误: 执行函数 ${configValue} 时出错:`, error.message);
      return `[Error: ${configValue}]`;
    }
  }

  // 否则直接返回配置值（静态值）
  return String(configValue);
}

/**
 * 递归解析对象中的所有字符串值
 * @param {any} obj - 要解析的对象
 * @param {Object} envConfig - 环境变量配置
 * @param {Object} functionRegistry - 函数注册表
 * @returns {any} 解析后的对象
 */
export async function parseObject(obj, envConfig = null, functionRegistry = null) {
  if (!envConfig) {
    envConfig = loadEnvConfig();
  }

  if (!functionRegistry) {
    functionRegistry = getFunctionRegistry();
  }

  if (typeof obj === 'string') {
    return await parseTemplate(obj, envConfig, functionRegistry);
  }

  if (Array.isArray(obj)) {
    return await Promise.all(
      obj.map(item => parseObject(item, envConfig, functionRegistry))
    );
  }

  if (obj !== null && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = await parseObject(value, envConfig, functionRegistry);
    }
    return result;
  }

  return obj;
}

/**
 * 批量解析多个模板
 * @param {string[]} templates - 模板数组
 * @param {Object} envConfig - 环境变量配置
 * @param {Object} functionRegistry - 函数注册表
 * @returns {string[]} 解析后的字符串数组
 */
export async function parseTemplates(templates, envConfig = null, functionRegistry = null) {
  if (!Array.isArray(templates)) {
    throw new Error('parseTemplates 需要数组参数');
  }

  if (!envConfig) {
    envConfig = loadEnvConfig();
  }

  if (!functionRegistry) {
    functionRegistry = getFunctionRegistry();
  }

  return await Promise.all(
    templates.map(template => parseTemplate(template, envConfig, functionRegistry))
  );
}