import readline from 'readline';

/**
 * 创建readline接口
 * @returns {readline.Interface} readline接口实例
 */
export function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * 格式化JSON输出
 * @param {Object} obj 要格式化的对象
 * @param {number} indent 缩进空格数
 * @returns {string} 格式化的JSON字符串
 */
export function formatJSON(obj, indent = 2) {
  return JSON.stringify(obj, null, indent);
}

/**
 * 延迟函数
 * @param {number} ms 延迟毫秒数
 * @returns {Promise} 延迟Promise
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 生成UUID
 * @returns {string} UUID字符串
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

