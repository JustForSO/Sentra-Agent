import SentraMcpSDK from 'sentra-mcp';
import SentraPromptsSDK from 'sentra-prompts';
import { Agent } from "../agent.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载test目录的独立配置（当前目录就是test）
const testEnvPath = path.join(__dirname, '.env');
if (fs.existsSync(testEnvPath)) {
  dotenv.config({ path: testEnvPath });
  console.log('✓ 已加载测试环境配置:', testEnvPath);
} else {
  console.warn('⚠ 未找到测试配置文件，将使用默认配置');
}

// ==================== 配置加载 ====================
const CONFIG = {
  // WebSocket配置
  wsUrl: process.env.WS_URL || 'ws://localhost:6702',
  wsTimeout: parseInt(process.env.WS_TIMEOUT || '60000'),
  
  // AI API配置
  apiBaseUrl: process.env.API_BASE_URL || 'https://api.openai.com/v1',
  apiKey: process.env.API_KEY,
  modelName: process.env.MODEL_NAME || 'gpt-3.5-turbo',
  temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
  maxTokens: parseInt(process.env.MAX_TOKENS || '20000'),
  
  // 消息解析配置
  paragraphSeparator: process.env.PARAGRAPH_SEPARATOR || '|',
  filePlaceholderPattern: process.env.FILE_PLACEHOLDER_PATTERN || '__FILE_(\\d+)__',
  newlineSplitThreshold: parseInt(process.env.NEWLINE_SPLIT_THRESHOLD || '2'),
  
  // 发送策略配置
  groupAtProbability: parseFloat(process.env.GROUP_AT_PROBABILITY || '0.25'),
  multiSegmentReplyProbability: parseFloat(process.env.MULTI_SEGMENT_REPLY_PROBABILITY || '0.6'),
  singleSegmentReplyProbability: parseFloat(process.env.SINGLE_SEGMENT_REPLY_PROBABILITY || '0.5'),
  preferUserMessageProbability: parseFloat(process.env.PREFER_USER_MESSAGE_PROBABILITY || '0.7'),
  
  // 发送间隔配置
  segmentDelayMin: parseInt(process.env.SEGMENT_DELAY_MIN || '800'),
  segmentDelayMax: parseInt(process.env.SEGMENT_DELAY_MAX || '3000'),
  
  // 历史记录配置
  userMessageHistoryLimit: parseInt(process.env.USER_MESSAGE_HISTORY_LIMIT || '5'),
  botMessageHistoryLimit: parseInt(process.env.BOT_MESSAGE_HISTORY_LIMIT || '5'),
  
  // 机器人配置
  botName: process.env.BOT_NAME || '助手',
  botAliases: (process.env.BOT_ALIASES || '').split(',').map(s => s.trim()).filter(s => s),
  
  // 智能回复判断配置
  enableSmartReply: process.env.ENABLE_SMART_REPLY === 'true',
  messageQueueLimit: parseInt(process.env.MESSAGE_QUEUE_LIMIT || '10'),
  judgeTimeout: parseInt(process.env.JUDGE_TIMEOUT || '5000'),
  judgeModel: process.env.JUDGE_MODEL || 'gpt-4o-mini',
  
  // 回复队列并发控制配置
  replyConcurrency: parseInt(process.env.REPLY_CONCURRENCY || '1'),
  replyCooldown: parseInt(process.env.REPLY_COOLDOWN || '2000'),
  skipOnGenerationFail: process.env.SKIP_ON_GENERATION_FAIL === 'true',
  
  // 消息合并CD配置
  messageMergeDelay: parseInt(process.env.MESSAGE_MERGE_DELAY || '5000'),
  enableMessageMerge: process.env.ENABLE_MESSAGE_MERGE !== 'false',
  
  // 全局历史记录配置
  globalHistoryLimit: parseInt(process.env.GLOBAL_HISTORY_LIMIT || '100'),
  enableGlobalHistory: process.env.ENABLE_GLOBAL_HISTORY !== 'false',
  
  // 工具任务历史配置
  toolSummaryLimit: parseInt(process.env.TOOL_SUMMARY_LIMIT || '10'),
  enableToolSummary: process.env.ENABLE_TOOL_SUMMARY !== 'false',
  
  // 测试配置
  testUserId: parseInt(process.env.TEST_USER_ID || '0'),
  testMode: process.env.TEST_MODE === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // 系统提示词配置
  systemPromptFile: process.env.SYSTEM_PROMPT_FILE || './1.txt',
  
  // 阶段提示词配置
  overlays: {
    plan: process.env.OVERLAY_PLAN || '规划需成本优先；若无法直接完成，应先做诊断/信息收集。',
    arggen: process.env.OVERLAY_ARGGEN || '严格匹配 schema；仅输出必要字段与最小值集。',
    arggen_fix: process.env.OVERLAY_ARGGEN_FIX || '仅修复缺失/类型错误字段，不引入新键。',
    final_judge: process.env.OVERLAY_FINAL_JUDGE || '判断严格；不确定则标记失败并说明失败步骤与理由。',
    schedule_progress: process.env.OVERLAY_SCHEDULE_PROGRESS || '生成进度提示时，要体现耐心和关怀，让用户感到被重视。',
    final_summary: process.env.OVERLAY_FINAL_SUMMARY || '以3-5条要点总结，并给出可执行的下一步建议。'
  }
};

