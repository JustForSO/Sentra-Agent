import SentraMcpSDK from 'sentra-mcp';
import SentraPromptsSDK from 'sentra-prompts';
import { Agent } from "../agent.js";
import { tokenCounter } from "../src/token-counter.js";
import { randomUUID } from 'crypto';
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
  // 使用 127.0.0.1 而不是 localhost，避免IPv6解析问题
  wsUrl: process.env.WS_URL || 'ws://127.0.0.1:6702',
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
  
  // 对话历史记录配置（标准多轮格式）
  maxConversationPairs: parseInt(process.env.MAX_CONVERSATION_PAIRS || '20'),
  
  // 机器人配置
  botName: process.env.BOT_NAME || '助手',
  botAliases: (process.env.BOT_ALIASES || '').split(',').map(s => s.trim()).filter(s => s),
  
  // 智能回复判断配置
  enableSmartReply: process.env.ENABLE_SMART_REPLY === 'true',
  judgeTimeout: parseInt(process.env.JUDGE_TIMEOUT || '5000'),
  judgeModel: process.env.JUDGES_MODEL || 'gpt-4o-mini',
  
  // 回复欲望系统配置
  replyDesireThreshold: parseFloat(process.env.REPLY_DESIRE_THRESHOLD || '0.6'),
  replyDesireDecayRate: parseFloat(process.env.REPLY_DESIRE_DECAY_RATE || '0.1'),
  replyDesireBoostPerMessage: parseFloat(process.env.REPLY_DESIRE_BOOST_PER_MESSAGE || '0.15'),
  minReplyInterval: parseInt(process.env.MIN_REPLY_INTERVAL || '10000'),
  
  // 回复队列并发控制配置
  replyConcurrency: parseInt(process.env.REPLY_CONCURRENCY || '1'),
  replyCooldown: parseInt(process.env.REPLY_COOLDOWN || '2000'),
  skipOnGenerationFail: process.env.SKIP_ON_GENERATION_FAIL === 'true',
  
  // Token限制配置
  maxResponseTokens: parseInt(process.env.MAX_RESPONSE_TOKENS || '260'), // 普通回复最大token数
  
  // 消息合并CD配置
  messageMergeDelay: parseInt(process.env.MESSAGE_MERGE_DELAY || '5000'),
  enableMessageMerge: process.env.ENABLE_MESSAGE_MERGE !== 'false',
  
  // 消息队列时效配置
  messageMaxAge: parseInt(process.env.MESSAGE_MAX_AGE || '300000'), // 默认5分钟（300000ms）
  
  // 路径映射配置（用于Docker容器环境）
  pathMappings: (process.env.PATH_MAPPINGS || '').split(';').filter(s => s).map(mapping => {
    const [host, container] = mapping.split('->');
    return host && container ? {
      host: host.trim().replace(/\\/g, '/'),
      container: container.trim()
    } : null;
  }).filter(m => m),
  
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
console.log('Max Response Tokens (普通回复):', CONFIG.maxResponseTokens);
console.log('段落分隔符:', CONFIG.paragraphSeparator);
console.log('机器人名称:', CONFIG.botName);
console.log('智能回复:', CONFIG.enableSmartReply ? '开启' : '关闭');
console.log('判断模型:', CONFIG.judgeModel);
console.log('回复欲望阈值:', CONFIG.replyDesireThreshold);
console.log('最小回复间隔:', CONFIG.minReplyInterval + 'ms');
console.log('对话历史限制:', CONFIG.maxConversationPairs + '组对话');
console.log('回复并发数:', CONFIG.replyConcurrency);
console.log('回复冷却时间:', CONFIG.replyCooldown + 'ms');
console.log('失败跳过:', CONFIG.skipOnGenerationFail ? '是' : '否');
console.log('消息合并:', CONFIG.enableMessageMerge ? `开启(${CONFIG.messageMergeDelay}ms)` : '关闭');
console.log('消息时效:', `${CONFIG.messageMaxAge / 1000}秒`);
if (CONFIG.pathMappings.length > 0) {
  console.log('路径映射:', `已配置${CONFIG.pathMappings.length}条规则`);
  CONFIG.pathMappings.forEach((m, i) => {
    console.log(`  规则${i + 1}: ${m.host} -> ${m.container}`);
  });
} else {
  console.log('路径映射:', '未配置（使用原始路径）');
}
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

// ==================== 对话历史管理系统（标准多轮格式） ====================

/**
 * 对话历史存储（标准多轮对话格式 + UUID标记）
 * Map<conversationId, { 
 *   conversations: [{ role, content, pairId }],  // 历史对话对（每对有相同的pairId）
 *   pendingMessages: [{ summary, msgObj }],  // 当前累积的待回复消息
 *   currentAssistantMessage: string,  // 当前正在构建的助手回复
 *   currentPairId: string | null,  // 当前对话对的UUID
 *   replyDesire: number,  // 回复欲望值（0-1）
 *   lastReplyTime: number  // 上次回复时间戳（0表示从未回复）
 * }>
 */
const conversationHistories = new Map();

