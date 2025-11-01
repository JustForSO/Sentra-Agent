import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Agent 类 - 支持配置化的 AI 对话代理
 */
class Agent {
  constructor(config = {}) {
    // 支持自定义环境变量路径
    if (config.envPath) {
      const envPath = path.resolve(config.envPath);
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
      }
    }
    
    // 配置优先级：传入参数 > 环境变量 > 默认值
    this.config = {
      apiKey: config.apiKey || process.env.API_KEY || process.env.OPENAI_API_KEY,
      apiBaseUrl: config.apiBaseUrl || process.env.API_BASE_URL || 'https://api.openai.com/v1',
      defaultModel: config.defaultModel || process.env.MODEL_NAME || 'gpt-3.5-turbo',
      temperature: parseFloat(config.temperature || process.env.TEMPERATURE || '0.7'),
      maxTokens: parseInt(config.maxTokens || process.env.MAX_TOKENS || '20000'),
      maxRetries: parseInt(config.maxRetries || process.env.MAX_RETRIES || '3'),
      timeout: parseInt(config.timeout || process.env.TIMEOUT || '60000'),
      stream: config.stream !== undefined ? config.stream : false
    };
    
    if (!this.config.apiKey) {
      throw new Error('API_KEY is required. Please set API_KEY environment variable or pass it in config.');
    }
  }
  
  /**
   * 发送聊天请求
   * @param {Array} messages - 消息数组
   * @param {String|Object} modelOrOptions - 模型名称或配置对象
   * @returns {Promise<String>} AI 回复内容
   */
  async chat(messages, modelOrOptions = {}) {
    // 兼容旧版API：直接传模型名称
    const options = typeof modelOrOptions === 'string' 
      ? { model: modelOrOptions }
      : modelOrOptions;
    
    const requestConfig = {
      model: options.model || this.config.defaultModel,
      temperature: options.temperature !== undefined ? options.temperature : this.config.temperature,
      stream: options.stream !== undefined ? options.stream : this.config.stream,
      messages: messages
    };
    
    // maxTokens为-1时不限制，不添加max_tokens字段
    const maxTokens = options.maxTokens !== undefined ? options.maxTokens : this.config.maxTokens;
    if (maxTokens !== -1) {
      requestConfig.max_tokens = maxTokens;
    }
    
    // 添加可选参数
    if (options.topP !== undefined) requestConfig.top_p = options.topP;
    if (options.frequencyPenalty !== undefined) requestConfig.frequency_penalty = options.frequencyPenalty;
    if (options.presencePenalty !== undefined) requestConfig.presence_penalty = options.presencePenalty;
    if (options.stop !== undefined) requestConfig.stop = options.stop;
    
    // 添加 tools 和 tool_choice 支持（OpenAI function calling）
    if (options.tools !== undefined) requestConfig.tools = options.tools;
    if (options.tool_choice !== undefined) requestConfig.tool_choice = options.tool_choice;
    
    let lastError = null;
    
    // 重试机制
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.config.apiBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify(requestConfig),
          signal: AbortSignal.timeout(this.config.timeout)
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { message: errorText };
          }
          
          throw new Error(
            `API request failed (${response.status}): ${errorData.error?.message || errorData.message || errorText}`
          );
        }

        const data = await response.json();
        
        if (!data.choices || !data.choices[0]) {
          throw new Error('Invalid API response: missing choices');
        }
        
        const message = data.choices[0].message;
        
        // 如果使用了 tools，优先返回 tool_calls 的参数（解析后的JSON对象）
        if (message.tool_calls && message.tool_calls.length > 0) {
          const toolCall = message.tool_calls[0];
          if (toolCall.function && toolCall.function.arguments) {
            try {
              // 返回解析后的JSON对象
              return JSON.parse(toolCall.function.arguments);
            } catch (parseError) {
              console.warn('[Agent] 解析tool_calls参数失败:', parseError.message);
              // 如果解析失败，返回原始字符串
              return toolCall.function.arguments;
            }
          }
        }
        
        // 否则返回普通的文本内容
        return message.content;
      } catch (error) {
        lastError = error;
        
        // 如果是超时或网络错误，且还有重试次数，则等待后重试
        if (attempt < this.config.maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // 指数退避
          console.warn(`请求失败，${delay}ms 后重试 (${attempt + 1}/${this.config.maxRetries}):`, error.message);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
    }
    
    // 所有重试都失败
    console.error(`[Agent] AI生成失败 (${this.config.maxRetries}次尝试): ${lastError.message}`);
    
    // 如果配置了跳过失败，返回null而不是抛出错误
    if (process.env.SKIP_ON_GENERATION_FAIL === 'true') {
      return null;
    }
    
    throw new Error(`Failed to call AI API after ${this.config.maxRetries} attempts: ${lastError.message}`);
  }
  
  /**
   * 流式聊天（如果需要支持）
   * @param {Array} messages - 消息数组
   * @param {Object} options - 配置选项
   * @param {Function} onChunk - 处理每个chunk的回调
   * @returns {Promise<String>} 完整的回复内容
   */
  async chatStream(messages, options = {}, onChunk) {
    const requestConfig = {
      model: options.model || this.config.defaultModel,
      temperature: options.temperature !== undefined ? options.temperature : this.config.temperature,
      stream: true,
      messages: messages
    };
    
    // maxTokens为-1时不限制，不添加max_tokens字段
    const maxTokens = options.maxTokens !== undefined ? options.maxTokens : this.config.maxTokens;
    if (maxTokens !== -1) {
      requestConfig.max_tokens = maxTokens;
    }
    
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(requestConfig),
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed (${response.status}): ${errorText}`);
      }

      let fullContent = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;
              if (content) {
                fullContent += content;
                if (onChunk) onChunk(content);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
      
      return fullContent;
    } catch (error) {
      throw new Error(`Failed to call AI API (stream): ${error.message}`);
    }
  }
}

// 导出默认实例（兼容旧代码）
const defaultAgent = new Agent();

export default defaultAgent;
export { Agent };