console.log('\n========== 测试环境配置 ==========');
console.log('WebSocket URL:', CONFIG.wsUrl);
console.log('API Base URL:', CONFIG.apiBaseUrl);
console.log('Model:', CONFIG.modelName);
console.log('Temperature:', CONFIG.temperature);
console.log('Max Tokens:', CONFIG.maxTokens === -1 ? '不限制' : CONFIG.maxTokens);
console.log('段落分隔符:', CONFIG.paragraphSeparator);
console.log('机器人名称:', CONFIG.botName);
console.log('智能回复:', CONFIG.enableSmartReply ? '开启' : '关闭');
console.log('判断模型:', CONFIG.judgeModel);
console.log('消息队列限制:', CONFIG.messageQueueLimit);
console.log('回复并发数:', CONFIG.replyConcurrency);
console.log('回复冷却时间:', CONFIG.replyCooldown + 'ms');
console.log('失败跳过:', CONFIG.skipOnGenerationFail ? '是' : '否');
console.log('消息合并:', CONFIG.enableMessageMerge ? `开启(${CONFIG.messageMergeDelay}ms)` : '关闭');
console.log('全局历史:', CONFIG.enableGlobalHistory ? `开启(${CONFIG.globalHistoryLimit}条)` : '关闭');
console.log('工具历史:', CONFIG.enableToolSummary ? `开启(${CONFIG.toolSummaryLimit}条)` : '关闭');
console.log('测试用户ID:', CONFIG.testUserId || '所有用户');
console.log('测试模式:', CONFIG.testMode ? '开启' : '关闭');
console.log('===================================\n');

// 初始化 AI Agent（使用独立配置）
const agent = new Agent({
  apiKey: CONFIG.apiKey,
  apiBaseUrl: CONFIG.apiBaseUrl,
  defaultModel: CONFIG.modelName,
  temperature: CONFIG.temperature,
  maxTokens: CONFIG.maxTokens
});

// 初始化 Sentra MCP SDK
const sdk = new SentraMcpSDK();
await sdk.init();

// 建立 WebSocket 连接
const ws = new WebSocket(CONFIG.wsUrl);
const send = (obj) => ws.send(JSON.stringify(obj));

// 读取系统提示词
const systemPromptPath = path.resolve(__dirname, CONFIG.systemPromptFile);
if (!fs.existsSync(systemPromptPath)) {
  console.error(`系统提示词文件不存在: ${systemPromptPath}`);
  process.exit(1);
}
const systems = fs.readFileSync(systemPromptPath, 'utf-8');
const text = "{{sandbox_system_prompt}}\n{{sentra_tools_rules}}\n现在时间：{{time}}\n\n平台：\n{{qq_system_prompt}}\n\n" + systems;
const system = await SentraPromptsSDK(text);

// 存储对话历史，用于智能引用之前的消息
// key: userId (私聊) 或 group_${groupId}_${userId} (群聊)
// value: { userMessages: [], botMessages: [] }
const conversationHistory = new Map();

// 消息队列管理（用于智能回复判断）
// key: conversationId (U:userId 或 G:groupId)
// value: { messages: [], lastProcessTime: timestamp }
const messageQueues = new Map();

// ==================== 消息合并定时器管理 ====================

/**
 * 消息合并定时器管理
 * key: conversationId (U:userId 或 G:groupId)
 * value: { timer, pendingMessages: [], senderId }
 */
const messageMergeTimers = new Map();

/**
 * 添加消息到合并队列
 * @param {string} conversationId - 会话ID
 * @param {Object} msg - 消息对象
 * @param {Function} processCallback - 处理回调函数
 */
function addMessageForMerge(conversationId, msg, processCallback) {
  // 如果禁用消息合并，直接处理
  if (!CONFIG.enableMessageMerge) {
    processCallback([msg]);
    return;
  }
  
  const senderId = msg.sender_id;
  
  // 检查是否已有该会话的定时器
  if (messageMergeTimers.has(conversationId)) {
    const mergeData = messageMergeTimers.get(conversationId);
    
    // 如果是同一个发送者，累积消息并重置定时器
    if (mergeData.senderId === senderId) {
      clearTimeout(mergeData.timer);
      mergeData.pendingMessages.push(msg);
      
      console.log(`[消息合并] ${conversationId} 累积消息 ${mergeData.pendingMessages.length} 条，重置定时器`);
      
      // 设置新的定时器
      mergeData.timer = setTimeout(() => {
        const messages = [...mergeData.pendingMessages];
        messageMergeTimers.delete(conversationId);
        console.log(`[消息合并] ${conversationId} 定时器触发，处理 ${messages.length} 条合并消息`);
        processCallback(messages);
      }, CONFIG.messageMergeDelay);
    } else {
      // 不同发送者，立即处理之前的消息，开始新的合并
      clearTimeout(mergeData.timer);
      const oldMessages = [...mergeData.pendingMessages];
      messageMergeTimers.delete(conversationId);
      
      console.log(`[消息合并] ${conversationId} 发送者变更，立即处理前 ${oldMessages.length} 条消息`);
      processCallback(oldMessages);
      
      // 开始新的合并
      addMessageForMerge(conversationId, msg, processCallback);
    }
  } else {
    // 首次收到消息，创建定时器
    const timer = setTimeout(() => {
      const messages = [msg];
      messageMergeTimers.delete(conversationId);
      console.log(`[消息合并] ${conversationId} 定时器触发，处理 1 条消息`);
      processCallback(messages);
    }, CONFIG.messageMergeDelay);
    
    messageMergeTimers.set(conversationId, {
      timer,
      pendingMessages: [msg],
      senderId
    });
    
    console.log(`[消息合并] ${conversationId} 开始等待 ${CONFIG.messageMergeDelay}ms...`);
  }
}

// ==================== 全局历史记录管理 ====================

/**
 * 全局历史记录管理
 * key: conversationId (U:userId 或 G:groupId)
 * value: [ { summary, time_str, sender_name, is_bot } ]
 */
const globalHistory = new Map();

/**
 * 添加消息到全局历史
 * @param {string} conversationId - 会话ID
 * @param {Object} msg - 消息对象
 * @param {boolean} isBot - 是否为机器人消息
 */
function addToGlobalHistory(conversationId, msg, isBot = false) {
  if (!CONFIG.enableGlobalHistory) {
    return;
  }
  
  if (!globalHistory.has(conversationId)) {
    globalHistory.set(conversationId, []);
  }
  
  const history = globalHistory.get(conversationId);
  
  // 添加消息记录
  history.push({
    summary: msg.summary || msg.text || '',
    time_str: msg.time_str || new Date().toLocaleString('zh-CN'),
    sender_name: msg.sender_name || (isBot ? CONFIG.botName : 'Unknown'),
    is_bot: isBot
  });
  
  // 限制历史记录数量
  if (history.length > CONFIG.globalHistoryLimit) {
    history.shift(); // 移除最旧的记录
  }
  
  console.log(`[全局历史] ${conversationId} 记录消息，当前 ${history.length}/${CONFIG.globalHistoryLimit} 条`);
}

