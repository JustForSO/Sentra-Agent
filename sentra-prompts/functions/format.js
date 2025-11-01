/**
 * 格式化相关函数模块
 * 提供各种数据格式化功能
 */

/**
 * 格式化日期（YYYY-MM-DD）
 * @returns {string} 格式化的日期
 */
export function formatDateYMD() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化日期（DD/MM/YYYY）
 * @returns {string} 格式化的日期
 */
export function formatDateDMY() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${day}/${month}/${year}`;
}

/**
 * 格式化日期（MM/DD/YYYY）
 * @returns {string} 格式化的日期
 */
export function formatDateMDY() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${month}/${day}/${year}`;
}

/**
 * 格式化时间（24小时制）
 * @returns {string} 格式化的时间
 */
export function formatTime24() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * 格式化时间（12小时制）
 * @returns {string} 格式化的时间
 */
export function formatTime12() {
  const now = new Date();
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}

/**
 * 格式化日期时间
 * @returns {string} 格式化的日期时间
 */
export function formatDateTime() {
  const now = new Date();
  return `${formatDateYMD()} ${formatTime24()}`;
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化的文件大小
 */
export function formatFileSize(bytes = 0) {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * 格式化持续时间（秒转为可读格式）
 * @param {number} seconds - 秒数
 * @returns {string} 格式化的持续时间
 */
export function formatDuration(seconds = 0) {
  if (seconds < 60) {
    return `${seconds}秒`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}分${secs}秒`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${minutes}分`;
  } else {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return `${days}天${hours}小时`;
  }
}

/**
 * 格式化JSON（美化）
 * @param {any} obj - 对象
 * @returns {string} 格式化的JSON字符串
 */
export function formatJSON(obj) {
  return JSON.stringify(obj, null, 2);
}

/**
 * 格式化电话号码（中国）
 * @param {string} phone - 电话号码
 * @returns {string} 格式化的电话号码
 */
export function formatPhoneCN(phone = '') {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  }
  return phone;
}

/**
 * 格式化相对时间
 * @param {Date} date - 日期对象
 * @returns {string} 相对时间描述
 */
export function formatRelativeTime(date = new Date()) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  
  if (seconds < 60) {
    return '刚刚';
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}分钟前`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours}小时前`;
  } else if (seconds < 2592000) {
    const days = Math.floor(seconds / 86400);
    return `${days}天前`;
  } else if (seconds < 31536000) {
    const months = Math.floor(seconds / 2592000);
    return `${months}个月前`;
  } else {
    const years = Math.floor(seconds / 31536000);
    return `${years}年前`;
  }
}

/**
 * 格式化为中文数字
 * @param {number} num - 数字
 * @returns {string} 中文数字
 */
export function formatChineseNumber(num = 0) {
  const units = ['', '十', '百', '千', '万', '十万', '百万', '千万', '亿'];
  const chars = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  
  if (num === 0) return '零';
  if (num < 10) return chars[num];
  
  // 简单实现，仅支持0-9999
  if (num < 10000) {
    const str = String(num);
    let result = '';
    const len = str.length;
    
    for (let i = 0; i < len; i++) {
      const digit = parseInt(str[i]);
      const unit = len - i - 1;
      
      if (digit !== 0) {
        result += chars[digit] + (unit > 0 ? units[unit] : '');
      } else if (result && !result.endsWith('零')) {
        result += '零';
      }
    }
    
    return result.replace(/零+$/, '');
  }
  
  return String(num);
}
