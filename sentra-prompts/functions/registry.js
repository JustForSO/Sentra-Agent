/**
 * 函数注册表
 * 统一管理所有可用的动态函数
 */

// 导入时间相关函数
import {
  getCurrentTime,
  getCurrentDate,
  getWeekday,
  getISOTime,
  getTimezone,
  getTimestamp,
  getTimestampMs,
  getCurrentHour,
  getCurrentMinute,
  getGreeting,
  getYear,
  getMonth,
  getDay
} from './time.js';

// 导入节日相关函数
import {
  getHolidayInfo,
  getLunarDate,
  getZodiac,
  getGanZhi,
  isWorkday,
  isWeekend,
  getNextHoliday,
  getCurrentJieQi,
  getConstellation
} from './holiday.js';

// 导入系统信息相关函数
import {
  getSystemInfo,
  getNodeVersion,
  getOSType,
  getPlatform,
  getArchitecture,
  getHostname,
  getCPUCount,
  getTotalMemory,
  getFreeMemory,
  getSystemUptime,
  getUsername,
  getProcessId,
  getCurrentDirectory,
  // 扩展系统信息
  getGPUInfo,
  getGPUCount,
  getCPUModel,
  getCPULoad,
  getMemoryDetail,
  getDiskInfo,
  getOSVersion,
  getNetworkSummary,
  getSystemSummary,
  getFullSystemJSON
} from './system.js';

// 导入文本处理函数
import {
  generateUUID,
  generateRandomString,
  generateRandomNumber,
  generateMD5,
  generateSHA256,
  toUpperCase,
  toLowerCase,
  toTitleCase,
  getTextLength,
  truncateText,
  trimText,
  reverseText,
  countWords,
  countCharacters,
  replaceText
} from './text.js';

// 导入数学计算函数
import {
  randomInt,
  randomFloat,
  calculatePercentage,
  roundNumber,
  ceilNumber,
  floorNumber,
  absoluteValue,
  square,
  squareRoot,
  power,
  maxValue,
  minValue,
  sum,
  average,
  formatNumber,
  toCurrency,
  growthRate,
  fibonacci
} from './math.js';

// 导入格式化函数
import {
  formatDateYMD,
  formatDateDMY,
  formatDateMDY,
  formatTime24,
  formatTime12,
  formatDateTime,
  formatFileSize,
  formatDuration,
  formatJSON,
  formatPhoneCN,
  formatRelativeTime,
  formatChineseNumber
} from './format.js';

// 导入日常交流函数
import {
  getTimeContext,
  getCurrentSeason,
  getWeekOfYear,
  getDayOfYear,
  getRemainingDaysInMonth,
  getRemainingDaysInYear,
  isMonthStart,
  isMonthEnd,
  isYearStart,
  isYearEnd,
  getDaysUntilWeekend,
  getDaysUntilMonday,
  getDaysInMonth,
  isLeapYear,
  getDateAfterDays,
  getDateBeforeDays,
  getFirstDayOfMonth,
  getLastDayOfMonth,
  getLastMonth,
  getNextMonth,
  getCurrentQuarter,
  getDaysUntilYearEnd,
  getYesterday,
  getTomorrow,
  getDayOfWeek,
  isWorkingHours,
  isRestTime,
  getNowTimestamp,
  getYearProgress,
  getMonthProgress,
  getDayProgress
} from './conversation.js';

// 导入平台/外部工具相关函数
import { getMcpTools } from './mcptools.js';
import { getWeChatSystemPrompt, getQQSystemPrompt, getSandboxSystemPrompt, getSentraToolFeedbackPrompt } from './platform.js';

/**
 * 函数注册表
 * 所有可用的动态函数都在这里注册
 */