/**
 * 获取全局历史记录的格式化文本
 * @param {string} conversationId - 会话ID
 * @returns {string} 格式化的历史记录
 */
function getGlobalHistoryText(conversationId) {
  if (!CONFIG.enableGlobalHistory || !globalHistory.has(conversationId)) {
    return '';
  }
  
  const history = globalHistory.get(conversationId);
  if (history.length === 0) {
    return '';
  }
  
  const historyText = history.map(record => {
    const prefix = record.is_bot ? `[${CONFIG.botName}]` : `[${record.sender_name}]`;
    return `${record.time_str} ${prefix}: ${record.summary}`;
  }).join('\n');
  
  return `\n\n【对话历史记录（最近${history.length}条）】\n${historyText}`;
}

// ==================== 工具任务历史管理 ====================

/**
 * 工具任务历史管理
 * key: conversationId (U:userId 或 G:groupId)
 * value: [ { runId, time_str, summary } ]
 */
const toolSummaryHistory = new Map();

/**
 * 添加工具任务总结到历史
 * @param {string} conversationId - 会话ID
 * @param {string} runId - 运行ID
 * @param {string} summary - 任务总结
 */
function addToolSummary(conversationId, runId, summary) {
  if (!CONFIG.enableToolSummary || !summary) {
    return;
  }
  
  if (!toolSummaryHistory.has(conversationId)) {
    toolSummaryHistory.set(conversationId, []);
  }
  
  const history = toolSummaryHistory.get(conversationId);
  
  // 添加总结记录
  history.push({
    runId,
    time_str: new Date().toLocaleString('zh-CN'),
    summary: summary.trim()
  });
  
  // 限制历史数量
  if (history.length > CONFIG.toolSummaryLimit) {
    history.shift(); // 移除最旧的记录
  }
  
  console.log(`[工具历史] ${conversationId} 记录任务总结，当前 ${history.length}/${CONFIG.toolSummaryLimit} 条`);
}

/**
 * 获取工具任务历史的格式化文本
 * @param {string} conversationId - 会话ID
 * @returns {string} 格式化的工具任务历史
 */
function getToolSummaryText(conversationId) {
  if (!CONFIG.enableToolSummary || !toolSummaryHistory.has(conversationId)) {
    return '';
  }
  
  const history = toolSummaryHistory.get(conversationId);
  if (history.length === 0) {
    return '';
  }
  
  const historyText = history.map((record, index) => {
    return `${index + 1}. [${record.time_str}] ${record.summary}`;
  }).join('\n\n');
  
  return `\n\n【近期工具任务反馈（最近${history.length}条）】\n${historyText}`;
}

// ==================== 回复队列并发控制 ====================

/**
 * 回复任务队列管理器
 */
class ReplyQueueManager {
  constructor(concurrency = 1, cooldown = 2000) {
    this.concurrency = concurrency; // 并发数量
    this.cooldown = cooldown; // 冷却时间（毫秒）
    this.queue = []; // 待处理任务队列
    this.processing = 0; // 当前处理中的任务数
    this.lastCompleteTime = 0; // 上次完成时间
  }
  