/**
 * 添加待回复消息
 * @param {string} conversationId - 会话ID
 * @param {string} summary - 消息摘要
 * @param {Object} msgObj - 原始消息对象
 */
function addPendingMessage(conversationId, summary, msgObj) {
  if (!conversationHistories.has(conversationId)) {
    conversationHistories.set(conversationId, {
      conversations: [],
      pendingMessages: [],
      currentAssistantMessage: '',
      currentPairId: null,
      replyDesire: 0,
      lastReplyTime: 0  // 初始化为0，表示从未回复过
    });
  }
  
  const history = conversationHistories.get(conversationId);
  history.pendingMessages.push({ summary, msgObj });
  
  console.log(`[待回复消息] ${conversationId} 累积消息（sender: ${msgObj.sender_id}），当前 ${history.pendingMessages.length} 条待回复`);
}

/**
 * 获取并组合所有待回复消息为一个user content
 * @param {string} conversationId - 会话ID
 * @returns {string} 组合后的user消息内容
 */
function getPendingMessagesContent(conversationId) {
  if (!conversationHistories.has(conversationId)) {
    return '';
  }
  
  const history = conversationHistories.get(conversationId);
  if (history.pendingMessages.length === 0) {
    return '';
  }
  
  // 将所有待回复消息的summary组合成一个content
  return history.pendingMessages.map(pm => pm.summary).join('\n\n');
}

/**
 * 格式化待回复消息，区分历史上下文和当前需要回复的消息
 * @param {string} conversationId - 会话ID
 * @param {string} targetSenderId - 当前需要回复的发送者ID
 * @returns {{formatted: string, objective: string, hasContext: boolean, targetMsg: Object}}
 */
function formatPendingMessagesForAI(conversationId, targetSenderId) {
  if (!conversationHistories.has(conversationId)) {
    return { formatted: '', objective: '完成用户请求', hasContext: false, targetMsg: null };
  }
  
  const history = conversationHistories.get(conversationId);
  if (history.pendingMessages.length === 0) {
    return { formatted: '', objective: '完成用户请求', hasContext: false, targetMsg: null };
  }
  
  // 找到目标sender的最后一条消息
  let targetMsgIndex = -1;
  for (let i = history.pendingMessages.length - 1; i >= 0; i--) {
    if (history.pendingMessages[i].msgObj.sender_id === targetSenderId) {
      targetMsgIndex = i;
      break;
    }
  }
  
  // 如果没找到目标消息，使用最后一条
  if (targetMsgIndex === -1) {
    targetMsgIndex = history.pendingMessages.length - 1;
  }
  
  const targetMsg = history.pendingMessages[targetMsgIndex];
  const contextMessages = history.pendingMessages.slice(0, targetMsgIndex);
  
  // 构建格式化内容
  let formatted = '';
  
  // 如果有历史上下文消息，先添加它们
  if (contextMessages.length > 0) {
    formatted += '【近期对话上下文】\n';
    formatted += contextMessages.map(pm => pm.summary).join('\n') + '\n\n';
  }
  
  // 添加当前需要回复的消息
  formatted += '【当前需要回复的消息】\n';
  formatted += targetMsg.summary;
  
  // 提取简洁的objective（只用消息文本，不要时间戳等）
  const objective = targetMsg.msgObj.text || targetMsg.msgObj.summary || '完成用户请求';
  
  return {
    formatted,
    objective,
    hasContext: contextMessages.length > 0,
    targetMsg: targetMsg.msgObj  // 返回目标消息对象，用于正确引用回复
  };
}

/**
 * 查找指定sender的最后一条消息（用于引用回复）
 * @param {string} conversationId - 会话ID
 * @param {string} senderId - 发送者ID
 * @returns {Object|null} 消息对象或null
 */
function findLastMessageBySender(conversationId, senderId) {
  if (!conversationHistories.has(conversationId)) {
    return null;
  }
  
  const history = conversationHistories.get(conversationId);
  
  // 从后往前查找该sender的消息
  for (let i = history.pendingMessages.length - 1; i >= 0; i--) {
    const pm = history.pendingMessages[i];
    if (pm.msgObj.sender_id === senderId) {
      console.log(`[引用查找] ${conversationId} 找到sender ${senderId} 的最后一条消息: ${pm.msgObj.message_id}`);
      return pm.msgObj;
    }
  }
  
  console.warn(`[引用查找] ${conversationId} 未找到sender ${senderId} 的消息`);
  return null;
}

/**
 * 开始构建助手回复（生成UUID标记本次对话对）
 * @param {string} conversationId - 会话ID
 * @returns {string} 本次对话对的UUID
 */
function startAssistantMessage(conversationId) {
  if (!conversationHistories.has(conversationId)) {
    conversationHistories.set(conversationId, {
      conversations: [],
      pendingMessages: [],
      currentAssistantMessage: '',
      currentPairId: null,
      replyDesire: 0,
      lastReplyTime: 0
    });
  }
  
  const history = conversationHistories.get(conversationId);
  history.currentAssistantMessage = '';
  // 生成本次对话对的UUID
  history.currentPairId = randomUUID();
  
  console.log(`[对话对UUID] ${conversationId} 生成新对话对ID: ${history.currentPairId}`);
  return history.currentPairId;
}

