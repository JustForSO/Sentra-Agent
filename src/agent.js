/**
 * Sentra Agent - 全面集成的智能Agent系统
 * 集成功能：
 * - 分词处理 (sentra-segmentation)
 * - 知识检索 (sentra-rag)
 * - 动态提示词 (sentra-prompts)
 * - 工具调用和流式通讯 (sentra-mcp)
 * - 情绪分析 (sentra-emo)
 */

import { textSegmentation } from './segmentation.js';
import sentraRAG from '../sentra-rag/src/sdk/SentraRAG.js';
import SentraPromptsSDK from '../sentra-prompts/sdk.js';
import SentraMcpSDK from '../sentra-mcp/src/sdk/index.js';
import { tokenCounter } from './token-counter.js';
import { getConfigFromEnv } from './config.js';
import 'dotenv/config';
import OpenAI from 'openai';

/**
 * Agent配置类
 */
export class AgentConfig {
  constructor(config = {}) {
    const defaultConfig = getConfigFromEnv();
    const finalConfig = { ...defaultConfig, ...config };

    // 基础配置
    this.baseURL = finalConfig.apiBaseUrl;
    this.apiKey = finalConfig.apiKey;
    this.modelName = finalConfig.modelName;
    this.temperature = finalConfig.temperature;
    this.maxTokens = finalConfig.maxTokens;
    this.maxRetries = finalConfig.maxRetries;
    this.timeout = finalConfig.timeout;

    // 高级功能开关
    this.enableSegmentation = process.env.ENABLE_SEGMENTATION !== 'false'; // 分词
    this.enableRAG = process.env.ENABLE_RAG !== 'false'; // RAG检索
    this.enablePrompts = process.env.ENABLE_PROMPTS !== 'false'; // 动态提示词
    this.enableMCP = process.env.ENABLE_MCP !== 'false'; // MCP工具调用
    this.enableMemorySave = process.env.ENABLE_MEMORY_SAVE !== 'false'; // 记忆保存

    // RAG配置
    this.ragKeywordLimit = parseInt(process.env.RAG_KEYWORD_LIMIT || '5', 10);
    this.ragVectorLimit = parseInt(process.env.RAG_VECTOR_LIMIT || '3', 10);
    this.ragThreshold = parseFloat(process.env.RAG_THRESHOLD || '0.7');

    // 会话ID
    this.conversationId = config.conversationId || `conv_${Date.now()}`;
    this.userId = config.userId || 'default_user';
  }
}

/**
 * 智能Agent类 - 全面集成版
 */
export class Agent {
  constructor(config = {}) {
    this.config = new AgentConfig(config);
    this.conversationHistory = [];
    this.initialized = false;
    
    // 集成的服务
    this.segmentation = textSegmentation;
    this.rag = null;
    this.prompts = null;
    this.mcp = null;
  }

  /**
   * 初始化Agent（必须先调用）
   */
  async initialize() {
    if (this.initialized) {
      console.log('✅ Agent已初始化');
      return;
    }

    console.log('🚀 正在初始化Sentra Agent...');

    try {
      // 初始化RAG
      if (this.config.enableRAG) {
        console.log('📚 初始化RAG系统...');
        this.rag = sentraRAG;
        await this.rag.initialize();
        console.log('✅ RAG系统初始化完成');
      }

      // 初始化Prompts
      if (this.config.enablePrompts) {
        console.log('📝 初始化Prompts系统...');
        this.prompts = SentraPromptsSDK;
        console.log('✅ Prompts系统初始化完成');
      }

      // 初始化MCP
      if (this.config.enableMCP) {
        console.log('🔧 初始化MCP系统...');
        this.mcp = new SentraMcpSDK();
        await this.mcp.init();
        console.log('✅ MCP系统初始化完成');
      }

      this.initialized = true;
      console.log('🎉 Sentra Agent初始化完成！');
    } catch (error) {
      console.error('❌ Agent初始化失败:', error.message);
      throw error;
    }
  }

