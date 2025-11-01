/**
 * 数学计算相关函数模块
 * 提供各种数学计算功能
 */

/**
 * 生成随机整数
 * @param {number} min - 最小值（默认0）
 * @param {number} max - 最大值（默认100）
 * @returns {number} 随机整数
 */
export function randomInt(min = 0, max = 100) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 生成随机浮点数
 * @param {number} min - 最小值（默认0）
 * @param {number} max - 最大值（默认1）
 * @param {number} decimals - 小数位数（默认2）
 * @returns {number} 随机浮点数
 */
export function randomFloat(min = 0, max = 1, decimals = 2) {
  const value = Math.random() * (max - min) + min;
  return parseFloat(value.toFixed(decimals));
}

/**
 * 计算百分比
 * @param {number} value - 数值
 * @param {number} total - 总数
 * @param {number} decimals - 小数位数（默认2）
 * @returns {string} 百分比字符串
 */
export function calculatePercentage(value, total, decimals = 2) {
  if (total === 0) return '0%';
  const percentage = (value / total) * 100;
  return `${percentage.toFixed(decimals)}%`;
}

/**
 * 四舍五入
 * @param {number} value - 数值
 * @param {number} decimals - 小数位数（默认2）
 * @returns {number} 四舍五入后的值
 */
export function roundNumber(value, decimals = 2) {
  return parseFloat(value.toFixed(decimals));
}

/**
 * 向上取整
 * @param {number} value - 数值
 * @returns {number} 向上取整后的值
 */
export function ceilNumber(value) {
  return Math.ceil(value);
}

/**
 * 向下取整
 * @param {number} value - 数值
 * @returns {number} 向下取整后的值
 */
export function floorNumber(value) {
  return Math.floor(value);
}

/**
 * 获取绝对值
 * @param {number} value - 数值
 * @returns {number} 绝对值
 */
export function absoluteValue(value) {
  return Math.abs(value);
}

/**
 * 计算平方
 * @param {number} value - 数值
 * @returns {number} 平方值
 */
export function square(value) {
  return value * value;
}

/**
 * 计算平方根
 * @param {number} value - 数值
 * @returns {number} 平方根
 */
export function squareRoot(value) {
  return Math.sqrt(value);
}

/**
 * 计算幂
 * @param {number} base - 底数
 * @param {number} exponent - 指数
 * @returns {number} 幂值
 */
export function power(base, exponent) {
  return Math.pow(base, exponent);
}

/**
 * 获取最大值
 * @param  {...number} values - 数值列表
 * @returns {number} 最大值
 */
export function maxValue(...values) {
  return Math.max(...values);
}

/**
 * 获取最小值
 * @param  {...number} values - 数值列表
 * @returns {number} 最小值
 */
export function minValue(...values) {
  return Math.min(...values);
}

/**
 * 计算总和
 * @param  {...number} values - 数值列表
 * @returns {number} 总和
 */
export function sum(...values) {
  return values.reduce((acc, val) => acc + val, 0);
}

/**
 * 计算平均值
 * @param  {...number} values - 数值列表
 * @returns {number} 平均值
 */
export function average(...values) {
  if (values.length === 0) return 0;
  return sum(...values) / values.length;
}

/**
 * 格式化数字（添加千位分隔符）
 * @param {number} value - 数值
 * @returns {string} 格式化后的字符串
 */
export function formatNumber(value) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 转换为货币格式
 * @param {number} value - 数值
 * @param {string} currency - 货币符号（默认¥）
 * @returns {string} 货币格式字符串
 */
export function toCurrency(value, currency = '¥') {
  return `${currency}${formatNumber(value.toFixed(2))}`;
}

/**
 * 计算增长率
 * @param {number} oldValue - 旧值
 * @param {number} newValue - 新值
 * @param {number} decimals - 小数位数（默认2）
 * @returns {string} 增长率字符串
 */
export function growthRate(oldValue, newValue, decimals = 2) {
  if (oldValue === 0) return 'N/A';
  const rate = ((newValue - oldValue) / oldValue) * 100;
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${rate.toFixed(decimals)}%`;
}

/**
 * 生成斐波那契数列
 * @param {number} n - 数列长度
 * @returns {number[]} 斐波那契数列
 */
export function fibonacci(n) {
  if (n <= 0) return [];
  if (n === 1) return [0];
  if (n === 2) return [0, 1];
  
  const sequence = [0, 1];
  for (let i = 2; i < n; i++) {
    sequence.push(sequence[i - 1] + sequence[i - 2]);
  }
  return sequence;
}