/**
 * 追加内容到当前助手消息
 * @param {string} conversationId - 会话ID
 * @param {string} content - 要追加的内容
 */
function appendToAssistantMessage(conversationId, content) {
  if (!conversationHistories.has(conversationId)) {
    return;
  }
  
  const history = conversationHistories.get(conversationId);
  if (history.currentAssistantMessage) {
    history.currentAssistantMessage += '\n' + content;
  } else {
    history.currentAssistantMessage = content;
  }
}

/**
 * 完成当前对话对，保存到历史（使用UUID标记）
 * @param {string} conversationId - 会话ID
 */
function finishConversationPair(conversationId) {
  if (!conversationHistories.has(conversationId)) {
    return;
  }
  
  const history = conversationHistories.get(conversationId);
  
  // 组合所有待回复消息作为user content
  const userContent = history.pendingMessages.map(pm => pm.summary).join('\n\n');
  
  // 确保有用户消息、助手消息和pairId
  if (userContent && history.currentAssistantMessage && history.currentPairId) {
    const pairId = history.currentPairId;
    
    // 添加完整的user/assistant对话对（都标记相同的pairId）
    history.conversations.push(
      { role: 'user', content: userContent, pairId },
      { role: 'assistant', content: history.currentAssistantMessage, pairId }
    );
    
    // 保持最多N组对话（2N条消息）
    const maxMessages = CONFIG.maxConversationPairs * 2;
    while (history.conversations.length > maxMessages) {
      history.conversations.shift();
      history.conversations.shift();  // 删除一对
    }
    
    const pairCount = history.conversations.length / 2;
    const messageCount = history.pendingMessages.length;
    console.log(`[对话历史] ${conversationId} 完成对话对(${pairId.substring(0, 8)})（user包含${messageCount}条消息），当前 ${pairCount}/${CONFIG.maxConversationPairs} 组`);
    
    // 清空待回复消息、当前助手消息和pairId
    history.pendingMessages = [];
    history.currentAssistantMessage = '';
    history.currentPairId = null;
  } else if (!userContent) {
    console.warn(`[对话历史] ${conversationId} 没有待回复消息，跳过保存`);
  } else if (!history.currentPairId) {
    console.warn(`[对话历史] ${conversationId} 没有pairId，跳过保存`);
  }
}

/**
 * 撤销指定的对话对（通过pairId精确删除，适合高并发场景）
 * 
 * 使用场景：
 * 1. Token超限时，如果对话对已经保存到conversationHistory，需要撤销
 * 2. 发送失败需要回滚已保存的对话对
 * 3. 高并发场景下，需要精确删除某个特定的对话对
 * 
 * @param {string} conversationId - 会话ID
 * @param {string} pairId - 要删除的对话对UUID
 * @returns {boolean} 是否删除成功
 * 
 * @example
 * // 保存对话对后发现需要撤销
 * const pairId = startAssistantMessage(conversationId);
 * finishConversationPair(conversationId);
 * // ... 某些检查失败，需要撤销
 * cancelConversationPairById(conversationId, pairId);
 */
function cancelConversationPairById(conversationId, pairId) {
  if (!conversationHistories.has(conversationId)) {
    return false;
  }
  
  const history = conversationHistories.get(conversationId);
  
  // 找到并删除所有带有此pairId的消息
  const initialLength = history.conversations.length;
  history.conversations = history.conversations.filter(msg => msg.pairId !== pairId);
  const deletedCount = initialLength - history.conversations.length;
  
  if (deletedCount > 0) {
    console.log(`[对话历史] ${conversationId} 精确删除对话对(${pairId.substring(0, 8)})，删除 ${deletedCount} 条消息`);
    
    // 如果删除的是当前正在构建的对话对，清空状态
    if (history.currentPairId === pairId) {
      history.currentAssistantMessage = '';
      history.currentPairId = null;
      console.log(`[对话历史] ${conversationId} 清空当前构建中的对话对`);
    }
    
    return true;
  }
  
  console.warn(`[对话历史] ${conversationId} 未找到pairId(${pairId.substring(0, 8)})，无法删除`);
  return false;
}

/**
 * 获取完整的对话历史数组（用于API请求）
 * @param {string} conversationId - 会话ID
 * @returns {Array} 对话历史数组 [{ role, content }, ...]（不包含pairId）
 */
function getConversationHistory(conversationId) {
  if (!conversationHistories.has(conversationId)) {
    return [];
  }
  
  const history = conversationHistories.get(conversationId);
  // 返回副本，去除pairId字段（API不需要）
  return history.conversations.map(({ role, content }) => ({ role, content }));
}

/**
 * 更新回复欲望值
 * @param {string} conversationId - 会话ID
 * @param {number} boost - 增加的欲望值
 */
