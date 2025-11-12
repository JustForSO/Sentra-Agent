import 'dotenv/config';
import SentraMcpSDK from 'sentra-mcp';
import SentraPromptsSDK from 'sentra-prompts';
import { Agent } from "./agent.js";
import fs from "fs";
import WebSocket from 'ws';
import { buildSentraResultBlock, buildSentraUserQuestionBlock, convertHistoryToMCPFormat } from './utils/protocolUtils.js';
import { smartSend } from './utils/sendUtils.js';
import { saveMessageCache, cleanupExpiredCache } from './utils/messageCache.js';
import SentraEmo from './sentra-emo/sdk/index.js';
import { buildSentraEmoSection } from './utils/emoXml.js';
import { shouldReply, completeTask, resetConversationState, getActiveTaskCount, reduceDesireAndRecalculate } from './utils/replyPolicy.js';
import { executeIntervention, shouldEnableIntervention, getInterventionConfig } from './utils/replyIntervention.js';
import { randomUUID } from 'crypto';
import GroupHistoryManager from './utils/groupHistoryManager.js';
import { tokenCounter } from './src/token-counter.js';
import path from 'path';
import UserPersonaManager from './utils/userPersonaManager.js';
import { createLogger } from './utils/logger.js';
import { repairSentraResponse, shouldRepair } from './utils/formatRepair.js';

const sdk = new SentraMcpSDK();
await sdk.init();
await cleanupExpiredCache();
const WS_HOST = process.env.WS_HOST || 'localhost';
const WS_PORT = process.env.WS_PORT || '6702';
const WS_TIMEOUT = parseInt(process.env.WS_TIMEOUT || '10000');
const WS_URL = `ws://${WS_HOST}:${WS_PORT}`;

const ws = new WebSocket(WS_URL);
const send = (obj) => ws.send(JSON.stringify(obj));

const logger = createLogger('Main');
logger.info(`连接到 WebSocket 服务: ${WS_URL}`);

