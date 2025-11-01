/**
 * 日常交流相关函数模块
 * 提供实用的日常对话、时间计算等动态函数
 */

import { Solar } from 'lunar-javascript';

/**
 * 获取当前时间段（凌晨/早上/上午/中午/下午/傍晚/晚上/深夜）
 * @returns {string} 时间段描述
 */
export function getTimeContext() {
  const hour = new Date().getHours();
  
  if (hour >= 0 && hour < 5) return '凌晨';
  if (hour >= 5 && hour < 8) return '早上';
  if (hour >= 8 && hour < 11) return '上午';
  if (hour >= 11 && hour < 13) return '中午';
  if (hour >= 13 && hour < 17) return '下午';
  if (hour >= 17 && hour < 19) return '傍晚';
  if (hour >= 19 && hour < 23) return '晚上';
  return '深夜';
}

/**
 * 获取当前季节
 * @returns {string} 季节名称
 */
export function getCurrentSeason() {
  const month = new Date().getMonth() + 1;
  
  if (month >= 3 && month <= 5) return '春季';
  if (month >= 6 && month <= 8) return '夏季';
  if (month >= 9 && month <= 11) return '秋季';
  return '冬季';
}

/**
 * 获取本周是今年的第几周
 * @returns {number} 周数
 */
export function getWeekOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  const oneWeek = 1000 * 60 * 60 * 24 * 7;
  return Math.ceil(diff / oneWeek);
}

/**
 * 获取今天是今年的第几天
 * @returns {number} 天数
 */
export function getDayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * 获取本月剩余天数
 * @returns {number} 剩余天数
 */
export function getRemainingDaysInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.getDate() - now.getDate();
}

/**
 * 获取本年剩余天数
 * @returns {number} 剩余天数
 */
export function getRemainingDaysInYear() {
  const now = new Date();
  const endOfYear = new Date(now.getFullYear(), 11, 31);
  const diff = endOfYear - now;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.ceil(diff / oneDay);
}

/**
 * 判断是否是月初（1-5号）
 * @returns {boolean} 是否是月初
 */
export function isMonthStart() {
  const day = new Date().getDate();
  return day <= 5;
}

/**
 * 判断是否是月末（最后5天）
 * @returns {boolean} 是否是月末
 */
export function isMonthEnd() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const currentDay = now.getDate();
  return currentDay >= lastDay - 4;
}

/**
 * 判断是否是年初（1-2月）
 * @returns {boolean} 是否是年初
 */
export function isYearStart() {
  const month = new Date().getMonth() + 1;
  return month <= 2;
}

/**
 * 判断是否是年末（11-12月）
 * @returns {boolean} 是否是年末
 */
export function isYearEnd() {
  const month = new Date().getMonth() + 1;
  return month >= 11;
}

/**
 * 距离周末还有几天
 * @returns {number} 天数
 */
export function getDaysUntilWeekend() {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return 0; // 已经是周末
  return 6 - day; // 距离周六的天数
}

/**
 * 距离下周一还有几天
 * @returns {number} 天数
 */
export function getDaysUntilMonday() {
  const day = new Date().getDay();
  if (day === 1) return 0; // 已经是周一
  if (day === 0) return 1; // 周日到周一1天
  return 8 - day; // 其他日子到下周一的天数
}

/**
 * 获取当月总天数
 * @returns {number} 天数
 */
export function getDaysInMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

/**
 * 判断今年是否是闰年
 * @returns {boolean} 是否是闰年
 */
export function isLeapYear() {
  const year = new Date().getFullYear();
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * 获取距离今天指定天数后的日期
 * @param {number} days - 天数（默认7天）
 * @returns {string} 日期字符串
 */
export function getDateAfterDays(days = 7) {
  const future = new Date();
  future.setDate(future.getDate() + days);
  const year = future.getFullYear();
  const month = String(future.getMonth() + 1).padStart(2, '0');
  const day = String(future.getDate()).padStart(2, '0');
  return `${year}年${month}月${day}日`;
}

/**
 * 获取距离今天指定天数前的日期
 * @param {number} days - 天数（默认7天）
 * @returns {string} 日期字符串
 */
export function getDateBeforeDays(days = 7) {
  const past = new Date();
  past.setDate(past.getDate() - days);
  const year = past.getFullYear();
  const month = String(past.getMonth() + 1).padStart(2, '0');
  const day = String(past.getDate()).padStart(2, '0');
  return `${year}年${month}月${day}日`;
}

/**
 * 获取本月第一天
 * @returns {string} 日期字符串
 */
export function getFirstDayOfMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}年${month}月01日`;
}

/**
 * 获取本月最后一天
 * @returns {string} 日期字符串
 */
export function getLastDayOfMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const year = lastDay.getFullYear();
  const month = String(lastDay.getMonth() + 1).padStart(2, '0');
  const day = String(lastDay.getDate()).padStart(2, '0');
  return `${year}年${month}月${day}日`;
}

/**
 * 获取上个月名称
 * @returns {string} 月份
 */
export function getLastMonth() {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  if (month === 0) return '12月';
  return `${month}月`;
}

/**
 * 获取下个月名称
 * @returns {string} 月份
 */
export function getNextMonth() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  if (month === 12) return '1月';
  return `${month + 1}月`;
}

/**
 * 获取本季度
 * @returns {string} 季度
 */
export function getCurrentQuarter() {
  const month = new Date().getMonth() + 1;
  return `第${Math.ceil(month / 3)}季度`;
}

/**
 * 获取距离某个特定日期的天数
 * 默认计算距离今年年底的天数
 * @returns {number} 天数
 */
export function getDaysUntilYearEnd() {
  const now = new Date();
  const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  const diff = yearEnd - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * 获取昨天的日期
 * @returns {string} 日期字符串
 */
export function getYesterday() {
  return getDateBeforeDays(1);
}

/**
 * 获取明天的日期
 * @returns {string} 日期字符串
 */
export function getTomorrow() {
  return getDateAfterDays(1);
}

/**
 * 获取本周的第几天
 * @returns {number} 1-7（周一到周日）
 */
export function getDayOfWeek() {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

/**
 * 判断当前是否是工作时间（周一到周五的9:00-18:00）
 * @returns {boolean} 是否是工作时间
 */
export function isWorkingHours() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  
  // 周末
  if (day === 0 || day === 6) return false;
  
  // 工作时间
  return hour >= 9 && hour < 18;
}

/**
 * 判断当前是否是休息时间
 * @returns {boolean} 是否是休息时间
 */
export function isRestTime() {
  return !isWorkingHours();
}

/**
 * 获取当前时刻的Unix时间戳（秒）
 * @returns {number} 时间戳
 */
export function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 获取今年已经过去了百分之多少
 * @returns {string} 百分比字符串
 */
export function getYearProgress() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  
  const total = end - start;
  const passed = now - start;
  const percentage = (passed / total * 100).toFixed(2);
  
  return `${percentage}%`;
}

/**
 * 获取本月已经过去了百分之多少
 * @returns {string} 百分比字符串
 */
export function getMonthProgress() {
  const now = new Date();
  const currentDay = now.getDate();
  const totalDays = getDaysInMonth();
  const percentage = (currentDay / totalDays * 100).toFixed(2);
  
  return `${percentage}%`;
}

/**
 * 获取今天已经过去了百分之多少
 * @returns {string} 百分比字符串
 */
export function getDayProgress() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  const percentage = (totalMinutes / 1440 * 100).toFixed(2);
  
  return `${percentage}%`;
}