function updateReplyDesire(conversationId, boost = CONFIG.replyDesireBoostPerMessage) {
  if (!conversationHistories.has(conversationId)) {
    conversationHistories.set(conversationId, {
      conversations: [],
      pendingMessages: [],
      currentAssistantMessage: '',
      currentPairId: null,
      lastReplyTime: 0,
      replyDesire: 0
    });
  }
  
  const history = conversationHistories.get(conversationId);
  const now = Date.now();
  
  // 基于时间的自然衰减
  if (history.lastReplyTime > 0) {
    const timeSinceReply = now - history.lastReplyTime;
    const decayFactor = Math.min(1, timeSinceReply / 60000); // 1分钟内线性衰减
    history.replyDesire = Math.max(0, history.replyDesire - CONFIG.replyDesireDecayRate * decayFactor);
  }
  
  // 增加欲望值
  history.replyDesire = Math.min(1, history.replyDesire + boost);
  
  console.log(`[回复欲望] ${conversationId} 当前欲望值: ${(history.replyDesire * 100).toFixed(1)}% (阈值: ${(CONFIG.replyDesireThreshold * 100).toFixed(0)}%)`);
  
  return history.replyDesire;
}

/**
 * 重置回复欲望值（回复后调用）
 * @param {string} conversationId - 会话ID
 */
function resetReplyDesire(conversationId) {
  if (conversationHistories.has(conversationId)) {
    const history = conversationHistories.get(conversationId);
    history.replyDesire = 0;
    history.lastReplyTime = Date.now();
    console.log(`[回复欲望] ${conversationId} 已重置`);
  }
}

/**
 * 检查是否超过最小回复间隔
 * @param {string} conversationId - 会话ID
 * @returns {boolean} 是否可以回复
 */
function canReplyByInterval(conversationId) {
  if (!conversationHistories.has(conversationId)) {
    return true;  // 从未创建过，可以回复
  }
  
  const history = conversationHistories.get(conversationId);
  // 检查lastReplyTime是否存在且有效（0、undefined、null都表示从未回复）
  if (!history.lastReplyTime || history.lastReplyTime === 0) {
    console.log(`[回复间隔] ${conversationId} 首次回复，无需等待`);
    return true;
  }
  
  const timeSinceReply = Date.now() - history.lastReplyTime;
  const canReply = timeSinceReply >= CONFIG.minReplyInterval;
  
  if (!canReply) {
    const remaining = CONFIG.minReplyInterval - timeSinceReply;
    console.log(`[回复间隔] ${conversationId} 距离上次回复 ${(timeSinceReply / 1000).toFixed(1)}秒，还需等待 ${(remaining / 1000).toFixed(1)}秒`);
  } else {
    console.log(`[回复间隔] ${conversationId} 距离上次回复 ${(timeSinceReply / 1000).toFixed(1)}秒，可以回复`);
  }
  
  return canReply;
}

// 消息队列管理（用于智能回复判断）
// key: conversationId (U:userId 或 G:groupId)
// value: { messages: [], lastProcessTime: timestamp }
const messageQueues = new Map();

// ==================== 回复去重管理（防止同时回复同一人） ====================

/**
 * 正在回复的发送者集合
 * key: conversationId (G:groupId 或 U:userId)
 * value: Set<sender_id> 正在回复的发送者ID集合
 */
const replyingSenders = new Map();

/**
 * 检查是否正在回复该发送者
 * @param {string} conversationId - 会话ID
 * @param {string} senderId - 发送者ID
 * @returns {boolean} 是否正在回复
 */
function isReplyingToSender(conversationId, senderId) {
  if (!replyingSenders.has(conversationId)) {
    return false;
  }
  return replyingSenders.get(conversationId).has(senderId);
}

/**
 * 标记开始回复某个发送者
 * @param {string} conversationId - 会话ID
 * @param {string} senderId - 发送者ID
 */
function markReplyingToSender(conversationId, senderId) {
  if (!replyingSenders.has(conversationId)) {
    replyingSenders.set(conversationId, new Set());
  }
  replyingSenders.get(conversationId).add(senderId);
  console.log(`[回复去重] ${conversationId} 开始回复发送者 ${senderId}`);
}

/**
 * 标记完成回复某个发送者
 * @param {string} conversationId - 会话ID
 * @param {string} senderId - 发送者ID
 */
function unmarkReplyingToSender(conversationId, senderId) {
  if (replyingSenders.has(conversationId)) {
    replyingSenders.get(conversationId).delete(senderId);
    console.log(`[回复去重] ${conversationId} 完成回复发送者 ${senderId}`);
  }
}

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
 * 删除最后N条全局历史记录
 * @param {string} conversationId - 会话ID
 * @param {number} count - 要删除的数量
 */