const agent = new Agent({
  apiKey: process.env.API_KEY,
  apiBaseUrl: process.env.API_BASE_URL,
  defaultModel: process.env.MAIN_AI_MODEL,
  temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
  maxTokens: parseInt(process.env.MAX_TOKENS || '4096'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
  timeout: parseInt(process.env.TIMEOUT || '60000')
});

/**
 * 从 agent-presets 文件夹加载预设文件
 * @returns {string} 预设文本内容
 */
function loadAgentPreset() {
  const presetFileName = process.env.AGENT_PRESET_FILE || 'default.txt';
  const presetPath = path.join('./agent-presets', presetFileName);
  
  try {
    // 检查文件是否存在
    if (!fs.existsSync(presetPath)) {
      logger.warn(`预设文件不存在: ${presetPath}`);
      logger.warn('尝试使用默认预设: ./agent-presets/default.txt');
      
      // 回退到 default.txt
      const defaultPath = './agent-presets/default.txt';
      if (!fs.existsSync(defaultPath)) {
        throw new Error('默认预设文件 default.txt 也不存在，请检查 agent-presets 文件夹');
      }
      
      const content = fs.readFileSync(defaultPath, 'utf8');
      logger.success('成功加载默认预设: default.txt');
      return content;
    }
    
    // 读取指定预设文件
    const content = fs.readFileSync(presetPath, 'utf8');
    logger.success(`成功加载 Agent 预设: ${presetFileName}`);
    return content;
    
  } catch (error) {
    logger.error('加载 Agent 预设失败', error);
    throw error;
  }
}

const systems = loadAgentPreset();

const SENTRA_EMO_TIMEOUT = parseInt(process.env.SENTRA_EMO_TIMEOUT || '60000');
const emo = new SentraEmo({ 
  baseURL: process.env.SENTRA_EMO_URL || undefined, 
  timeout: SENTRA_EMO_TIMEOUT 
});

// 群聊历史记录管理器
const historyManager = new GroupHistoryManager({
  maxConversationPairs: parseInt(process.env.MAX_CONVERSATION_PAIRS || '20')
});

// 用户画像管理器
const ENABLE_USER_PERSONA = (process.env.ENABLE_USER_PERSONA || 'true') === 'true';
const personaManager = ENABLE_USER_PERSONA ? new UserPersonaManager({
  agent: agent,  // 传入 agent 实例
  dataDir: process.env.PERSONA_DATA_DIR || './userData',
  updateInterval: parseInt(process.env.PERSONA_UPDATE_INTERVAL || '10'),
  maxHistorySize: parseInt(process.env.PERSONA_MAX_HISTORY || '100'),
  model: process.env.PERSONA_MODEL || 'gpt-4o-mini'
}) : null;

if (!ENABLE_USER_PERSONA) {
  logger.info('用户画像功能已禁用（ENABLE_USER_PERSONA=false）');
}

const MAIN_AI_MODEL = process.env.MAIN_AI_MODEL;
const MAX_RESPONSE_RETRIES = parseInt(process.env.MAX_RESPONSE_RETRIES || '2');
const MAX_RESPONSE_TOKENS = parseInt(process.env.MAX_RESPONSE_TOKENS || '260');
const TOKEN_COUNT_MODEL = process.env.TOKEN_COUNT_MODEL || 'gpt-4o-mini';
const ENABLE_STRICT_FORMAT_CHECK = (process.env.ENABLE_STRICT_FORMAT_CHECK || 'true') === 'true';
const ENABLE_FORMAT_REPAIR = (process.env.ENABLE_FORMAT_REPAIR || 'true') === 'true';

/**
 * 验证响应格式是否符合 Sentra XML 协议
 * @param {string} response AI 响应文本
 * @returns {{valid: boolean, reason?: string}} 验证结果
 */
function validateResponseFormat(response) {
  if (!response || typeof response !== 'string') {
    return { valid: false, reason: '响应为空或非字符串' };
  }
  
  // 检查是否包含 <sentra-response> 标签
  if (!response.includes('<sentra-response>')) {
    return { valid: false, reason: '缺少 <sentra-response> 标签' };
  }
  
  // 检查是否包含非法的系统标签（只读标签不应该出现在输出中）
  const forbiddenTags = [
    '<sentra-tools>',
    '<sentra-result>',
    '<sentra-user-question>',
    '<sentra-pending-messages>',
    '<sentra-emo>'
  ];
  
  for (const tag of forbiddenTags) {
    if (response.includes(tag)) {
      return { valid: false, reason: `包含非法的只读标签: ${tag}` };
    }
  }
  
  return { valid: true };
}

/**
 * 提取响应中的文本内容并计算 token 数
 * @param {string} response AI 响应文本
 * @returns {{text: string, tokens: number}} 提取的文本和 token 数
 */
function extractAndCountTokens(response) {
  // 提取所有 <text1>, <text2>, ... 标签中的内容
  const textMatches = response.match(/<text\d+>([\s\S]*?)<\/text\d+>/g) || [];
  const texts = textMatches.map(match => {
    const content = match.replace(/<\/?text\d+>/g, '').trim();
    return content;
  }).filter(Boolean);
  
  const combinedText = texts.join(' ');
  const tokens = tokenCounter.countTokens(combinedText, TOKEN_COUNT_MODEL);
  
  return { text: combinedText, tokens };
}

/**
 * 带重试的 AI 响应函数
 * @param {Array} conversations 对话历史
 * @param {string|object} modelOrOptions 模型名称或配置对象
 * @param {string} groupId 群组ID
 * @returns {Promise<{response: string, retries: number, success: boolean}>} 响应结果
 */
async function chatWithRetry(conversations, modelOrOptions, groupId) {
  let retries = 0;
  let lastError = null;
  
  // 构建完整的配置对象（确保环境变量生效）
  const options = typeof modelOrOptions === 'string' 
    ? { model: modelOrOptions }
    : (modelOrOptions || {});
  
  while (retries <= MAX_RESPONSE_RETRIES) {
    try {
      logger.debug(`[${groupId}] AI请求第${retries + 1}次尝试`);
      
      // 调用 AI（传递完整配置）
      let response = await agent.chat(conversations, options);
      
      // 格式验证
      if (ENABLE_STRICT_FORMAT_CHECK) {
        const formatCheck = validateResponseFormat(response);
        if (!formatCheck.valid) {
          logger.warn(`[${groupId}] 格式验证失败: ${formatCheck.reason}`);
          let repairedOk = false;
          if (ENABLE_FORMAT_REPAIR && typeof response === 'string' && response.trim()) {
            try {
              const repaired = await repairSentraResponse(response, { agent, model: process.env.REPAIR_AI_MODEL });
              const repairedCheck = validateResponseFormat(repaired);
              if (repairedCheck.valid) {
                response = repaired;
                repairedOk = true;
                logger.success(`[${groupId}] 格式已自动修复`);
              }
            } catch (e) {
              logger.warn(`[${groupId}] 格式修复失败: ${e.message}`);
            }
          }
          if (!repairedOk) {
            if (retries < MAX_RESPONSE_RETRIES) {
              retries++;
              logger.debug(`[${groupId}] 格式验证失败，直接重试（第${retries + 1}次）...`);
              continue;
            } else {
              logger.error(`[${groupId}] 格式验证失败-最终: 已达最大重试次数`);
              return { response: null, retries, success: false, reason: formatCheck.reason };
            }
          }
        }
      }
      
      // Token 门禁检查
      const { text, tokens } = extractAndCountTokens(response);
      logger.debug(`[${groupId}] Token统计: ${tokens} tokens, 文本长度: ${text.length}`);
      
      if (tokens > MAX_RESPONSE_TOKENS) {
        logger.warn(`[${groupId}] Token超限: ${tokens} > ${MAX_RESPONSE_TOKENS}`);
        
        // 如果还有重试机会，直接重试
        if (retries < MAX_RESPONSE_RETRIES) {
          retries++;
          logger.debug(`[${groupId}] Token超限，直接重试（第${retries + 1}次）...`);
          continue;
        } else {
          // 没有重试机会了，返回失败
          logger.error(`[${groupId}] Token超限-最终: 已达最大重试次数`);
          return { response: null, retries, success: false, reason: `Token超限: ${tokens}>${MAX_RESPONSE_TOKENS}` };
        }
      }
      
      // 所有验证通过
      logger.success(`[${groupId}] AI响应成功 (${tokens}/${MAX_RESPONSE_TOKENS} tokens)`);
      return { response, retries, success: true };
      
    } catch (error) {
      logger.error(`[${groupId}] AI请求失败 - 第${retries + 1}次尝试`, error);
      lastError = error;
      
      // 如果是网络错误或超时，重试
      if (retries < MAX_RESPONSE_RETRIES) {
        retries++;
        logger.warn(`[${groupId}] 网络错误，1秒后第${retries}次重试...`);
        await sleep(1000);
        continue;
      } else {
        // 没有重试机会了
        logger.error(`[${groupId}] AI请求失败 - 已达最大重试次数${MAX_RESPONSE_RETRIES}次`);
        return { response: null, retries, success: false, reason: lastError.message };
      }
    }
  }
  
  return { response: null, retries, success: false, reason: lastError?.message || '未知错误' };
}

const BUNDLE_WINDOW_MS = parseInt(process.env.BUNDLE_WINDOW_MS || '5000');
const BUNDLE_MAX_MS = parseInt(process.env.BUNDLE_MAX_MS || '15000');
const senderBundles = new Map(); // senderId -> { collecting: true, messages: [], lastUpdate: ts }
const pendingMessagesByUser = new Map(); // senderId -> messages[] （等待活跃任务完成后处理）

// 简单延时
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 如果该 sender 正在聚合窗口内，则把新消息加入窗口并返回 true
function appendToBundle(senderId, m) {
  const key = String(senderId ?? '');
  const b = senderBundles.get(key);
  if (b && b.collecting) {
    b.messages.push(m);
    b.lastUpdate = Date.now();
    return true;
  }
  return false;
}

// 启动聚合：第一条触发后，等待窗口内是否有后续消息，直到达到最大等待
async function collectBundle(senderId, firstMsg) {
  const key = String(senderId ?? '');
  // 建立聚合桶
  const bucket = { collecting: true, messages: [firstMsg], lastUpdate: Date.now() };
  senderBundles.set(key, bucket);
  const start = Date.now();
  while (true) {
    const snap = bucket.lastUpdate;
    await sleep(BUNDLE_WINDOW_MS);
    const elapsed = Date.now() - start;
    // 若窗口期间有新消息，且未超过最大等待，则继续等待一个窗口
    if (bucket.lastUpdate > snap && elapsed < BUNDLE_MAX_MS) continue;
    break;
  }
  bucket.collecting = false;
  senderBundles.delete(key);
  // 组合文本
  const texts = bucket.messages.map(m => {
    const t = (typeof m?.text === 'string' && m.text.trim()) ? m.text.trim() : '';
    const s = (typeof m?.summary === 'string' && m.summary.trim()) ? m.summary.trim() : '';
    return t || s || '';
  }).filter(Boolean);
  const combined = texts.join('\n');
  const bundled = { ...firstMsg };
  if (combined) {
    bundled.text = combined;
    bundled.summary = combined;
  }
  return bundled;
}

// 处理一条（可能已聚合的）消息，并在完成后尝试拉起队列中的下一条
async function handleOneMessage(msg, taskId) {
  const userid = String(msg?.sender_id ?? '');
  const groupId = msg?.group_id ? `G:${msg.group_id}` : `U:${userid}`;
  const currentTaskId = taskId; 

  const conversationId = msg?.group_id 
    ? `group_${msg.group_id}_sender_${userid}` 
    : `private_${userid}`;
  
  let convId = null;
  let pairId = null;
  let currentUserContent = ''; 
  let isCancelled = false;  // 任务取消标记：检测到新消息时设置为 true
  let hasReplied = false;  // 引用控制标记：记录是否已经发送过第一次回复（只有第一次引用消息）
  
  try {
    /**
     * 动态感知用户的连续输入和修正
     * 步骤1：将该sender_id的消息从待处理队列移到正在处理队列
     * 这样可以避免任务完成后被误清空，同时能及时感知用户的补充和修正
     */
    await historyManager.startProcessingMessages(groupId, userid);
    
    /**
     * 步骤2：获取该sender_id在队列中的所有消息（包括待处理和正在处理）
     * 这样bot在处理任务过程中能及时看到用户的补充和修正
     */
    const getAllSenderMessages = () => {
      return historyManager.getPendingMessagesBySender(groupId, userid);
    };
    
    // 获取该sender_id的所有消息
    let senderMessages = getAllSenderMessages();
    
    /**
     * 构建拼接内容：将该sender_id的所有消息按时间顺序拼接
     * 让bot能看到完整的任务演变过程（原始请求 -> 修正 -> 补充）
     */
    const buildConcatenatedContent = (messages) => {
      if (messages.length === 0) {
        return msg?.summary || msg?.text || '';
      }
      // 拼接所有消息，用换行符分隔，保留时间戳以便bot理解顺序
      return messages.map(m => {
        const timeStr = m.time_str || '';
        const content = m.summary || m.text || '';
        return timeStr ? `[${timeStr}] ${content}` : content;
      }).join('\n\n');
    };
    
    // objective 和 conversation 都使用相同的拼接内容
    // 确保bot在所有阶段都能看到完整的上下文
    const userObjective = buildConcatenatedContent(senderMessages);
    
    // conversation: 构建 MCP FC 协议格式的对话上下文
    // 包含：1. 历史工具调用上下文 2. 当前用户消息
    const historyConversations = historyManager.getConversationHistory(groupId);
    const mcpHistory = convertHistoryToMCPFormat(historyConversations);
    
    const conversation = [
      ...mcpHistory,  // 历史上下文（user 的 sentra-user-question + assistant 的 sentra-tools）
      { role: 'user', content: userObjective }  // 当前任务
    ];
    
    logger.debug(`MCP上下文: ${groupId} 原始历史${historyConversations.length}条 → 转换后${mcpHistory.length}条 + 当前1条 = 总计${conversation.length}条`);
    
    // 获取用户画像（如果启用）
    let personaContext = '';
    if (personaManager && userid) {
      personaContext = personaManager.formatPersonaForContext(userid);
      if (personaContext) {
        logger.debug(`用户画像: ${userid} 画像已加载`);
      }
    }
    
    // 组合系统提示词（如果有画像则添加）
    const systemContent = personaContext ? `${system}\n\n${personaContext}` : system;
    
    let conversations = [
      { role: 'system', content: systemContent },
      ...historyConversations
    ];
    const overlays = { global: systems };
    const sendAndWaitWithConv = (m) => {
      const mm = m || {};
      if (!mm.requestId) {
        try { mm.requestId = `${convId || randomUUID()}:${randomUUID()}`; } catch { mm.requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`; }
      }
      return sendAndWaitResult(mm);
    };

    // 记录初始消息数量
    const initialMessageCount = senderMessages.length;
    
    for await (const ev of sdk.stream({
      objective: userObjective,
      conversation: conversation,
      overlays
    })) {
      logger.debug('Agent事件', ev);

      // 在 start 事件时缓存消息 - 缓存最后一条待回复消息
      if (ev.type === 'start' && ev.runId) {
        // 实时获取最新的消息列表
        senderMessages = getAllSenderMessages();
        const latestMsg = senderMessages[senderMessages.length - 1] || msg;
        await saveMessageCache(ev.runId, latestMsg);
        
        // 检查是否有新消息到达
        if (senderMessages.length > initialMessageCount) {
          logger.info(`动态感知: ${groupId} 检测到新消息 ${initialMessageCount} -> ${senderMessages.length}，将更新上下文`);
        }
      }

      if (ev.type === 'judge') {
        if (!convId) convId = randomUUID();
        try {
          const ua = await emo.userAnalytics(userid, { days: 7 });
          const emoXml = buildSentraEmoSection(ua);
          if (conversations[0] && conversations[0].role === 'system') {
            conversations[0].content = (conversations[0].content || '') + '\n\n' + emoXml;
          }
        } catch {}
        if (!ev.need) {
          // 开始构建 Bot 回复
          pairId = await historyManager.startAssistantMessage(groupId);
          logger.debug(`创建pairId-Judge: ${groupId} pairId ${pairId?.substring(0, 8)}`);
          
          // 实时获取最新的sender消息列表
          senderMessages = getAllSenderMessages();
          
          // 检查是否有新消息：如果有，需要拼接所有消息作为上下文
          if (senderMessages.length > initialMessageCount) {
            logger.info(`动态感知Judge: ${groupId} 检测到新消息，拼接完整上下文`);
          }
          
          const latestMsg = senderMessages[senderMessages.length - 1] || msg;
          
          // 获取历史上下文（仅供参考，只包含该 sender 的历史消息）
          const contextXml = historyManager.getPendingMessagesContext(groupId, userid);
          // 构建当前需要回复的消息（主要内容）- 使用最新的消息
          const userQuestion = buildSentraUserQuestionBlock(latestMsg);
          
          // 组合上下文：历史上下文 + 当前消息
          if (contextXml) {
            currentUserContent = contextXml + '\n\n' + userQuestion;
          } else {
            currentUserContent = userQuestion;
          }
          
          conversations.push({ role: 'user', content: currentUserContent });
          // logger.debug('Conversations', conversations);
          
          const result = await chatWithRetry(conversations, MAIN_AI_MODEL, groupId);
          
          if (!result.success) {
            logger.error(`AI响应失败Judge: ${groupId} 原因 ${result.reason}, 重试${result.retries}次`);
            if (pairId) {
              logger.debug(`取消pairId-Judge失败: ${groupId} pairId ${pairId.substring(0, 8)}`);
              await historyManager.cancelConversationPairById(groupId, pairId);
              pairId = null;
            }
            return;
          }
          
          const response = result.response;
          logger.success(`AI响应成功Judge: ${groupId} 重试${result.retries}次`);

          await historyManager.appendToAssistantMessage(groupId, response);
          
          const latestSenderMessages = getAllSenderMessages();
          if (latestSenderMessages.length > initialMessageCount) {
            logger.info(`动态感知Judge: ${groupId} 检测到补充消息 ${initialMessageCount} -> ${latestSenderMessages.length}，整合到上下文`);
          }

          if (isCancelled) {
            logger.info(`任务已取消: ${groupId} 跳过发送Judge阶段`);
            return;
          }
          
          senderMessages = getAllSenderMessages();  
          const finalMsg = senderMessages[senderMessages.length - 1] || msg;
          const allowReply = !hasReplied;  
          logger.debug(`引用消息Judge: ${groupId} 消息${finalMsg.message_id}, sender ${finalMsg.sender_id}, 队列${senderMessages.length}条, 允许引用 ${allowReply}`);
          await smartSend(finalMsg, response, sendAndWaitWithConv, allowReply);
          hasReplied = true;  
          
          await historyManager.finishConversationPair(groupId, currentUserContent);
          
          // 回复发送成功后重置欲望值，防止在处理期间继续触发
          resetConversationState(conversationId);
          
          pairId = null;
          return;
        }
      }

      if (ev.type === 'plan') {
        logger.info('执行计划', ev.plan.steps);
      }
      
      if (ev.type === 'tool_result') {
        if (!pairId) {
          pairId = await historyManager.startAssistantMessage(groupId);
          logger.debug(`创建pairId-ToolResult: ${groupId} pairId ${pairId?.substring(0, 8)}`);
        }
        
        if (!currentUserContent) {
          senderMessages = getAllSenderMessages();
          
          if (senderMessages.length > initialMessageCount) {
            logger.info(`动态感知ToolResult: ${groupId} 检测到新消息，拼接完整上下文`);
          }
          
          const latestMsg = senderMessages[senderMessages.length - 1] || msg;
          
          // 获取该 sender 的历史上下文
          const contextXml = historyManager.getPendingMessagesContext(groupId, userid);
          const userQuestion = buildSentraUserQuestionBlock(latestMsg);
          
          if (contextXml) {
            currentUserContent = contextXml + '\n\n' + userQuestion;
          } else {
            currentUserContent = userQuestion;
          }
        }
        
        // 构建结果观测块
        let content = '';
        try {
          content = buildSentraResultBlock(ev);
        } catch (e) {
          logger.warn('构建 <sentra-result> 失败，回退 JSON 注入');
          content = JSON.stringify(ev);
        }
        
        const fullContext = content + '\n\n' + currentUserContent;
        
        // 更新 currentUserContent 为包含工具结果的完整上下文，确保保存到历史记录时不丢失工具结果
        currentUserContent = fullContext;
        
        conversations.push({ role: 'user', content: fullContext });
  
        const result = await chatWithRetry(conversations, MAIN_AI_MODEL, groupId);
        
        if (!result.success) {
          logger.error(`AI响应失败ToolResult: ${groupId} 原因 ${result.reason}, 重试${result.retries}次`);
          if (pairId) {
            logger.debug(`取消pairId-ToolResult失败: ${groupId} pairId ${pairId.substring(0, 8)}`);
            await historyManager.cancelConversationPairById(groupId, pairId);
            pairId = null;
          }
          return;
        }
        
        const response = result.response;
        logger.success(`AI响应成功ToolResult: ${groupId} 重试${result.retries}次`);

        await historyManager.appendToAssistantMessage(groupId, response);
        
        const latestSenderMessages = getAllSenderMessages();
        if (latestSenderMessages.length > initialMessageCount) {
          logger.info(`动态感知ToolResult: ${groupId} 检测到补充消息 ${initialMessageCount} -> ${latestSenderMessages.length}，整合到上下文`);
        }

        if (isCancelled) {
          logger.info(`任务已取消: ${groupId} 跳过发送ToolResult阶段`);
          return;
        }
        
        senderMessages = getAllSenderMessages(); 
        const finalMsg = senderMessages[senderMessages.length - 1] || msg;
        const allowReply = !hasReplied; 
        logger.debug(`引用消息ToolResult: ${groupId} 消息${finalMsg.message_id}, sender ${finalMsg.sender_id}, 队列${senderMessages.length}条, 允许引用 ${allowReply}`);
        await smartSend(finalMsg, response, sendAndWaitWithConv, allowReply);
        hasReplied = true;
        
        conversations.push({ role: 'assistant', content: response });
      }
      
      if (ev.type === 'summary') {
        logger.info('对话总结', ev.summary);
        
        if (isCancelled) {
          logger.info(`任务已取消: ${groupId} 跳过保存对话对Summary阶段`);
          if (pairId) {
            logger.debug(`清理pairId: ${groupId} pairId ${pairId?.substring(0, 8)}`);
            await historyManager.cancelConversationPairById(groupId, pairId);
            pairId = null;
          }
          break;
        }

        if (pairId) {
          logger.debug(`保存对话对: ${groupId} pairId ${pairId.substring(0, 8)}`);
          const saved = await historyManager.finishConversationPair(groupId, currentUserContent);
          if (!saved) {
            logger.warn(`保存失败: ${groupId} pairId ${pairId.substring(0, 8)} 状态不一致`);
          }
          
          // 回复发送成功后重置欲望值，防止在处理期间继续触发
          resetConversationState(conversationId);
          
          pairId = null;
        } else {
          logger.warn(`跳过保存: ${groupId} pairId为null`);
        }
        break;
      }
    }
  } catch (error) {
    logger.error('处理消息异常: ', error);
    
    if (pairId) {
      logger.debug(`取消pairId-异常: ${groupId} pairId ${pairId.substring(0, 8)}`);
      await historyManager.cancelConversationPairById(groupId, pairId);
    }
  } finally {
    // 任务完成，释放并发槽位并尝试拉起队列中的下一条
    // completeTask 会自动调用 replyPolicy.js 中的 removeActiveTask
    if (taskId && userid) {
      const next = await completeTask(userid, taskId);
      if (next && next.msg) {
        const nextUserId = String(next.msg?.sender_id ?? '');
        const bundledNext = await collectBundle(nextUserId, next.msg);
        await handleOneMessage(bundledNext, next.id);
      }
      
      // 检查是否有待处理的消息（延迟聚合）
      if (pendingMessagesByUser.has(userid) && pendingMessagesByUser.get(userid).length > 0) {
        const pendingMsgs = pendingMessagesByUser.get(userid);
        pendingMessagesByUser.delete(userid);
        
        logger.info(`延迟聚合触发: 用户${userid} 活跃任务完成，开始处理 ${pendingMsgs.length} 条待处理消息`);
        
        // 合并所有待处理消息
        const texts = pendingMsgs.map(m => {
          const t = (typeof m?.text === 'string' && m.text.trim()) ? m.text.trim() : '';
          const s = (typeof m?.summary === 'string' && m.summary.trim()) ? m.summary.trim() : '';
          return t || s || '';
        }).filter(Boolean);
        const combined = texts.join('\n');
        const mergedMsg = { ...pendingMsgs[0] };
        if (combined) {
          mergedMsg.text = combined;
          mergedMsg.summary = combined;
        }
        
        // 重新调用 shouldReply 并处理
        const replyDecision = await shouldReply(mergedMsg);
        if (replyDecision.needReply) {
          logger.info(`延迟聚合回复决策: ${replyDecision.reason} (taskId=${replyDecision.taskId})`);
          await handleOneMessage(mergedMsg, replyDecision.taskId);
        } else {
          logger.debug(`延迟聚合跳过: ${replyDecision.reason}`);
        }
      }
    }
    
    logger.debug(`任务清理完成: ${groupId} sender ${userid}`);
  }
}

const text = "{{sandbox_system_prompt}}\n{{sentra_tools_rules}}\n现在时间：{{time}}\n\n平台：\n{{qq_system_prompt}}\n\n" + systems;
const system = await SentraPromptsSDK(text);

function sendAndWaitResult(message) {
  return new Promise((resolve) => {
    const msg = message || {};
    if (!msg.requestId) {
      try { msg.requestId = randomUUID(); } catch { msg.requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`; }
    }
    const requestId = msg.requestId;
    const timeout = setTimeout(() => {
      logger.warn(`请求超时: ${requestId}`);
      resolve(null);
    }, WS_TIMEOUT);

    const handler = (data) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.type === 'result' && payload.requestId === requestId) {
          clearTimeout(timeout);
          ws.off('message', handler);
          resolve(payload.ok ? payload : null);
        }
      } catch (e) {
      }
    };

    ws.on('message', handler);
    send(msg);
  });
}

