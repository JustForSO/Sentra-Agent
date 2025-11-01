/**
 * Sentra Prompts SDK
 * 动态提示词生成系统 SDK
 * 提供简洁的API供其他项目使用
 */

import { loadJsonConfig, loadEnvConfig } from './config.js';
import { parseTemplate, parseObject, parseTemplates } from './parser.js';
import { 
  getFunctionRegistry, 
  registerFunction, 
  unregisterFunction,
  hasFunction,
  getAllFunctionNames,
  executeFunction
} from './functions/registry.js';
import fetch from 'node-fetch';

// Polyfill global fetch for Node < 18
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = fetch;
}

/**
 * 解析单个提示词模板
 * @param {string} template - 模板字符串，包含 {{placeholder}} 格式的占位符
 * @param {string} envPath - .env 文件路径（可选）
 * @returns {Promise<string>} 解析后的字符串
 * 
 * @example
 * const result = await parse('当前时间是 {{time}}，今天是 {{date}}');
 * console.log(result); // 当前时间是 14:30:25，今天是 2025年10月01日
 */
export async function parse(template, envPath = null) {
  const envConfig = loadEnvConfig(envPath);
  const functionRegistry = getFunctionRegistry();
  return await parseTemplate(template, envConfig, functionRegistry);
}

/**
 * 解析对象中的所有模板字符串
 * @param {any} obj - 包含模板字符串的对象
 * @param {string} envPath - .env 文件路径（可选）
 * @returns {Promise<any>} 解析后的对象
 * 
 * @example
 * const config = {
 *   name: '{{name}}',
 *   prompt: '当前时间 {{time}}'
 * };
 * const result = await parseObj(config);
 * console.log(result); // { name: '智能助手', prompt: '当前时间 14:30:25' }
 */
export async function parseObj(obj, envPath = null) {
  const envConfig = loadEnvConfig(envPath);
  const functionRegistry = getFunctionRegistry();
  return await parseObject(obj, envConfig, functionRegistry);
}

/**
 * 批量解析多个模板
 * @param {string[]} templates - 模板数组
 * @param {string} envPath - .env 文件路径（可选）
 * @returns {Promise<string[]>} 解析后的字符串数组
 * 
 * @example
 * const templates = ['{{time}}', '{{date}}', '{{weekday}}'];
 * const results = await parseMultiple(templates);
 * console.log(results); // ['14:30:25', '2025年10月01日', '星期三']
 */
export async function parseMultiple(templates, envPath = null) {
  const envConfig = loadEnvConfig(envPath);
  const functionRegistry = getFunctionRegistry();
  return await parseTemplates(templates, envConfig, functionRegistry);
}

/**
 * 加载并解析 Agent 配置文件
 * @param {string} agentPath - agent.json 文件路径
 * @param {string} envPath - .env 文件路径（可选）
 * @returns {Promise<Object>} 解析后的 Agent 配置对象
 * 
 * @example
 * const agent = await loadAgent('./agent.json');
 * console.log(agent.systemPrompt); // 解析后的系统提示词
 */
export async function loadAgent(agentPath, envPath = null) {
  const agentConfig = loadJsonConfig(agentPath);
  const envConfig = loadEnvConfig(envPath);
  const functionRegistry = getFunctionRegistry();
  return await parseObject(agentConfig, envConfig, functionRegistry);
}

/**
 * 加载并解析 Agent 配置文件，返回JSON格式
 * @param {string} agentPath - agent.json 文件路径
 * @param {string} envPath - .env 文件路径（可选）
 * @returns {Promise<string>} 解析后的 Agent 配置 JSON 字符串
 * 
 * @example
 * const jsonStr = await loadAgentJSON('./agent.json');
 * console.log(jsonStr); // 格式化的JSON字符串
 */
export async function loadAgentJSON(agentPath, envPath = null) {
  const result = await loadAgent(agentPath, envPath);
  return JSON.stringify(result, null, 2);
}

/**
 * 注册自定义函数
 * @param {string} name - 函数名称
 * @param {Function} fn - 函数实现
 * 
 * @example
 * register('myFunc', () => 'Hello World');
 * // 然后在.env中配置: my_placeholder=myFunc
 */
export function register(name, fn) {
  registerFunction(name, fn);
}

/**
 * 注销函数
 * @param {string} name - 函数名称
 * 
 * @example
 * unregister('myFunc');
 */
export function unregister(name) {
  unregisterFunction(name);
}

/**
 * 检查函数是否已注册
 * @param {string} name - 函数名称
 * @returns {boolean} 是否已注册
 * 
 * @example
 * const exists = has('getCurrentTime');
 * console.log(exists); // true
 */
export function has(name) {
  return hasFunction(name);
}

/**
 * 获取所有已注册的函数名称列表
 * @returns {string[]} 函数名称数组
 * 
 * @example
 * const functions = getFunctions();
 * console.log(functions); // ['getCurrentTime', 'getCurrentDate', ...]
 */
export function getFunctions() {
  return getAllFunctionNames();
}

/**
 * 搜索函数（按名称模糊匹配，大小写不敏感）
 * @param {string} query - 关键字
 * @returns {string[]} 匹配的函数名称列表
 */
export function searchFunctions(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return getAllFunctionNames();
  return getAllFunctionNames().filter(name => name.toLowerCase().includes(q));
}

/**
 * 执行指定函数
 * @param {string} name - 函数名称
 * @param  {...any} args - 函数参数
 * @returns {Promise<any>} 函数执行结果
 * 
 * @example
 * const result = await execute('getCurrentTime');
 * console.log(result); // 14:30:25
 */
export async function execute(name, ...args) {
  return await executeFunction(name, ...args);
}

/**
 * 获取函数注册表
 * @returns {Object} 函数注册表对象
 * 
 * @example
 * const registry = getRegistry();
 * console.log(Object.keys(registry)); // 所有函数名
 */
export function getRegistry() {
  return getFunctionRegistry();
}

/**
 * 默认导出（可调用函数）
 * - 传入字符串：解析单个模板
 * - 传入字符串数组：批量解析
 * - 传入对象：递归解析对象中的模板
 *
 * @param {string|string[]|Object} input
 * @param {string|null} envPath 可选 .env 路径
 * @returns {Promise<any>} 解析结果
 *
 * @example
 * import sentra from 'sentra-prompts';
 * const text = await sentra('现在时间：{{time}}');
 */
async function SentraPromptsSDK(input, envPath = null) {
  if (Array.isArray(input)) {
    return await parseMultiple(input, envPath);
  }
  if (typeof input === 'string') {
    return await parse(input, envPath);
  }
  if (input && typeof input === 'object') {
    return await parseObj(input, envPath);
  }
  throw new Error('默认函数仅支持 string | string[] | object');
}

// 兼容：将所有方法挂载到默认函数上，便于 IDE 补全
SentraPromptsSDK.parse = parse;
SentraPromptsSDK.parseObj = parseObj;
SentraPromptsSDK.parseMultiple = parseMultiple;
SentraPromptsSDK.loadAgent = loadAgent;
SentraPromptsSDK.loadAgentJSON = loadAgentJSON;
SentraPromptsSDK.register = register;
SentraPromptsSDK.unregister = unregister;
SentraPromptsSDK.has = has;
SentraPromptsSDK.getFunctions = getFunctions;
SentraPromptsSDK.execute = execute;
SentraPromptsSDK.searchFunctions = searchFunctions;
SentraPromptsSDK.fetch = fetch;

export default SentraPromptsSDK;