function removeLastGlobalHistory(conversationId, count = 1) {
  if (!globalHistory.has(conversationId)) {
    return;
  }
  
  const history = globalHistory.get(conversationId);
  const removed = history.splice(-count, count);
  
  console.log(`[全局历史] ${conversationId} 删除最后 ${removed.length} 条记录，剩余 ${history.length} 条`);
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
  
  // 记录消息加入队列的时间（用于过期过滤）
  // 注意：这里使用当前时间而非msg.time，因为msg.time是用户发送的时间
  // 我们应该基于消息进入队列的时间来判断是否过期，而不是用户发送的时间
  const queuedAt = Date.now();
  
  queue.messages.push({
    text: msg.text,
    summary: msg.summary,
    sender_id: msg.sender_id,
    sender_name: msg.sender_name,
    time: msg.time, // 原始发送时间（用于显示）
    time_str: msg.time_str,
    queuedAt: queuedAt // 加入队列的时间（用于过期判断）
  });
  
  // 只保留最近的消息（配置的限制）
  if (queue.messages.length > CONFIG.messageQueueLimit) {
    queue.messages.shift();
  }
  
  console.log(`[消息队列] ${conversationId} 当前队列长度: ${queue.messages.length}/${CONFIG.messageQueueLimit}`);
}

/**
 * 获取并清空消息队列（仅返回未过期的消息）
 * @param {string} conversationId - 会话ID
 * @returns {Array} 队列中的有效消息
 */
function getAndClearQueue(conversationId) {
  if (!messageQueues.has(conversationId)) {
    return [];
  }
  
  const queue = messageQueues.get(conversationId);
  const now = Date.now();
  
  // 过滤掉过期的消息（基于消息加入队列的时间，而非用户发送时间）
  const validMessages = queue.messages.filter(msg => {
    const messageAge = now - (msg.queuedAt || now);
    return messageAge <= CONFIG.messageMaxAge;
  });
  
  // 统计过滤情况
  const expiredCount = queue.messages.length - validMessages.length;
  if (expiredCount > 0) {
    console.log(`[队列过滤] ${conversationId} 过滤掉 ${expiredCount} 条过期消息（在队列中超过${CONFIG.messageMaxAge / 1000}秒）`);
  }
  
  queue.messages = [];
  queue.lastProcessTime = now;
  
  console.log(`[队列清空] ${conversationId} 返回 ${validMessages.length} 条有效消息`);
  return validMessages;
}

/**
 * 智能判断是否需要回复（新系统：使用回复欲望机制）
 * @param {Object} msg - 最后一条消息对象（用于基本判断）
 * @param {string} conversationId - 会话ID
 * @param {Array} mergedMessages - 合并后的所有消息数组
 * @returns {Promise<{needReply: boolean, reason: string, mandatory: boolean}>} 判断结果
 */
async function shouldReply(msg, conversationId, mergedMessages = [msg]) {
  // 如果禁用智能回复，总是回复
  if (!CONFIG.enableSmartReply) {
    return { needReply: true, reason: '智能回复已禁用', mandatory: false };
  }
  
  // 私聊默认总是回复
  if (msg.type === 'private') {
    console.log('[智能判断] 私聊消息，必须回复');
    return { needReply: true, reason: '私聊消息', mandatory: true };
  }
  
  // ===== 强制回复条件：明确@了机器人 =====
  const isExplicitMention = msg.at_users?.some(at => at === msg.self_id);
  
  if (isExplicitMention) {
    console.log('[智能判断] ✓ 明确@机器人，必须回复');
    return { needReply: true, reason: '被明确@提及', mandatory: true };
  }
  
  // ===== 检查回复间隔 =====
  if (!canReplyByInterval(conversationId)) {
    console.log('[智能判断] ✗ 回复间隔不足，跳过本次判断');
    // 更新欲望值但不回复
    updateReplyDesire(conversationId);
    return { needReply: false, reason: '回复间隔不足', mandatory: false };
  }

  // ===== 使用AI判断是否需要回复 =====
  // 构建合并消息的完整上下文
  let messagesContext = '';
  if (mergedMessages.length > 1) {
    console.log(`[智能判断] 综合考虑 ${mergedMessages.length} 条合并消息进行判断`);
    messagesContext = '合并消息（按时间顺序）：\n' + 
      mergedMessages.map((m, i) => 
        `${i + 1}. [${m.time_str}] ${m.sender_name}: ${m.text || m.summary}`
      ).join('\n');
  } else {
    messagesContext = `当前消息：\n发送者：${msg.sender_name}\n内容：${msg.text || msg.summary}`;
  }
  
  const judgePrompt = `你是群聊机器人“${CONFIG.botName}”。请判断以下消息是否需要你回复。

判断标准：
1. 如果消息是向你提问、求助或需要你的参与，需要回复
2. 如果消息是闲聊内容且与你高度相关，可以适当参与
3. 如果消息是群友之间的对话，与你无关，不需要回复
4. 如果消息内容简短且无意义（如单个表情、“。”等），不需要回复
5. 综合考虑所有合并消息的上下文，判断是否需要回复

${messagesContext}`;

  try {
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
                  description: "是否需要回复"
                },
                reason: {
                  type: "string",
                  description: "判断的详细理由"
                },
                confidence: {
                  type: "number",
                  description: "判断的置信度，范围0.0-1.0",
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
    
    if (!judgeResponse || typeof judgeResponse.should_reply === 'undefined') {
      console.warn('[智能判断] 无效的判断结果，默认不回复');
      return { needReply: false, reason: '判断失败', mandatory: false };
    }
    
    const aiSaysReply = judgeResponse.should_reply !== false;
    const reason = judgeResponse.reason || '未知原因';
    const confidence = judgeResponse.confidence || 0.5;
    
    console.log(`[智能判断] AI判断: ${aiSaysReply ? '需要回复' : '不需要回复'}`);
    console.log(`[智能判断] 理由: ${reason}`);
    console.log(`[智能判断] 置信度: ${(confidence * 100).toFixed(1)}%`);
    
    // ===== 回复欲望系统 =====
    // AI判断需要回复时，给予更大的欲望增量
    const desireBoost = aiSaysReply 
      ? CONFIG.replyDesireBoostPerMessage * 1.5 
      : CONFIG.replyDesireBoostPerMessage * 0.5;
    
    const currentDesire = updateReplyDesire(conversationId, desireBoost);
    
    // 判断是否达到回复阈值
    const reachedThreshold = currentDesire >= CONFIG.replyDesireThreshold;
    
    if (aiSaysReply && reachedThreshold) {
      console.log(`[智能判断] ✓ AI建议回复 且 欲望值达标，决定回复`);
      return { needReply: true, reason: `AI建议回复(${reason})，欲望值达标`, mandatory: false };
    } else if (aiSaysReply && !reachedThreshold) {
      console.log(`[智能判断] ~ AI建议回复 但 欲望值不足，暂不回复`);
      return { needReply: false, reason: `AI建议回复但欲望值不足(${(currentDesire * 100).toFixed(1)}%)`, mandatory: false };
    } else {
      console.log(`[智能判断] ✗ AI不建议回复，累积欲望值`);
      return { needReply: false, reason: `AI不建议回复(${reason})`, mandatory: false };
    }
    
  } catch (error) {
    console.error('[智能判断] 判断失败:', error.message);
    // 失败时也更新欲望值
    updateReplyDesire(conversationId, CONFIG.replyDesireBoostPerMessage * 0.3);
    return { needReply: false, reason: '判断异常', mandatory: false };
  }
}