  /**
   * 使用基础 LLM 生成回复（当无需使用工具或未启用 MCP 时）
   * @param {Array<{role:string,content:string}>} messages 已处理过的消息（包含 system 与历史）
   * @returns {Promise<string>} 助手回复内容
   */
  async _llmReply(messages) {
    const client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL
    });

    const payload = {
      model: this.config.modelName,
      messages,
      temperature: this.config.temperature
    };
    const max = Number(this.config.maxTokens);
    if (Number.isFinite(max) && max > 0) payload.max_tokens = max;

    const res = await client.chat.completions.create(payload);
    return res?.choices?.[0]?.message?.content || '';
  }

  /**
   * 关闭Agent（释放资源）
   */
  async close() {
    if (!this.initialized) return;

    console.log('🔌 正在关闭Agent...');

    try {
      if (this.rag) {
        await this.rag.close();
      }
      this.initialized = false;
      console.log('✅ Agent已关闭');
    } catch (error) {
      console.error('❌ Agent关闭失败:', error.message);
    }
  }

  /**
   * 智能聊天 - 集成所有功能
   * @param {string} userMessage 用户消息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 回复结果
   */
  async chat(userMessage, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log('\n💬 处理用户消息:', userMessage);

    try {
      // 1. 分词处理
      let keywords = [];
      if (this.config.enableSegmentation) {
        console.log('\n📋 步骤1: 分词处理...');
        const segments = this.segmentation.segment(userMessage);
        keywords = segments.filter(seg => seg.length > 1); // 过滤单字
        console.log('✅ 分词结果:', keywords.slice(0, 10));
      }

      // 2. RAG检索 - 关键词搜索和向量搜索
      let ragContext = '';
      if (this.config.enableRAG && this.rag) {
        console.log('\n🔍 步骤2: RAG检索...');
        
        // 2.1 关键词搜索（并发）
        const keywordResults = await Promise.all(
          keywords.slice(0, 3).map(keyword => 
            this.rag.search(keyword, { 
              mode: 'hybrid', 
              limit: this.config.ragKeywordLimit 
            })
          )
        ).catch(err => {
          console.warn('⚠️ 关键词搜索失败:', err.message);
          return [];
        });

        const flatKeywordResults = keywordResults.flat().slice(0, this.config.ragKeywordLimit);
        console.log(`✅ 关键词检索: 找到 ${flatKeywordResults.length} 条相关记忆`);

        // 2.2 向量搜索
        const vectorResults = await this.rag.query(userMessage, {
          mode: 'vector',
          limit: this.config.ragVectorLimit,
          threshold: this.config.ragThreshold
        }).catch(err => {
          console.warn('⚠️ 向量搜索失败:', err.message);
          return { results: [] };
        });

        console.log(`✅ 向量检索: 找到 ${vectorResults.results?.length || 0} 条相关记忆`);

        // 合并检索结果
        const allResults = [...flatKeywordResults, ...(vectorResults.results || [])];
        const uniqueResults = Array.from(
          new Map(allResults.map(r => [r.id, r])).values()
        ).slice(0, 8);

        if (uniqueResults.length > 0) {
          ragContext = '\n\n【相关记忆】\n' + uniqueResults.map((r, idx) => 
            `${idx + 1}. ${r.content || r.title || ''}`
          ).join('\n');
          console.log(`✅ 合并检索结果: ${uniqueResults.length} 条`);
        }
      }

      // 3. 动态提示词处理
      let processedMessages = [...this.conversationHistory];
      if (this.config.enablePrompts && this.prompts) {
        console.log('\n📝 步骤3: 动态提示词处理...');
        
        // 处理系统提示词
        if (processedMessages.length > 0 && processedMessages[0].role === 'system') {
          const parsedContent = await this.prompts.parse(processedMessages[0].content);
          processedMessages[0] = { ...processedMessages[0], content: parsedContent };
          console.log('✅ 系统提示词已处理');
        }

        // 处理用户消息（添加RAG上下文）
        const enhancedUserMessage = userMessage + ragContext;
        const parsedUserMessage = await this.prompts.parse(enhancedUserMessage);
        processedMessages.push({ role: 'user', content: parsedUserMessage });
        console.log('✅ 用户消息已增强');
      } else {
        processedMessages.push({ role: 'user', content: userMessage + ragContext });
      }

      // 4. 生成回复（优先 MCP；若判定无需工具或未启用，则回退到 LLM）
      let finalResponse = '';
      let mcpResult = null;
      let mcpUsed = false;

      const useMcp = this.config.enableMCP && this.mcp;
      if (useMcp) {
        console.log('\n🔧 步骤4: MCP工具调用...');
        mcpResult = await this.mcp.runOnce({
          objective: '根据对话完成用户请求',
          conversation: processedMessages,
          context: {
            conversationId: this.config.conversationId,
            userId: this.config.userId
          }
        });

        if (mcpResult.success) {
          const stepCount = Number(mcpResult?.data?.plan?.steps?.length || 0);
          if (stepCount > 0) {
            finalResponse = mcpResult.data.summary || mcpResult.data.exec?.result || '完成';
            console.log('✅ MCP执行成功');
            console.log('  - 计划步骤:', stepCount);
            console.log('  - 执行结果:', finalResponse.substring(0, 100));
            mcpUsed = true;
          } else {
            console.log('⚖️ 判定无需调用工具，改用 LLM 生成回复...');
            finalResponse = await this._llmReply(processedMessages);
          }
        } else {
          throw new Error(mcpResult.error || 'MCP执行失败');
        }
      } else {
        // 未启用 MCP，直接用 LLM 生成
        finalResponse = await this._llmReply(processedMessages);
      }

      // 5. 保存对话到记忆库
      if (this.config.enableMemorySave && this.rag) {
        console.log('\n💾 步骤5: 保存对话记忆...');
        
        await this.rag.saveOpenAIMessages(
          [
            { role: 'user', content: userMessage },
            { role: 'assistant', content: finalResponse }
          ],
          {
            conversationId: this.config.conversationId,
            userId: this.config.userId,
            metadata: {
              timestamp: Date.now(),
              keywords: keywords.slice(0, 5)
            }
          }
        ).catch(err => {
          console.warn('⚠️ 保存对话失败:', err.message);
        });

        console.log('✅ 对话已保存到记忆库');
      }

      // 更新对话历史
      this.conversationHistory.push({ role: 'user', content: userMessage });
      this.conversationHistory.push({ role: 'assistant', content: finalResponse });

      console.log('\n✨ 处理完成！\n');

      return {
        success: true,
        response: finalResponse,
        metadata: {
          keywords,
          ragContextLength: ragContext.length,
          mcpUsed,
          mcpResult: mcpResult?.data
        }
      };

    } catch (error) {
      console.error('❌ 聊天处理失败:', error.message);
      return {
        success: false,
        error: error.message,
        response: '抱歉，处理您的请求时出现了错误。'
      };
    }
  }

  /**
   * 流式聊天 - 实时反馈
   * @param {string} userMessage 用户消息
   * @param {Object} options 选项
   * @returns {AsyncGenerator} 事件流
   */
  async *chatStream(userMessage, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    yield { type: 'start', message: '开始处理...' };

    try {
      // 1. 分词
      let keywords = [];
      if (this.config.enableSegmentation) {
        yield { type: 'segmentation', message: '正在分词...' };
        const segments = this.segmentation.segment(userMessage);
        keywords = segments.filter(seg => seg.length > 1);
        yield { type: 'segmentation', data: { keywords }, message: `分词完成: ${keywords.length}个词元` };
      }

      // 2. RAG检索
      let ragContext = '';
      if (this.config.enableRAG && this.rag) {
        yield { type: 'rag', message: '正在检索记忆...' };

        const keywordResults = await Promise.all(
          keywords.slice(0, 3).map(keyword => 
            this.rag.search(keyword, { mode: 'hybrid', limit: this.config.ragKeywordLimit })
          )
        ).catch(() => []);

        const vectorResults = await this.rag.query(userMessage, {
          mode: 'vector',
          limit: this.config.ragVectorLimit
        }).catch(() => ({ results: [] }));

        const allResults = [...keywordResults.flat(), ...(vectorResults.results || [])];
        const uniqueResults = Array.from(
          new Map(allResults.map(r => [r.id, r])).values()
        ).slice(0, 8);

        if (uniqueResults.length > 0) {
          ragContext = '\n\n【相关记忆】\n' + uniqueResults.map((r, idx) => 
            `${idx + 1}. ${r.content || r.title || ''}`
          ).join('\n');
        }

        yield { type: 'rag', data: { count: uniqueResults.length }, message: `检索完成: ${uniqueResults.length}条记忆` };
      }

      // 3. 动态提示词
      let processedMessages = [...this.conversationHistory];
      if (this.config.enablePrompts && this.prompts) {
        yield { type: 'prompts', message: '正在处理提示词...' };
        // 处理系统提示词
        if (processedMessages.length > 0 && processedMessages[0].role === 'system') {
          try {
            const parsedSystem = await this.prompts.parse(processedMessages[0].content);
            processedMessages[0] = { ...processedMessages[0], content: parsedSystem };
          } catch {}
        }
        const enhancedUserMessage = userMessage + ragContext;
        const parsedUserMessage = await this.prompts.parse(enhancedUserMessage);
        processedMessages.push({ role: 'user', content: parsedUserMessage });
        yield { type: 'prompts', message: '提示词处理完成' };
      } else {
        processedMessages.push({ role: 'user', content: userMessage + ragContext });
      }

      // 4. MCP流式执行（若判定无需工具，则回退到 LLM）
      let finalResponse = '';
      let judgeNoTool = false;
      let hadToolActivity = false;
      let usedPlanSteps = 0;
      if (this.config.enableMCP && this.mcp) {
        yield { type: 'mcp', message: '正在执行工具调用...' };

        for await (const event of this.mcp.stream({
          objective: '根据对话完成用户请求',
          conversation: processedMessages,
          context: {
            conversationId: this.config.conversationId,
            userId: this.config.userId
          }
        })) {
          yield { type: 'mcp_event', data: event, message: `MCP: ${event.type}` };
          if (event.type === 'judge' && event.need === false) {
            judgeNoTool = true;
          }
          if (event.type === 'plan' && Array.isArray(event.plan?.steps)) {
            usedPlanSteps = Number(event.plan.steps.length || 0);
          }
          if (event.type === 'tool_result' || event.type === 'args') {
            hadToolActivity = true;
          }
          if (event.type === 'summary') {
            finalResponse = event.summary;
          }
        }

        if (judgeNoTool || (!hadToolActivity && usedPlanSteps === 0)) {
          yield { type: 'mcp', message: '判定无需工具，改用 LLM 生成回复' };
          finalResponse = await this._llmReply(processedMessages);
        } else {
          yield { type: 'mcp', message: 'MCP执行完成' };
        }
      } else {
        // 未启用 MCP，直接用 LLM 生成
        finalResponse = await this._llmReply(processedMessages);
      }

      // 5. 保存记忆
      if (this.config.enableMemorySave && this.rag) {
        yield { type: 'save', message: '正在保存记忆...' };
        
        await this.rag.saveOpenAIMessages(
          [
            { role: 'user', content: userMessage },
            { role: 'assistant', content: finalResponse }
          ],
          {
            conversationId: this.config.conversationId,
            userId: this.config.userId
          }
        ).catch(() => {});

        yield { type: 'save', message: '记忆已保存' };
      }

      // 更新历史
      this.conversationHistory.push({ role: 'user', content: userMessage });
      this.conversationHistory.push({ role: 'assistant', content: finalResponse });

      yield { type: 'complete', data: { response: finalResponse, keywords }, message: '完成' };

    } catch (error) {
      yield { type: 'error', error: error.message, message: '处理失败' };
    }
  }

  /**
   * 添加系统消息
   */
  addSystemMessage(content) {
    this.conversationHistory.push({ role: 'system', content });
  }

  /**
   * 清除对话历史
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * 获取对话历史
   */
  getHistory() {
    return this.conversationHistory;
  }

  /**
   * 获取Agent信息
   */
  getInfo() {
    return {
      initialized: this.initialized,
      conversationId: this.config.conversationId,
      userId: this.config.userId,
      historyLength: this.conversationHistory.length,
      features: {
        segmentation: this.config.enableSegmentation,
        rag: this.config.enableRAG,
        prompts: this.config.enablePrompts,
        mcp: this.config.enableMCP,
        memorySave: this.config.enableMemorySave
      }
    };
  }
}

// 导出默认实例
export const defaultAgent = new Agent();
