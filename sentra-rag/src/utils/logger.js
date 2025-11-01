import winston from 'winston';
import path from 'path';
import chalk from 'chalk';
import config from '../config/index.js';

// 控制台格式（彩色）
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    const upper = String(level).toUpperCase();
    const colorByLevel = {
      INFO: chalk.green,
      WARN: chalk.yellow,
      ERROR: chalk.red,
      DEBUG: chalk.cyan
    };
    const color = colorByLevel[upper] || chalk.white;
    // message 里若包含 [Context]，将 Context 染为青色
    const coloredMsg = String(stack || message).replace(/\[(.*?)\]/, (m, g1) => `${chalk.bold.cyan(`[${g1}]`)}`);
    return `${chalk.gray(`[${timestamp}]`)} ${chalk.bold.magenta(upper)}: ${color(coloredMsg)}`;
  })
);

// 文件格式（不带颜色，便于检索）
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `[${timestamp}] ${String(level).toUpperCase()}: ${stack || message}`;
  })
);

// 创建日志器
const logger = winston.createLogger({
  level: config.logging.level,
  format: fileFormat,
  defaultMeta: { service: 'sentra-rag' },
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: consoleFormat
    }),
    
    // 文件输出
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      tailable: true
    }),
    
    // 错误日志单独文件
    new winston.transports.File({
      filename: path.join(path.dirname(config.logging.file), 'error.log'),
      level: 'error',
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      tailable: true
    })
  ]
});

/**
 * 创建具有上下文的日志器
 * @param {string} context - 日志上下文标识
 * @returns {Object} 带上下文的日志器
 */
export function createLogger(context) {
  return {
    info: (message, meta = {}) => logger.info(`[${context}] ${message}`, meta),
    warn: (message, meta = {}) => logger.warn(`[${context}] ${message}`, meta),
    error: (message, meta = {}) => logger.error(`[${context}] ${message}`, meta),
    debug: (message, meta = {}) => logger.debug(`[${context}] ${message}`, meta)
  };
}

export default logger;