/**
 * 转换文件路径（支持宿主机到容器的路径映射）
 * 用于Docker容器环境，将宿主机路径转换为容器内路径
 * @param {string} filePath - 原始文件路径
 * @returns {string} 转换后的路径
 */
function convertFilePath(filePath) {
  if (!filePath || CONFIG.pathMappings.length === 0) {
    return filePath;
  }
  
  // 规范化路径分隔符为正斜杠
  let normalizedPath = filePath.replace(/\\/g, '/');
  
  // 尝试匹配每个路径映射规则
  for (const mapping of CONFIG.pathMappings) {
    // 检查路径是否以宿主机路径开头（不区分大小写）
    const hostPath = mapping.host.toLowerCase();
    const checkPath = normalizedPath.toLowerCase();
    
    if (checkPath.startsWith(hostPath)) {
      // 替换路径前缀
      const relativePath = normalizedPath.substring(mapping.host.length);
      const convertedPath = mapping.container + relativePath;
      
      console.log(`[路径转换] ${filePath}`);
      console.log(`[路径转换] -> ${convertedPath}`);
      
      return convertedPath;
    }
  }
  
  // 没有匹配的规则，返回原路径
  console.log(`[路径转换] 未找到映射规则，使用原始路径: ${filePath}`);
  return normalizedPath;
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
    
    // 应用路径转换（支持Docker容器环境）
    const convertedPath = convertFilePath(file.path);
    
    // 根据文件类型返回不同的消息段
    if (file.fileType === 'image') {
      return [{ type: 'image', data: { file: convertedPath } }];
    } else if (file.fileType === 'video') {
      return [{ type: 'video', data: { file: convertedPath } }];
    } else if (file.fileType === 'record') {
      return [{ type: 'record', data: { file: convertedPath } }];
    } else {
      // 其他文件类型需要通过文件上传 API 发送
      return [{ type: 'file', data: { file: convertedPath, name: file.fileName } }];
    }
  }
  
  return [];
}

/**
 * 获取可引用的消息 ID（用于回复功能）
 * 确保引用的是正确发送者的消息
 * @param {Object} msg - 消息对象（必须是要引用的正确发送者的消息）
 * @returns {number|null} 消息 ID
 */
function getReplyableMessageId(msg) {
  if (!msg || !msg.message_id) {
    console.warn('[引用消息] 消息对象无效或缺少message_id');
    return null;
  }
  
  // 返回消息ID，用于引用回复
  console.log(`[引用消息] 使用消息 ${msg.message_id} (sender: ${msg.sender_id})`);
  return msg.message_id;
}