  /**
   * 添加回复任务到队列
   * @param {Function} task - 异步任务函数
   * @returns {Promise} 任务执行结果
   */
  async addTask(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._processQueue();
    });
  }
  
  /**
   * 处理队列中的任务
   */
  async _processQueue() {
    // 如果已达到并发上限，等待
    if (this.processing >= this.concurrency) {
      return;
    }
    
    // 如果队列为空，退出
    if (this.queue.length === 0) {
      return;
    }
    
    // 检查冷却时间
    const now = Date.now();
    const timeSinceLastComplete = now - this.lastCompleteTime;
    if (this.lastCompleteTime > 0 && timeSinceLastComplete < this.cooldown) {
      const waitTime = this.cooldown - timeSinceLastComplete;
      console.log(`[并发控制] 冷却中，等待 ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // 从队列中取出任务
    const item = this.queue.shift();
    if (!item) return;
    
    this.processing++;
    const queueLength = this.queue.length;
    console.log(`[并发控制] 开始处理任务 (当前: ${this.processing}/${this.concurrency}, 队列: ${queueLength})`);
    
    try {
      const result = await item.task();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.processing--;
      this.lastCompleteTime = Date.now();
      console.log(`[并发控制] 任务完成 (剩余: ${this.processing}/${this.concurrency})`);
      
      // 继续处理下一个任务
      this._processQueue();
    }
  }
  
  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      processing: this.processing,
      queued: this.queue.length,
      concurrency: this.concurrency
    };
  }
}

// 初始化回复队列管理器
const replyQueueManager = new ReplyQueueManager(
  CONFIG.replyConcurrency,
  CONFIG.replyCooldown
);

/**
 * 获取会话ID
 * @param {Object} msg - 消息对象
 * @returns {string} 会话ID
 */
function getConversationId(msg) {
  if (msg.type === 'private') {
    return `U:${msg.sender_id}`;
  } else if (msg.type === 'group') {
    return `G:${msg.group_id}`;
  }
  return 'unknown';
}

/**
 * 添加消息到队列
 * @param {string} conversationId - 会话ID
 * @param {Object} msg - 消息对象
 */
function addMessageToQueue(conversationId, msg) {
  if (!messageQueues.has(conversationId)) {
    messageQueues.set(conversationId, {
      messages: [],
      lastProcessTime: Date.now()
    });
  }
  
  const queue = messageQueues.get(conversationId);
  queue.messages.push({
    text: msg.text,
    summary: msg.summary,
    sender_id: msg.sender_id,
    sender_name: msg.sender_name,
    time: msg.time,
    time_str: msg.time_str
  });
  
  // 只保留最近的消息（配置的限制）
  if (queue.messages.length > CONFIG.messageQueueLimit) {
    queue.messages.shift();
  }
  
  console.log(`[消息队列] ${conversationId} 当前队列长度: ${queue.messages.length}/${CONFIG.messageQueueLimit}`);
}

/**
 * 获取并清空消息队列
 * @param {string} conversationId - 会话ID
 * @returns {Array} 队列中的消息
 */
function getAndClearQueue(conversationId) {
  if (!messageQueues.has(conversationId)) {
    return [];
  }
  
  const queue = messageQueues.get(conversationId);
  const messages = [...queue.messages];
  queue.messages = [];
  queue.lastProcessTime = Date.now();
  
  return messages;
}

/**
 * 智能判断是否需要回复
 * @param {Object} msg - 当前消息对象
 * @param {Array} queuedMessages - 队列中的历史消息
 * @returns {Promise<boolean>} 是否需要回复
 */
async function shouldReply(msg, queuedMessages = []) {
  // 如果禁用智能回复，总是回复
  if (!CONFIG.enableSmartReply) {
    return true;
  }
  
  // 私聊默认总是回复
  if (msg.type === 'private') {
    console.log('[智能判断] 私聊消息，默认回复');
    return true;
  }
  
  // 如果@了机器人或提到机器人名称，必须回复
  const mentionedBot = msg.at_users?.some(at => at.qq === msg.self_id) ||
                       msg.text?.includes(CONFIG.botName) ||
                       CONFIG.botAliases.some(alias => msg.text?.includes(alias));
  
  if (mentionedBot) {
    console.log('[智能判断] 消息中提到机器人，必须回复');
    return true;
  }
  
  // 构建判断提示词
  const botNames = [CONFIG.botName, ...CONFIG.botAliases].join('、');
  const historyContext = queuedMessages.length > 0
    ? `\n\n最近的对话历史：\n${queuedMessages.map((m, i) => `${i + 1}. [${m.time_str}] ${m.sender_name}: ${m.text}`).join('\n')}`
    : '';
  
  const judgePrompt = `你是群聊机器人"${CONFIG.botName}"。请判断以下消息是否需要你回复。

判断标准：
1. 如果消息明确提到你的名字（${botNames}）或@你，需要回复
2. 如果消息是向你提问、求助或需要你的参与，需要回复
3. 如果消息是闲聊内容且与你相关，可以适当参与
4. 如果消息是群友之间的对话，与你无关，不需要回复
5. 如果消息内容简短且无意义（如单个表情、"。"等），不需要回复
6. 结合对话历史判断，如果讨论的话题你之前参与过，可以适当回复${historyContext}

当前消息：
发送者：${msg.sender_name}
内容：${msg.text}`;

  try {
    // 使用 OpenAI tools 和 tool_choice 确保返回结构化JSON
    const judgeResponse = await agent.chat(
      [
        { role: 'system', content: '你是一个专业的对话判断助手，负责判断机器人是否需要回复群聊消息。' },
        { role: 'user', content: judgePrompt }
      ],
      {
        model: CONFIG.judgeModel,
        temperature: 0.3,
        maxTokens: 300,
        tools: [{
          type: "function",
          function: {
            name: "judge_reply_need",
            description: "判断机器人是否需要回复这条消息",
            parameters: {
              type: "object",
              properties: {
                should_reply: {
                  type: "boolean",
                  description: "是否需要回复，true表示需要回复，false表示不需要回复"
                },
                reason: {
                  type: "string",
                  description: "判断的详细理由，说明为什么需要或不需要回复"
                },
                confidence: {
                  type: "number",
                  description: "判断的置信度，范围0.0-1.0，越高表示越确定",
                  minimum: 0,
                  maximum: 1
                }
              },
              required: ["should_reply", "reason"]
            }
          }
        }],
        tool_choice: {
          type: "function",
          function: { name: "judge_reply_need" }
        }
      }
    );
    
    // agent.chat 使用 tools 时会自动返回解析好的JSON对象
    if (!judgeResponse || typeof judgeResponse.should_reply === 'undefined') {
      console.warn('[智能判断] 无效的判断结果，默认需要回复');
      console.warn('[智能判断] 原始响应:', judgeResponse);
      return true;
    }
    
    const shouldReplyResult = judgeResponse.should_reply !== false;
    const reason = judgeResponse.reason || '未知原因';
    const confidence = judgeResponse.confidence || 0.5;
    
    console.log(`[智能判断] 结果: ${shouldReplyResult ? '需要回复' : '不需要回复'}`);
    console.log(`[智能判断] 理由: ${reason}`);
    console.log(`[智能判断] 置信度: ${(confidence * 100).toFixed(1)}%`);
    
    return shouldReplyResult;
    
  } catch (error) {
    console.error('[智能判断] 判断失败，默认需要回复:', error.message);
    return true;
  }
}

/**
 * 规范化文件路径，移除 file:// 前缀并处理 Windows 路径
 * @param {string} filePath - 原始文件路径
 * @returns {string} 规范化后的路径
 */
function normalizeFilePath(filePath) {
  // 移除 file:// 协议前缀
  if (filePath.startsWith('file://')) {
    filePath = filePath.replace('file://', '');
  }
  
  // 处理 Windows 路径（移除开头的斜杠）
  if (process.platform === 'win32' && filePath.startsWith('/')) {
    filePath = filePath.substring(1);
  }
  
  return filePath;
}

/**
 * 检查是否为本地文件路径（排除网络链接）
 * @param {string} filePath - 文件路径
 * @returns {boolean} 是否为本地文件
 */
function isLocalFilePath(filePath) {
  // 排除网络链接
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return false;
  }
  
  // 处理 file:// 协议并检查文件是否存在
  const normalizedPath = normalizeFilePath(filePath);
  return fs.existsSync(normalizedPath);
}

/**
 * 解析 Markdown 中的本地文件路径（按出现顺序，自动去重）
 * 优先匹配图片语法 ![alt](path)，再匹配链接语法 [text](path)
 * @param {string} text - Markdown 文本
 * @returns {Array} 文件信息数组
 */
function parseMarkdownFiles(text) {
  const seenPaths = new Set(); // 用于去重
  let workingText = text; // 用于逐步替换已匹配的内容
  const matches = [];
  
  // 第一步：匹配所有图片语法 ![alt](path)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  
  while ((match = imageRegex.exec(text)) !== null) {
    const rawFilePath = match[2];
    
    if (isLocalFilePath(rawFilePath)) {
      const normalizedPath = normalizeFilePath(rawFilePath);
      
      // 去重检查
      if (!seenPaths.has(normalizedPath)) {
        seenPaths.add(normalizedPath);
        matches.push({
          index: match.index,
          markdown: match[0],
          altText: match[1],
          path: normalizedPath,
          rawPath: rawFilePath,
          syntaxType: 'image'
        });
        
        // 用唯一标记替换已匹配的图片，防止被链接正则重复匹配
        workingText = workingText.replace(match[0], `__IMG_MATCHED_${matches.length - 1}__`);
      }
    }
  }
  
  // 第二步：在替换后的文本中匹配链接语法 [text](path)
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(workingText)) !== null) {
    const rawFilePath = match[2];
    
    if (isLocalFilePath(rawFilePath)) {
      const normalizedPath = normalizeFilePath(rawFilePath);
      
      // 去重检查
      if (!seenPaths.has(normalizedPath)) {
        seenPaths.add(normalizedPath);
        
        // 在原始文本中找到对应位置（通过内容匹配）
        const escapedText = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedPath = match[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const originalMatch = text.match(new RegExp(`\\[${escapedText}\\]\\(${escapedPath}\\)`));
        
        if (originalMatch) {
          matches.push({
            index: text.indexOf(originalMatch[0]),
            markdown: originalMatch[0],
            altText: match[1],
            path: normalizedPath,
            rawPath: rawFilePath,
            syntaxType: 'link'
          });
        }
      }
    }
  }
  
  // 按出现顺序排序
  matches.sort((a, b) => a.index - b.index);
  
  // 分类文件类型并添加文件名
  matches.forEach(match => {
    const ext = path.extname(match.path).toLowerCase();
    const fileName = path.basename(match.path);
    
    let fileType;
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) {
      fileType = 'image';
    } else if (['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm'].includes(ext)) {
      fileType = 'video';
    } else if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'].includes(ext)) {
      fileType = 'record';
    } else {
      fileType = 'file';
    }
    
    match.fileType = fileType;
    match.fileName = fileName;
  });
  
  return matches;
}

/**
 * 解析消息片段（按 AI 回复的顺序：文本、文件、文本...）
 * 1. 先用唯一占位符替换所有文件标记
 * 2. 按 | 分割文本段落
 * 3. 每个段落内部，按文件占位符和连续空行(\n\n)进一步细分
 * @param {string} text - 原始文本
 * @param {Array} files - 文件信息数组
 * @returns {Array} 消息片段数组 [{ type: 'text'|'file', content: ..., file: ... }]
 */
function parseMessageSegments(text, files) {
  console.log('=== 开始解析消息片段 ===');
  console.log('原始文本:', text);
  console.log('解析到的文件:', files.map(f => `${f.fileName} (${f.fileType})`));
  
  // 步骤1：用唯一占位符替换所有文件标记
  let workingText = text;
  files.forEach((file, index) => {
    const placeholder = `__FILE_${index}__`;
    console.log(`替换文件标记: ${file.markdown} -> ${placeholder}`);
    workingText = workingText.replace(file.markdown, placeholder);
  });
  
  console.log('替换文件后的文本:', workingText);
  
  // 步骤2：按配置的段落分隔符分割文本段落
  const separator = CONFIG.paragraphSeparator;
  const rawSegments = workingText.split(separator).map(s => s.trim()).filter(s => s);
  console.log('按 | 分割后的段落:', rawSegments);
  
  // 步骤3：进一步细分每个段落
  const finalSegments = [];
  
  rawSegments.forEach((segment, segIndex) => {
    console.log(`\n--- 处理段落 ${segIndex + 1} ---`);
    console.log('段落内容:', segment);
    
    // 使用正则分割：按文件占位符或连续的配置阈值个换行符
    // 匹配模式：文件占位符 或 连续配置阈值个及以上换行
    const newlinePattern = new RegExp(`(__FILE_\\d+__|(?:\\n\\s*){${CONFIG.newlineSplitThreshold},})`);
    const parts = segment.split(newlinePattern);
    
    console.log('细分后的部分:', parts);
    
    parts.forEach((part, partIndex) => {
      part = part.trim();
      if (!part) return; // 跳过空白部分
      
      // 判断是文件占位符还是文本
      const fileMatch = part.match(/^__FILE_(\d+)__$/);
      
      if (fileMatch) {
        // 这是一个文件占位符
        const fileIndex = parseInt(fileMatch[1]);
        const file = files[fileIndex];
        
        if (file) {
          console.log(`  -> 文件片段: ${file.fileName} (${file.fileType})`);
          finalSegments.push({
            type: 'file',
            file: file
          });
        }
      } else {
        // 这是文本内容
        console.log(`  -> 文本片段: "${part}"`);
        finalSegments.push({
          type: 'text',
          content: part
        });
      }
    });
  });
  
  console.log('\n=== 最终片段列表 ===');
  finalSegments.forEach((seg, i) => {
    if (seg.type === 'text') {
      console.log(`片段${i + 1}: [文本] "${seg.content}"`);
    } else {
      console.log(`片段${i + 1}: [文件] ${seg.file.fileName} (${seg.file.fileType})`);
    }
  });
  
  return finalSegments;
}

/**
 * 构建消息段（用于发送到 QQ）
 * @param {Object} segment - 消息片段
 * @returns {Array} 消息段数组
 */
function buildMessageParts(segment) {
  if (segment.type === 'text') {
    return [{ type: 'text', data: { text: segment.content } }];
  }
  
  if (segment.type === 'file') {
    const file = segment.file;
    
    // 根据文件类型返回不同的消息段
    if (file.fileType === 'image') {
      return [{ type: 'image', data: { file: file.path } }];
    } else if (file.fileType === 'video') {
      return [{ type: 'video', data: { file: file.path } }];
    } else if (file.fileType === 'record') {
      return [{ type: 'record', data: { file: file.path } }];
    } else {
      // 其他文件类型需要通过文件上传 API 发送
      return [{ type: 'file', data: { file: file.path, name: file.fileName } }];
    }
  }
  
  return [];
}

/**
 * 获取可引用的消息 ID（用于回复功能）
 * @param {Object} msg - 消息对象
 * @returns {number|null} 消息 ID
 */
function getReplyableMessageId(msg) {
  const conversationKey = msg.type === 'private' 
    ? msg.sender_id 
    : `group_${msg.group_id}_${msg.sender_id}`;
  
  const history = conversationHistory.get(conversationKey) || { 
    userMessages: [], 
    botMessages: [] 
  };
  
  // 优先引用用户的最新消息（配置概率）
  if (history.userMessages.length > 0 && Math.random() < CONFIG.preferUserMessageProbability) {
    const lastUserMsg = history.userMessages[history.userMessages.length - 1];
    return lastUserMsg.message_id;
  }
  
  // 30%概率引用机器人自己的消息
  if (history.botMessages.length > 0) {
    const lastBotMsg = history.botMessages[history.botMessages.length - 1];
    return lastBotMsg.message_id;
  }
  
  // 兜底：引用当前用户消息
  return msg.message_id;
}

/**
 * 更新对话历史记录
 * @param {Object} msg - 消息对象
 * @param {number|null} messageId - 消息 ID
 * @param {boolean} isBot - 是否为机器人消息
 */
function updateConversationHistory(msg, messageId = null, isBot = false) {
  const conversationKey = msg.type === 'private' 
    ? msg.sender_id 
    : `group_${msg.group_id}_${msg.sender_id}`;
  
  if (!conversationHistory.has(conversationKey)) {
    conversationHistory.set(conversationKey, { 
      userMessages: [], 
      botMessages: [] 
    });
  }
  
  const history = conversationHistory.get(conversationKey);
  
  if (isBot && messageId) {
    // 记录机器人消息
    history.botMessages.push({ 
      message_id: messageId, 
      timestamp: Date.now() 
    });
    
    // 只保留配置的最近N条
    if (history.botMessages.length > CONFIG.botMessageHistoryLimit) {
      history.botMessages.shift();
    }
  } else {
    // 记录用户消息
    history.userMessages.push({ 
      message_id: msg.message_id, 
      timestamp: Date.now() 
    });
    
    // 只保留配置的最近N条
    if (history.userMessages.length > CONFIG.userMessageHistoryLimit) {
      history.userMessages.shift();
    }
  }
}

/**
 * 发送消息并等待结果
 * @param {Object} message - 要发送的消息对象
 * @returns {Promise<Object|null>} 返回结果或超时返回 null
 */
function sendAndWaitResult(message) {
  return new Promise((resolve) => {
    const requestId = message.requestId;
    
    // 10秒超时
    const timeout = setTimeout(() => {
      console.log(`请求 ${requestId} 超时`);
      ws.off('message', handler);
      resolve(null);
    }, 10000);
    
    const handler = (data) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.type === 'result' && payload.requestId === requestId) {
          clearTimeout(timeout);
          ws.off('message', handler);
          resolve(payload.ok ? payload : null);
        }
      } catch (e) {
        // 忽略解析错误
      }
    };
    
    ws.on('message', handler);
    send(message);
  });
}

/**
 * 智能发送消息（拟人化策略）
 * 严格按照 AI 回复的顺序发送：文本 -> 文件 -> 文本 -> 文件...
 * @param {Object} msg - 原始消息对象
 * @param {string} response - AI 回复内容
 */
async function smartSend(msg, response) {
  const files = parseMarkdownFiles(response);
  const segments = parseMessageSegments(response, files);
  
  console.log('\n=== 发送策略分析 ===');
  console.log('总片段数:', segments.length);
  
  if (segments.length === 0) {
    console.log('没有内容需要发送');
    return;
  }
  
  // 更新用户消息历史
  updateConversationHistory(msg);
  
  // 判断聊天类型
  const isPrivateChat = msg.type === 'private';
  const isGroupChat = msg.type === 'group';
  
  // 群聊策略：配置概率@用户
  const shouldAt = isGroupChat && Math.random() < CONFIG.groupAtProbability;
  
  // 回复策略：多片段时和单片段时使用不同的配置概率
  const replyProbability = segments.length > 1 
    ? CONFIG.multiSegmentReplyProbability 
    : CONFIG.singleSegmentReplyProbability;
  const shouldReplyFirst = Math.random() < replyProbability;
  
  // 获取要引用的消息ID
  const replyMessageId = shouldReplyFirst ? getReplyableMessageId(msg) : null;
  
  console.log(`发送策略: 共${segments.length}个片段, At用户: ${shouldAt}, 回复消息: ${shouldReplyFirst}, 引用ID: ${replyMessageId}`);
  
  // 逐片段发送（严格按照 AI 回复顺序）
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    let messageParts = buildMessageParts(segment);
    
    if (messageParts.length === 0) continue;
    
    console.log(`\n发送片段 ${i + 1}/${segments.length}:`, 
      segment.type === 'text' ? `[文本] "${segment.content}"` : `[文件] ${segment.file.fileName}`);
    
    // 第一个片段可能需要@用户（仅群聊）
    if (i === 0 && shouldAt && isGroupChat) {
      messageParts = [
        { type: 'at', data: { qq: msg.sender_id } },
        { type: 'text', data: { text: ' ' } },
        ...messageParts
      ];
    }
    
    let sentMessageId = null;
    
    // 处理文件类型的片段（需要使用文件上传API）
    if (segment.type === 'file' && segment.file.fileType === 'file') {
      console.log(`上传文件: ${segment.file.fileName}`);
      
      if (isPrivateChat) {
        await sendAndWaitResult({
          type: "sdk",
          path: "file.uploadPrivate",
          args: [msg.sender_id, segment.file.path, segment.file.fileName],
          requestId: `file-upload-private-${Date.now()}-${i}`
        });
      } else if (isGroupChat) {
        await sendAndWaitResult({
          type: "sdk",
          path: "file.uploadGroup",
          args: [msg.group_id, segment.file.path, segment.file.fileName, ""],
          requestId: `file-upload-group-${Date.now()}-${i}`
        });
      }
    } else {
      // 第一个片段可能使用回复功能
      if (i === 0 && shouldReplyFirst && replyMessageId) {
        if (isPrivateChat) {
          const result = await sendAndWaitResult({
            type: "sdk",
            path: "send.privateReply",
            args: [msg.sender_id, replyMessageId, messageParts],
            requestId: `private-reply-${Date.now()}-${i}`
          });
          sentMessageId = result?.data?.message_id;
        } else if (isGroupChat) {
          const result = await sendAndWaitResult({
            type: "sdk",
            path: "send.groupReply",
            args: [msg.group_id, replyMessageId, messageParts],
            requestId: `group-reply-${Date.now()}-${i}`
          });
          sentMessageId = result?.data?.message_id;
        }
      } else {
        // 普通发送
        if (isPrivateChat) {
          const result = await sendAndWaitResult({
            type: "sdk",
            path: "send.private",
            args: [msg.sender_id, messageParts],
            requestId: `private-${Date.now()}-${i}`
          });
          sentMessageId = result?.data?.message_id;
        } else if (isGroupChat) {
          const result = await sendAndWaitResult({
            type: "sdk",
            path: "send.group",
            args: [msg.group_id, messageParts],
            requestId: `group-${Date.now()}-${i}`
          });
          sentMessageId = result?.data?.message_id;
        }
      }
      
      // 更新机器人消息历史
      if (sentMessageId) {
        updateConversationHistory(msg, sentMessageId, true);
        console.log(`片段 ${i + 1} 发送成功，消息ID: ${sentMessageId}`);
      }
    }
    
    // 片段间随机间隔（拟人化打字速度，使用配置的范围）
    if (i < segments.length - 1) {
      const delay = CONFIG.segmentDelayMin + Math.random() * (CONFIG.segmentDelayMax - CONFIG.segmentDelayMin);
      console.log(`等待 ${Math.round(delay)}ms 后发送下一片段...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  console.log('\n=== 消息发送完成 ===');
}

// ==================== WebSocket 事件处理 ====================

ws.on('message', async (data) => {
  try {
    const payload = JSON.parse(data.toString());
    
    // 处理欢迎消息
    if (payload.type === 'welcome') {
      console.log('连接成功:', payload.message);
      return;
    }
    
    // 处理心跳响应
    if (payload.type === 'pong') {
      return;
    }
    
    // 处理服务器关闭通知
    if (payload.type === 'shutdown') {
      console.log('服务器关闭:', payload.message);
      return;
    }
    
    // 处理操作结果
    if (payload.type === 'result') {
      console.log('<< result', payload.requestId, payload.ok ? 'OK' : 'ERR', 
        payload.ok ? payload.data : payload.error);
      return;
    }
    
    // 处理接收到的消息
    if (payload.type === 'message') {
      const msg = payload.data;
      
      // 过滤：只处理特定用户的消息（如果配置了testUserId）
      if (CONFIG.testUserId && msg?.sender_id !== CONFIG.testUserId) {
        return;
      }
      
      console.log('\n=== 收到新消息 ===');
      console.log(msg);
      
      // 获取会话ID
      const conversationId = getConversationId(msg);
      
      // 立即记录到全局历史
      addToGlobalHistory(conversationId, msg, false);
      
      // 使用消息合并机制
      addMessageForMerge(conversationId, msg, async (mergedMessages) => {
        try {
          // 合并后的消息作为一个整体处理
          console.log(`\n=== 处理合并后的消息（共${mergedMessages.length}条）===`);
          
          // 添加所有合并的消息到队列
          mergedMessages.forEach(m => addMessageToQueue(conversationId, m));
          
          // 获取当前队列中的所有消息
          const queue = messageQueues.get(conversationId);
          const queuedMessages = [...queue.messages];
          
          // 检查是否达到强制回复阈值
          const shouldForceReply = queuedMessages.length >= CONFIG.messageQueueLimit;
          
          if (shouldForceReply) {
            console.log(`[强制回复] 队列已达到上限 ${CONFIG.messageQueueLimit} 条，强制处理`);
          }
          
          // 使用最后一条合并消息进行智能判断
          const lastMsg = mergedMessages[mergedMessages.length - 1];
          const needReply = shouldForceReply || await shouldReply(lastMsg, queuedMessages.slice(0, -mergedMessages.length));
          
          if (!needReply) {
            console.log('[跳过回复] 判断不需要回复，消息已加入队列');
            return;
          }
          
          console.log('[开始处理] 需要回复此消息');
          
          await processReply(conversationId, mergedMessages, lastMsg);
        } catch (error) {
          console.error('[消息合并处理] 错误:', error);
        }
      });
      
      return;
    }
  } catch (e) {
    console.error('处理消息失败:', e);
  }
});

/**
 * 处理回复逻辑（提取为独立函数）
 * @param {string} conversationId - 会话ID  
 * @param {Array} mergedMessages - 合并的消息数组
 * @param {Object} lastMsg - 最后一条消息
 */
async function processReply(conversationId, mergedMessages, lastMsg) {
  // 将回复任务添加到并发控制队列
  await replyQueueManager.addTask(async () => {
    try {
      // 获取并清空队列
      const allMessages = getAndClearQueue(conversationId);
      
      // 构建输入内容 - 考虑合并的消息
      let userInput;
      if (mergedMessages.length > 1) {
        // 多条合并消息
        const mergedText = mergedMessages.map(m =>
          `[${m.time_str}] ${m.sender_name}: ${m.text}`
        ).join('\n');
        
        if (allMessages.length > mergedMessages.length) {
          // 有更早的历史消息
          const historyMessages = allMessages.slice(0, -mergedMessages.length);
          const historyText = historyMessages.map(m => 
            `[${m.time_str}] ${m.sender_name}: ${m.text}`
          ).join('\n');
          
          userInput = `【对话历史】\n${historyText}\n\n【当前消息（用户连发${mergedMessages.length}条）】\n${mergedText}`;
          console.log(`[上下文] 包含 ${historyMessages.length} 条历史 + ${mergedMessages.length} 条合并消息`);
        } else {
          // 只有合并消息
          userInput = `【当前消息（用户连发${mergedMessages.length}条）】\n${mergedText}`;
          console.log(`[上下文] ${mergedMessages.length} 条合并消息`);
        }
      } else if (allMessages.length > 1) {
        // 单条消息但有历史
        const historyMessages = allMessages.slice(0, -1);
        const currentMessage = allMessages[allMessages.length - 1];
        
        const historyText = historyMessages.map(m => 
          `[${m.time_str}] ${m.sender_name}: ${m.text}`
        ).join('\n');
        
        userInput = `【对话历史】\n${historyText}\n\n【当前消息】\n[${currentMessage.time_str}] ${currentMessage.sender_name}: ${currentMessage.text}`;
        console.log(`[上下文] 包含 ${historyMessages.length} 条历史消息`);
      } else {
        // 只有当前消息
        userInput = lastMsg?.summary;
      }
      
      const conversation = [
        { role: 'user', content: userInput },
      ];

      // 构建system prompt - 添加全局历史记录和工具任务历史
      const globalHistoryText = getGlobalHistoryText(conversationId);
      const toolSummaryText = getToolSummaryText(conversationId);
      const systemWithHistory = system + globalHistoryText + toolSummaryText;
      
      if (globalHistoryText) {
        console.log(`[全局历史] 已添加到system prompt`);
      }
      if (toolSummaryText) {
        console.log(`[工具历史] 已添加到system prompt`);
      }

      // 构建完整的对话上下文
      let conversations = [{ role: 'system', content: systemWithHistory }];
          
          // 使用配置的阶段提示词叠加
          const overlays = {
            // 全局品牌语气（所有阶段都会前置）
            global: system,
            // 从配置加载各阶段提示词
            plan: CONFIG.overlays.plan,
            arggen: CONFIG.overlays.arggen,
            arggen_fix: CONFIG.overlays.arggen_fix,
            final_judge: CONFIG.overlays.final_judge,
            schedule_progress: CONFIG.overlays.schedule_progress,
            final_summary: CONFIG.overlays.final_summary
          };
          
          // 标记是否有工具调用
          let hasToolCall = false;
          
          // 使用 Sentra SDK 流式处理
          for await (const ev of sdk.stream({
            objective: '根据对话完成用户请求',
            conversation,
            overlays
          })) {
            console.log(ev);

            // 判断是否需要工具
            if (ev.type === 'judge') {
              if (!ev.need) {
                console.log('[工具判断] 不需要工具调用，直接生成回复');
                // 不需要工具，直接生成普通回复
                conversations.push({ role: 'user', content: userInput });
                const response = await agent.chat(conversations, CONFIG.modelName);
                
                // 检查AI生成是否失败
                if (response === null) {
                  console.warn('[AI生成] 生成失败，跳过本次回复（拟人行为）');
                  return; // 跳过本次回复
                }
                
                console.log('\n=== AI 回复（普通） ===');
                console.log(response);
                
                await smartSend(lastMsg, response);
                
                // 记录机器人回复到全局历史
                addToGlobalHistory(conversationId, { summary: response, text: response, sender_name: CONFIG.botName }, true);
                
                return;
              } else {
                console.log('[工具判断] 需要工具调用');
                hasToolCall = true;
              }
            }

            // 显示执行计划
            if (ev.type === 'plan') {
              console.log('执行计划:', ev.plan.steps);
            }
            
            // 工具调用结果处理
            if (ev.type === 'tool_result' || ev.type === 'tool_choice') {
              conversations.push({ 
                role: 'user', 
                content: `${JSON.stringify(ev)}\n\n${userInput}` 
              });
              
              // 调用 AI 生成最终回复（使用配置的模型）
              const response = await agent.chat(conversations, CONFIG.modelName);
              
              // 检查AI生成是否失败
              if (response === null) {
                console.warn('[AI生成] 生成失败，跳过本次回复（拟人行为）');
                return; // 跳过本次回复
              }
              
              console.log('\n=== AI 回复（工具） ===');
              console.log(response);
              
              // 使用智能发送（严格按照 AI 回复顺序）
              await smartSend(lastMsg, response);
              
              // 记录机器人回复到全局历史
              addToGlobalHistory(conversationId, { summary: response, text: response, sender_name: CONFIG.botName }, true);
              
              conversations.push({ role: 'assistant', content: response });
            }
            
            // 对话总结
            if (ev.type === 'summary') {
              console.log('对话总结:', ev.summary);
              
              // 记录工具任务总结到历史
              if (ev.summary) {
                addToolSummary(conversationId, ev.runId, ev.summary);
              }
              
              break;
            }
          }
        } catch (error) {
          console.error('[回复任务] 处理失败:', error);
          // 如果配置了跳过失败，不抛出错误
          if (CONFIG.skipOnGenerationFail) {
            console.warn('[回复任务] 跳过失败的回复任务（拟人行为）');
            return;
          }
          throw error;
        }
      });
}

ws.on('open', () => {
  console.log('WebSocket 连接已建立');
});

ws.on('error', (error) => {
  console.error('WebSocket 错误:', error);
});

ws.on('close', () => {
  console.log('WebSocket 连接已关闭');
});