ws.on('message', async (data) => {
  try {
    const payload = JSON.parse(data.toString());
    
    if (payload.type === 'welcome') {
      logger.success(`连接成功: ${payload.message}`);
      return;
    }
    
    if (payload.type === 'pong') {
      return;
    }
    
    if (payload.type === 'shutdown') {
      logger.warn(`服务器关闭: ${payload.message}`);
      return;
    }
    
    if (payload.type === 'result') {
      logger.debug(`<< result ${payload.requestId} ${payload.ok ? 'OK' : 'ERR'}`);
      return;
    }
    
    if (payload.type === 'message') {
      const msg = payload.data;
      logger.debug('<< message', msg.type, msg.group_id || msg.sender_id);
      const userid = String(msg?.sender_id ?? '');
      const username = msg?.sender_name || '';
      const emoText = (typeof msg?.text === 'string' && msg.text.trim()) ? msg.text : (msg?.summary || '');
      if (userid && emoText) {
        try { await emo.analyze(emoText, { userid, username }); } catch {}
      }
      const groupId = msg?.group_id ? `G:${msg.group_id}` : `U:${userid}`;
      const summary = msg?.summary || msg?.text || '';
      await historyManager.addPendingMessage(groupId, summary, msg);

      if (personaManager && userid && summary) {
        await personaManager.recordMessage(userid, {
          text: summary,
          timestamp: new Date().toISOString(),
          senderName: username,
          groupId: msg?.group_id || null
        });
      }

      // 检查是否有活跃任务（针对该用户）
      const activeCount = getActiveTaskCount(userid);
      
      if (userid && appendToBundle(userid, msg)) {
        logger.debug('聚合: 已追加到当前窗口，等待合并处理');
        return;
      }
      
      // 如果用户有活跃任务，将消息加入待处理队列，等待任务完成后延迟聚合
      if (activeCount > 0) {
        if (!pendingMessagesByUser.has(userid)) {
          pendingMessagesByUser.set(userid, []);
        }
        pendingMessagesByUser.get(userid).push(msg);
        logger.debug(`延迟聚合: 用户${userid} 有 ${activeCount} 个活跃任务，消息已加入待处理队列 (当前 ${pendingMessagesByUser.get(userid).length} 条)`);
        return;
      }

      const replyDecision = await shouldReply(msg);
      let taskId = replyDecision.taskId;
      logger.info(`回复决策: ${replyDecision.reason} (mandatory=${replyDecision.mandatory}, probability=${(replyDecision.probability * 100).toFixed(1)}%, taskId=${taskId || 'null'})`);
      
      if (!replyDecision.needReply) {
        logger.debug('跳过回复: 根据智能策略，本次不回复，消息已累积');
        return;
      }
      
      // 干预判断：对非强制场景进行二次判断
      if (shouldEnableIntervention() && !replyDecision.mandatory && replyDecision.conversationId && replyDecision.state) {
        logger.debug('启动干预判断: 使用轻量模型进行二次判断');
        
        const interventionConfig = getInterventionConfig();
        
        const interventionResult = await executeIntervention(
          agent, 
          msg, 
          replyDecision.probability, 
          replyDecision.threshold || 0.65,
          replyDecision.state
        );
        
        if (!interventionResult.need) {
          // 干预判断认为不需要回复，降低欲望值并重新计算
          logger.info(`干预判断: 不需要回复 - ${interventionResult.reason} (confidence=${interventionResult.confidence})`);
          
          const recalcResult = reduceDesireAndRecalculate(
            replyDecision.conversationId, 
            msg, 
            interventionConfig.desireReduction
          );
          
          if (!recalcResult.needReply) {
            // 降低欲望后仍不通过阈值，跳过回复
            logger.info(`干预后跳过: 欲望降低${(interventionConfig.desireReduction * 100).toFixed(0)}%后概率${(recalcResult.probability * 100).toFixed(1)}%仍未通过`);
            // 移除活跃任务（因为不会处理）
            if (taskId) {
              await completeTask(userid, taskId);
            }
            return;
          } else {
            // 降低欲望后仍然通过阈值，继续处理
            logger.info(`干预后继续: 欲望降低${(interventionConfig.desireReduction * 100).toFixed(0)}%后概率${(recalcResult.probability * 100).toFixed(1)}%仍通过阈值`);
          }
        } else {
          // 干预判断认为需要回复，继续处理
          logger.debug(`干预判断: 确认需要回复 - ${interventionResult.reason} (confidence=${interventionResult.confidence})`);
        }
      }
      
      const bundledMsg = await collectBundle(userid, msg);
      await handleOneMessage(bundledMsg, taskId);
      return;
    }
  } catch (e) {
    logger.error('处理消息失败', e);
  }
});

ws.on('open', () => {
  logger.success('WebSocket 连接已建立');
});

ws.on('error', (error) => {
  logger.error('WebSocket 错误', error);
});

ws.on('close', () => {
  logger.warn('WebSocket 连接已关闭');
});