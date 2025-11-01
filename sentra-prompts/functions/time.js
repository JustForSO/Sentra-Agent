/**
 * 时间相关函数模块
 * 提供各种时间格式化和获取功能
 */

/**
 * 获取当前时间（格式：HH:MM:SS）
 * @returns {string} 当前时间
 */
export function getCurrentTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * 获取当前日期（格式：YYYY年MM月DD日）
 * @returns {string} 当前日期
 */
export function getCurrentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}年${month}月${day}日`;
}

/**
 * 获取当前是星期几
 * @returns {string} 星期
 */
export function getWeekday() {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const now = new Date();
  return weekdays[now.getDay()];
}

/**
 * 获取ISO格式时间
 * @returns {string} ISO时间字符串
 */
export function getISOTime() {
  return new Date().toISOString();
}

/**
 * 获取时区信息
 * @returns {string} 时区信息
 */
export function getTimezone() {
  const offset = -new Date().getTimezoneOffset() / 60;
  const sign = offset >= 0 ? '+' : '-';
  return `UTC${sign}${Math.abs(offset)}`;
}

/**
 * 获取Unix时间戳
 * @returns {number} 时间戳（秒）
 */
export function getTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 获取Unix时间戳（毫秒）
 * @returns {number} 时间戳（毫秒）
 */
export function getTimestampMs() {
  return Date.now();
}

/**
 * 获取当前小时
 * @returns {number} 当前小时（0-23）
 */
export function getCurrentHour() {
  return new Date().getHours();
}

/**
 * 获取当前分钟
 * @returns {number} 当前分钟（0-59）
 */
export function getCurrentMinute() {
  return new Date().getMinutes();
}

/**
 * 获取时间段问候语
 * @returns {string} 问候语
 */
export function getGreeting() {
  const hour = getCurrentHour();
  
  if (hour >= 5 && hour < 9) {
    return '早上好';
  } else if (hour >= 9 && hour < 12) {
    return '上午好';
  } else if (hour >= 12 && hour < 14) {
    return '中午好';
  } else if (hour >= 14 && hour < 18) {
    return '下午好';
  } else if (hour >= 18 && hour < 22) {
    return '晚上好';
  } else {
    return '夜深了';
  }
}

/**
 * 获取年份
 * @returns {number} 当前年份
 */
export function getYear() {
  return new Date().getFullYear();
}

/**
 * 获取月份
 * @returns {number} 当前月份（1-12）
 */
export function getMonth() {
  return new Date().getMonth() + 1;
}

/**
 * 获取日期（几号）
 * @returns {number} 当前日期（1-31）
 */
export function getDay() {
  return new Date().getDate();
}