// 旧的历史记录函数已移除，使用新的 addToConversationHistory() 替代

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
      
      // 应用路径转换（支持Docker容器环境）
      const convertedPath = convertFilePath(segment.file.path);
      
      if (isPrivateChat) {
        await sendAndWaitResult({
          type: "sdk",
          path: "file.uploadPrivate",
          args: [msg.sender_id, convertedPath, segment.file.fileName],
          requestId: `file-upload-private-${Date.now()}-${i}`
        });
      } else if (isGroupChat) {
        await sendAndWaitResult({
          type: "sdk",
          path: "file.uploadGroup",
          args: [msg.group_id, convertedPath, segment.file.fileName, ""],
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
      
      if (sentMessageId) {
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
      const isGroupChat = msg.type === 'group';
      
      // 累积待回复消息（使用summary，已包含时间信息，同时保存完整消息对象）
      addPendingMessage(conversationId, msg.summary, msg);
      
      // 也记录到全局历史（用于system prompt）
      addToGlobalHistory(conversationId, msg, false);
      
      // 使用消息合并机制
      addMessageForMerge(conversationId, msg, async (mergedMessages) => {
        try {
          console.log(`\n=== 处理合并后的消息（共${mergedMessages.length}条）===`);
          
          // 使用最后一条消息和所有合并消息进行智能判断
          const lastMsg = mergedMessages[mergedMessages.length - 1];
          const senderId = lastMsg.sender_id;
          
          const replyDecision = await shouldReply(lastMsg, conversationId, mergedMessages);
          
          if (!replyDecision.needReply) {
            console.log(`[跳过回复] ${replyDecision.reason}`);
            return;
          }
          
          // 检查是否正在回复该发送者（防止重复回复）
          if (isReplyingToSender(conversationId, senderId)) {
            console.log(`[回复去重] 已有任务正在回复发送者 ${senderId}，本次静默保存（不发送消息）`);
            await processReply(conversationId, mergedMessages, lastMsg, isGroupChat, senderId, true); // silentMode = true
            return;
          }
          
          console.log(`[开始处理] ${replyDecision.reason}${replyDecision.mandatory ? '（强制）' : ''}`);
          
          await processReply(conversationId, mergedMessages, lastMsg, isGroupChat, senderId, false); // silentMode = false
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
 * 处理回复逻辑（标准多轮对话格式）
 * @param {string} conversationId - 会话ID  
 * @param {Array} mergedMessages - 合并的消息数组
 * @param {Object} lastMsg - 最后一条消息
 * @param {boolean} isGroupChat - 是否为群聊
 * @param {string} senderId - 发送者ID
 * @param {boolean} silentMode - 静默模式（只保存历史，不发送消息）
 */
async function processReply(conversationId, mergedMessages, lastMsg, isGroupChat, senderId, silentMode = false) {
  // 将回复任务添加到并发控制队列
  await replyQueueManager.addTask(async () => {
    try {
      // 静默模式：直接保存对话对，不发送消息
      if (silentMode) {
        console.log(`[静默处理] ${conversationId} 发送者 ${senderId} - 只保存历史，不发送消息`);
        
        // 构建一个虚拟的助手回复
        startAssistantMessage(conversationId);
        appendToAssistantMessage(conversationId, '[已被其他回复任务覆盖，未实际发送]');
        finishConversationPair(conversationId);
        
        console.log(`[静默处理] ${conversationId} 完成保存`);
        return;
      }
      
      // 标记开始回复该发送者
      markReplyingToSender(conversationId, senderId);
      
      // 开始构建助手回复（获取本次对话对的UUID）
      const currentPairId = startAssistantMessage(conversationId);
      
      // 获取历史对话对（最多20组）
      const historyConversations = getConversationHistory(conversationId);
      const pairCount = historyConversations.length / 2;
      console.log(`[对话历史] 加载 ${pairCount} 组历史对话`);
      
      // 格式化待回复消息：区分历史上下文和当前消息
      const pendingFormatted = formatPendingMessagesForAI(conversationId, senderId);
      if (!pendingFormatted.formatted) {
        console.warn('[对话构建] 没有待回复消息，跳过回复');
        unmarkReplyingToSender(conversationId, senderId);
        return;
      }
      
      console.log(`[消息格式化] ${pendingFormatted.hasContext ? '包含上下文' : '无上下文'}，objective: ${pendingFormatted.objective.substring(0, 50)}...`);
      console.log(`[引用消息] 将引用消息ID: ${pendingFormatted.targetMsg?.message_id}, sender: ${pendingFormatted.targetMsg?.sender_id}`);
      
      // 构建system prompt
      const globalHistoryText = getGlobalHistoryText(conversationId);
      const toolSummaryText = getToolSummaryText(conversationId);
      const chatType = isGroupChat ? '群聊' : '私聊';
      
      const systemPrompt = system + globalHistoryText + toolSummaryText + 
        `\n\n【重要提示】你正在参与${chatType}对话，请结合历史对话记录理解上下文，保持回复连贯性，避免重复回答。`;
      
      // 构建完整的对话上下文：system + 历史对话对 + 格式化后的待回复消息
      let conversations = [
        { role: 'system', content: systemPrompt },
        ...historyConversations,  // 历史对话对（最多20组）
        { role: 'user', content: pendingFormatted.formatted }  // 格式化后的待回复消息（区分上下文和当前消息）
      ];
      
      const history = conversationHistories.get(conversationId);
      const pendingCount = history.pendingMessages.length;
      console.log(`[对话构建] system(1) + 历史对话(${historyConversations.length}) + 待回复消息(${pendingCount}条) = 总共${conversations.length}条`);
          
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
          
          // 使用提取的简洁objective（只包含核心消息文本）
          const objective = pendingFormatted.objective;
          console.log(`[Objective] ${objective.substring(0, 100)}${objective.length > 100 ? '...' : ''}`);
          
          // 使用 Sentra SDK 流式处理
          for await (const ev of sdk.stream({
            objective,
            conversation: conversations,
            overlays
          })) {
            console.log(ev);

            // 判断是否需要工具
            if (ev.type === 'judge') {
              if (!ev.need) {
                console.log('[工具判断] 不需要工具调用，直接生成回复');
                // 不需要工具，直接生成普通回复
                // conversations包含：system + 历史对话 + 格式化的待回复消息
                const response = await agent.chat(conversations, CONFIG.modelName);
                
                // 检查AI生成是否失败
                if (response === null) {
                  console.warn('[AI生成] 生成失败，跳过本次回复（拟人行为）');
                  unmarkReplyingToSender(conversationId, senderId);
                  return; // 跳过本次回复
                }
                
                console.log('\n=== AI 回复（普通） ===');
                console.log(response);
                
                // Token超限检查：如果响应超过限制，跳过发送
                const responseTokens = tokenCounter.countTokens(response, CONFIG.modelName);
                console.log(`[Token检查] 响应token数: ${responseTokens}/${CONFIG.maxResponseTokens}`);
                
                if (responseTokens > CONFIG.maxResponseTokens) {
                  console.warn(`[Token超限] 响应token数(${responseTokens})超过限制(${CONFIG.maxResponseTokens})，跳过发送并清理对话对(${currentPairId.substring(0, 8)})`);
                  
                  // 使用pairId精确清理本次对话对（高并发场景安全）
                  // 注意：此时对话对还没有保存到conversationHistory，所以只需清理状态
                  const history = conversationHistories.get(conversationId);
                  if (history) {
                    // 清空当前构建状态
                    if (history.currentPairId === currentPairId) {
                      history.currentAssistantMessage = '';
                      history.currentPairId = null;
                      history.pendingMessages = []; // 清空待回复消息
                      console.log(`[Token超限] ${conversationId} 已清空对话对(${currentPairId.substring(0, 8)})构建状态`);
                    }
                  }
                  
                  // 重置回复欲望值
                  resetReplyDesire(conversationId);
                  
                  // 清除发送者标记
                  unmarkReplyingToSender(conversationId, senderId);
                  
                  return; // 跳过发送
                }
                
                // Token正常，发送消息
                // 使用已经确定的targetMsg（来自 formatPendingMessagesForAI）
                await smartSend(pendingFormatted.targetMsg || lastMsg, response);
                
                // 设置助手消息内容（普通对话直接使用response）
                appendToAssistantMessage(conversationId, response);
                
                // 完成对话对，保存到历史
                finishConversationPair(conversationId);
                
                // 记录到全局历史（用于system prompt）
                addToGlobalHistory(conversationId, { summary: response, text: response, sender_name: CONFIG.botName }, true);
                
                // 重置回复欲望值
                resetReplyDesire(conversationId);
                
                // 清除发送者标记
                unmarkReplyingToSender(conversationId, senderId);
                
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
              // 添加工具结果到对话历史
              conversations.push({ 
                role: 'user', 
                content: `工具执行结果：${JSON.stringify(ev)}` 
              });
              
              // 调用 AI 生成最终回复（使用配置的模型）
              const response = await agent.chat(conversations, CONFIG.modelName);
              
              // 检查AI生成是否失败
              if (response === null) {
                console.warn('[AI生成] 生成失败，跳过本次回复（拟人行为）');
                unmarkReplyingToSender(conversationId, senderId);
                return; // 跳过本次回复
              }
              
              console.log('\n=== AI 回复（工具步骤） ===');
              console.log(response);
              
              // 使用已经确定的targetMsg（来自 formatPendingMessagesForAI）
              await smartSend(pendingFormatted.targetMsg || lastMsg, response);
              
              // 追加工具步骤结果到助手消息（逐步拼接）
              appendToAssistantMessage(conversationId, response);
              
              // 记录到全局历史（用于system prompt）
              addToGlobalHistory(conversationId, { summary: response, text: response, sender_name: CONFIG.botName }, true);
              
              conversations.push({ role: 'assistant', content: response });
            }
            
            // 对话总结
            if (ev.type === 'summary') {
              console.log('对话总结:', ev.summary);
              
              // 工具调用结束，完成对话对
              finishConversationPair(conversationId);
              
              // 重置回复欲望值
              resetReplyDesire(conversationId);
              
              // 清除发送者标记
              unmarkReplyingToSender(conversationId, senderId);
              
              // 记录工具任务总结到历史
              if (ev.summary) {
                addToolSummary(conversationId, ev.runId, ev.summary);
              }
              
              break;
            }
          }
        } catch (error) {
          console.error('[回复任务] 处理失败:', error);
          
          // 清除发送者标记（错误处理）
          if (!silentMode) {
            unmarkReplyingToSender(conversationId, senderId);
          }
          
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