const functionRegistry = {
  // 时间相关函数
  getCurrentTime,
  getCurrentDate,
  getWeekday,
  getISOTime,
  getTimezone,
  getTimestamp,
  getTimestampMs,
  getCurrentHour,
  getCurrentMinute,
  getGreeting,
  getYear,
  getMonth,
  getDay,
  
  // 节日相关函数
  getHolidayInfo,
  getLunarDate,
  getZodiac,
  getGanZhi,
  isWorkday,
  isWeekend,
  getNextHoliday,
  getCurrentJieQi,
  getConstellation,
  
  // 系统信息相关函数
  getSystemInfo,
  getNodeVersion,
  getOSType,
  getPlatform,
  getArchitecture,
  getHostname,
  getCPUCount,
  getTotalMemory,
  getFreeMemory,
  getSystemUptime,
  getUsername,
  getProcessId,
  getCurrentDirectory,
  getGPUInfo,
  getGPUCount,
  getCPUModel,
  getCPULoad,
  getMemoryDetail,
  getDiskInfo,
  getOSVersion,
  getNetworkSummary,
  getSystemSummary,
  getFullSystemJSON,
  
  // 文本处理函数
  generateUUID,
  generateRandomString,
  generateRandomNumber,
  generateMD5,
  generateSHA256,
  toUpperCase,
  toLowerCase,
  toTitleCase,
  getTextLength,
  truncateText,
  trimText,
  reverseText,
  countWords,
  countCharacters,
  replaceText,
  
  // 数学计算函数
  randomInt,
  randomFloat,
  calculatePercentage,
  roundNumber,
  ceilNumber,
  floorNumber,
  absoluteValue,
  square,
  squareRoot,
  power,
  maxValue,
  minValue,
  sum,
  average,
  formatNumber,
  toCurrency,
  growthRate,
  fibonacci,
  
  // 格式化函数
  formatDateYMD,
  formatDateDMY,
  formatDateMDY,
  formatTime24,
  formatTime12,
  formatDateTime,
  formatFileSize,
  formatDuration,
  formatJSON,
  formatPhoneCN,
  formatRelativeTime,
  formatChineseNumber,
  
  // 日常交流函数
  getTimeContext,
  getCurrentSeason,
  getWeekOfYear,
  getDayOfYear,
  getRemainingDaysInMonth,
  getRemainingDaysInYear,
  isMonthStart,
  isMonthEnd,
  isYearStart,
  isYearEnd,
  getDaysUntilWeekend,
  getDaysUntilMonday,
  getDaysInMonth,
  isLeapYear,
  getDateAfterDays,
  getDateBeforeDays,
  getFirstDayOfMonth,
  getLastDayOfMonth,
  getLastMonth,
  getNextMonth,
  getCurrentQuarter,
  getDaysUntilYearEnd,
  getYesterday,
  getTomorrow,
  getDayOfWeek,
  isWorkingHours,
  isRestTime,
  getNowTimestamp,
  getYearProgress,
  getMonthProgress,
  getDayProgress
  ,
  
  // 平台与系统扩展
  getWeChatSystemPrompt,
  getQQSystemPrompt,
  getSandboxSystemPrompt,
  getSentraToolFeedbackPrompt,
  
  // MCP 工具导出
  getMcpTools
};

/**
 * 获取函数注册表
 * @returns {Object} 函数注册表对象
 */
export function getFunctionRegistry() {
  return functionRegistry;
}

/**
 * 注册自定义函数
 * @param {string} name - 函数名称
 * @param {Function} fn - 函数实现
 */
export function registerFunction(name, fn) {
  if (typeof fn !== 'function') {
    throw new Error(`registerFunction: ${name} 必须是一个函数`);
  }
  
  functionRegistry[name] = fn;
}

/**
 * 注销函数
 * @param {string} name - 函数名称
 */
export function unregisterFunction(name) {
  delete functionRegistry[name];
}

/**
 * 检查函数是否已注册
 * @param {string} name - 函数名称
 * @returns {boolean} 是否已注册
 */
export function hasFunction(name) {
  return name in functionRegistry && typeof functionRegistry[name] === 'function';
}

/**
 * 获取所有已注册的函数名称
 * @returns {string[]} 函数名称数组
 */
export function getAllFunctionNames() {
  return Object.keys(functionRegistry);
}

/**
 * 执行函数
 * @param {string} name - 函数名称
 * @param  {...any} args - 函数参数
 * @returns {any} 函数执行结果
 */
export async function executeFunction(name, ...args) {
  if (!hasFunction(name)) {
    throw new Error(`函数 ${name} 未注册`);
  }
  
  try {
    const result = await functionRegistry[name](...args);
    return result;
  } catch (error) {
    throw new Error(`执行函数 ${name} 时出错: ${error.message}`);
  }
}

export default functionRegistry;
