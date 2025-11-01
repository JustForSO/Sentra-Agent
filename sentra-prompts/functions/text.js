/**
 * 文本处理相关函数模块
 * 提供字符串处理、格式化等功能
 */

import crypto from 'crypto';

/**
 * 生成UUID
 * @returns {string} UUID字符串
 */
export function generateUUID() {
  return crypto.randomUUID();
}

/**
 * 生成随机字符串
 * @param {number} length - 字符串长度
 * @returns {string} 随机字符串
 */
export function generateRandomString(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 生成随机数字
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 随机数
 */
export function generateRandomNumber(min = 0, max = 100) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 生成MD5哈希
 * @param {string} text - 要哈希的文本
 * @returns {string} MD5哈希值
 */
export function generateMD5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

/**
 * 生成SHA256哈希
 * @param {string} text - 要哈希的文本
 * @returns {string} SHA256哈希值
 */
export function generateSHA256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * 转换为大写
 * @param {string} text - 输入文本
 * @returns {string} 大写文本
 */
export function toUpperCase(text = '') {
  return text.toUpperCase();
}

/**
 * 转换为小写
 * @param {string} text - 输入文本
 * @returns {string} 小写文本
 */
export function toLowerCase(text = '') {
  return text.toLowerCase();
}

/**
 * 转换为标题格式（首字母大写）
 * @param {string} text - 输入文本
 * @returns {string} 标题格式文本
 */
export function toTitleCase(text = '') {
  return text.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

/**
 * 获取文本长度
 * @param {string} text - 输入文本
 * @returns {number} 文本长度
 */
export function getTextLength(text = '') {
  return text.length;
}

/**
 * 截取文本
 * @param {string} text - 输入文本
 * @param {number} maxLength - 最大长度
 * @param {string} suffix - 后缀（如...）
 * @returns {string} 截取后的文本
 */
export function truncateText(text = '', maxLength = 50, suffix = '...') {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + suffix;
}

/**
 * 移除空白字符
 * @param {string} text - 输入文本
 * @returns {string} 移除空白后的文本
 */
export function trimText(text = '') {
  return text.trim();
}

/**
 * 反转字符串
 * @param {string} text - 输入文本
 * @returns {string} 反转后的文本
 */
export function reverseText(text = '') {
  return text.split('').reverse().join('');
}

/**
 * 统计单词数量
 * @param {string} text - 输入文本
 * @returns {number} 单词数量
 */
export function countWords(text = '') {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * 统计字符数量（不包括空格）
 * @param {string} text - 输入文本
 * @returns {number} 字符数量
 */
export function countCharacters(text = '') {
  return text.replace(/\s/g, '').length;
}

/**
 * 替换文本
 * @param {string} text - 输入文本
 * @param {string} search - 搜索字符串
 * @param {string} replace - 替换字符串
 * @returns {string} 替换后的文本
 */
export function replaceText(text = '', search = '', replace = '') {
  return text.split(search).join(replace);
}
