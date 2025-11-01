import crypto from 'crypto';
import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import embeddingService from './embedding.js';
import { textSegmentation } from './segmentation.js';
import { OpenAI } from 'openai';

const logger = createLogger('TextProcessor');

/**
 * 文本处理服务
 * 使用OpenAI API和智能分词系统进行文本分析
 */
class TextProcessor {
  constructor() {
    this.chunkSize = config.processing.chunkSize;
    this.chunkOverlap = config.processing.chunkOverlap;
    
    // 使用新的分词系统
    this.segmentation = textSegmentation;
    
    // 初始化OpenAI客户端
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL
    });

    // 定义文本分析工具
    this.analysisTools = this.getAnalysisTools();
  }

  /**
   * 获取OpenAI分析工具定义
   * @returns {Array} 工具定义数组
   */
  getAnalysisTools() {
    return [
      {
        type: "function",
        function: {
          name: "extract_entities",
          description: "从文本中提取实体信息，包括人名、地名、机构名、时间、概念等",
          parameters: {
            type: "object",
            properties: {
              entities: {
                type: "array",
                description: "提取的实体列表",
                items: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                      description: "实体名称"
                    },
                    type: {
                      type: "string",
                      enum: ["person", "location", "organization", "date", "concept", "product", "event", "number", "other"],
                      description: "实体类型"
                    },
                    confidence: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                      description: "置信度"
                    },
                    context: {
                      type: "string",
                      description: "实体在原文中的上下文"
                    }
                  },
                  required: ["name", "type", "confidence"]
                }
              }
            },
            required: ["entities"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "extract_relations",
          description: "从文本中提取实体间的关系",
          parameters: {
            type: "object",
            properties: {
              relations: {
                type: "array",
                description: "实体关系列表",
                items: {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      description: "源实体"
                    },
                    target: {
                      type: "string",
                      description: "目标实体"
                    },
                    relation: {
                      type: "string",
                      description: "关系类型"
                    },
                    confidence: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                      description: "置信度"
                    },
                    context: {
                      type: "string",
                      description: "关系在原文中的上下文"
                    }
                  },
                  required: ["source", "target", "relation", "confidence"]
                }
              }
            },
            required: ["relations"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "analyze_text_structure",
          description: "分析文本结构和主要内容",
          parameters: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                description: "文本摘要"
              },
              keywords: {
                type: "array",
                items: {
                  type: "string"
                },
                description: "关键词列表"
              },
              topics: {
                type: "array",
                items: {
                  type: "string"
                },
                description: "主题列表"
              },
              sentiment: {
                type: "string",
                enum: ["positive", "negative", "neutral", "mixed"],
                description: "情感倾向"
              },
              complexity: {
                type: "string",
                enum: ["simple", "medium", "complex"],
                description: "文本复杂度"
              }
            },
            required: ["summary", "keywords", "topics"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "propose_chunks",
          description: "根据文本内容提出最优的分块方案，优先自然边界切分，并输出语义自包含的上下文化文本",
          parameters: {
            type: "object",
            properties: {
              chunks: {
                type: "array",
                description: "分块结果列表（按顺序）",
                items: {
                  type: "object",
                  properties: {
                    content: { type: "string", description: "块原文内容（原样摘取）" },
                    contextualized: { type: "string", description: "上下文化改写（指代消解、补全主语，独立可读，便于检索）" },
                    start: { type: "integer", description: "块起始在原文中的字符索引" },
                    end: { type: "integer", description: "块结束在原文中的字符索引（开区间）" },
                    title: { type: "string", description: "块标题/小结（短语级）" },
                    summary: { type: "string", description: "块摘要（1-2 句，面向知识灌输）" },
                    keywords: { type: "array", items: { type: "string" }, description: "关键词列表（3-8 个）" },
                    entities: { type: "array", items: { type: "string" }, description: "片段涉及的关键实体（名称归一化）" },
                    sao: {
                      type: "array",
                      description: "SAO 三元组（Subject-Action-Object），用于知识归纳",
                      items: {
                        type: "object",
                        properties: {
                          subject: { type: "string" },
                          action: { type: "string" },
                          object: { type: "string" },
                          qualifiers: { type: "string", description: "限定语/条件/时间等，可选" }
                        }
                      }
                    }
                  },
                  required: ["content"]
                }
              }
            },
            required: ["chunks"]
          }
        }
      }
    ];
  }

  /**
   * 将文本分割成块（基于智能分词）
   * @param {string} text - 原始文本
   * @param {Object} options - 分割选项
   * @returns {Array} 文本块数组
   */
  async splitTextIntoChunks(text, options = {}) {
    try {
      const chunkSize = options.chunkSize || this.chunkSize;
      const overlap = options.overlap || this.chunkOverlap;
      const strategy = options.strategy || 'auto';
      
      logger.info(`开始智能分割文本: 长度 ${text.length}, 模式 ${strategy === 'auto' ? 'auto(segment+natural+mcp)' : strategy}, 配置 ${strategy === 'auto' ? '综合' : `chunkSize=${chunkSize}, overlap=${overlap}`}`);

      // Auto 模式：优先尝试 Tools 分块
      if (strategy === 'auto') {
        try {
          const aiChunks = await this.splitTextIntoChunksAuto(text);
          if (aiChunks && aiChunks.length) {
            logger.info(`分块完成: 生成 ${aiChunks.length} 个文本块`);
            return aiChunks;
          }
        } catch (e) {
          logger.warn('分块失败，回退到本地分块', { error: e.message });
        }
      }

      // 分词驱动的分块（强制使用分词器）
      if (strategy === 'segment') {
        return this.splitTextBySegments(text, { chunkSize, overlap, targetTokens: options.targetTokens });
      }

      // 使用新分词系统分析文本
      const segmentStats = this.segmentation.getSegmentationStats(text, { useSegmentation: true });
      const languageDistribution = this.segmentation.analyzeLanguageDistribution(text);
      
      logger.debug('文本分析结果', {
        primaryLanguage: segmentStats.primaryLanguage,
        segmentCount: segmentStats.segmentCount,
        chineseRatio: languageDistribution.chineseRatio.toFixed(2),
        englishRatio: languageDistribution.englishRatio.toFixed(2)
      });

      // 智能分块：优先按段落分割
      const chunks = [];
      const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      
      if (paragraphs.length > 1) {
        // 多段落文本：按段落组合分块
        let currentChunk = '';
        let chunkIndex = 0;
        
        for (const paragraph of paragraphs) {
          const trimmedParagraph = paragraph.trim();
          const testChunk = currentChunk + (currentChunk ? '\n\n' : '') + trimmedParagraph;
          
          if (testChunk.length <= chunkSize || currentChunk === '') {
            currentChunk = testChunk;
          } else {
            // 保存当前块
            if (currentChunk) {
              chunks.push(this.createChunk(currentChunk, chunkIndex++));
            }
            
            // 处理超长段落
            if (trimmedParagraph.length > chunkSize) {
              const subChunks = this.splitLongText(trimmedParagraph, chunkSize, overlap);
              for (const subChunk of subChunks) {
                chunks.push(this.createChunk(subChunk, chunkIndex++));
              }
              currentChunk = '';
            } else {
              currentChunk = trimmedParagraph;
            }
          }
        }
        
        if (currentChunk) {
          chunks.push(this.createChunk(currentChunk, chunkIndex++));
        }
      } else {
        // 单段落或无段落分割：按句子分块
        const sentences = this.splitIntoSentences(text);
        let currentChunk = '';
        let chunkIndex = 0;
        
        for (const sentence of sentences) {
          const trimmedSentence = sentence.trim();
          const testChunk = currentChunk + (currentChunk ? ' ' : '') + trimmedSentence;
          
          if (testChunk.length <= chunkSize || currentChunk === '') {
            currentChunk = testChunk;
          } else {
            if (currentChunk) {
              chunks.push(this.createChunk(currentChunk, chunkIndex++));
            }
            currentChunk = trimmedSentence;
          }
        }
        
        if (currentChunk) {
          chunks.push(this.createChunk(currentChunk, chunkIndex++));
        }
      }

      logger.info(`智能分割完成: 生成 ${chunks.length} 个文本块`);
      return chunks;

    } catch (error) {
      logger.error('文本分割失败', { error: error.message });
      throw new Error(`文本分割处理失败: ${error.message}`);
    }
  }

  /**
   * 使用 OpenAI Tools 提议分块（带大小约束与回退）
   * @param {string} text
   * @param {Object} options { chunkSize, overlap }
   * @returns {Promise<Array>} 文本块数组
   */
  async splitTextIntoChunksAuto(text, options = {}) {
    try {
      const proposed = await this.proposeChunksWithOpenAI(text);
      if (!Array.isArray(proposed) || proposed.length === 0) {
        return this.splitTextBySegments(text, { chunkSize: this.chunkSize, overlap: this.chunkOverlap });
      }

      // 直接采用 LLM 提议的分块（不进行任何长度强制）
      const chunks = [];
      let idx = 0;
      for (const item of proposed) {
        const raw = (item?.content || '').trim();
        const contextual = (item?.contextualized || '').trim();
        const toUse = contextual || raw;
        if (!toUse) continue;
        const chunk = this.createChunk(toUse, idx++, {
          rawContent: raw || null,
          title: item?.title || null,
          summary: item?.summary || null,
          keywords: Array.isArray(item?.keywords) ? item.keywords : null,
          contextualized: contextual || null,
          entities: Array.isArray(item?.entities) ? item.entities : null,
          sao: Array.isArray(item?.sao) ? item.sao : null,
          start: Number.isFinite(item?.start) ? item.start : undefined,
          end: Number.isFinite(item?.end) ? item.end : undefined
        });
        chunks.push(chunk);
      }
      return chunks;
    } catch (error) {
      logger.warn('分块异常，使用分词回退', { error: error.message });
      return this.splitTextBySegments(text, { chunkSize: this.chunkSize, overlap: this.chunkOverlap });
    }
  }

  /**
   * 通过 OpenAI Tools 生成分块建议
   * @param {string} text
   * @param {Object} options { chunkSize, overlap }
   * @returns {Promise<Array>} 原始分块对象数组（未 createChunk）
   */
  async proposeChunksWithOpenAI(text, options = {}) {
    try {
      const tool = this.analysisTools.find(t => t?.function?.name === 'propose_chunks');
      if (!tool) throw new Error('propose_chunks 工具未定义');

      const prompt = `你是一个专业的文本分块专家。请将以下文本按照逻辑和语义关系进行智能分块，并为每个分块生成标题和摘要。

分块要求：
1. **主体明确性**：每个分块必须包含明确的主体（人物、机构、项目、事件等），避免使用代词或模糊指代
2. **完整性**：每个分块应该是一个相对完整的语义单元，能够独立理解
3. **连贯性**：相关的信息应该归并到同一个分块中
4. **长度适中**：既不过于碎片化，也不过于冗长

标题生成要求：
- 必须明确指出主体
- 准确概括分块核心内容
- 长度控制
- 格式：[主体] + [核心行为/事件]`;

      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '你是一个精确的文本分块器。' },
          { role: 'user', content: `${prompt}\n\n文本：\n${text}` }
        ],
        tools: [tool],
        tool_choice: { type: 'function', function: { name: 'propose_chunks' } },
        temperature: 0.1
      });

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall || toolCall.function?.name !== 'propose_chunks') {
        return [];
      }

      let args;
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch (e) {
        logger.warn('解析 OpenAI propose_chunks 结果失败', { error: e.message });
        return [];
      }
      if (!args || !Array.isArray(args.chunks)) return [];
      return args.chunks;
    } catch (error) {
      logger.error('调用 OpenAI propose_chunks 失败', { error: error.message });
      return [];
    }
  }

  /**
   * 创建文本块对象
   * @param {string} content - 文本内容
   * @param {number} index - 块索引
   * @returns {Object} 文本块对象
   */
  createChunk(content, index, extra = {}) {
    const text = (content || '').trim();
    const segmentStats = this.segmentation.getSegmentationStats(text);

    const chunk = {
      id: this.generateChunkId(),
      content: text,
      index: index,
      length: text.length,
      wordCount: segmentStats.segmentCount,
      primaryLanguage: segmentStats.primaryLanguage,
      tokens: this.estimateTokenCount(text)
    };

    if (extra && typeof extra === 'object') {
      if (extra.rawContent) chunk.rawContent = String(extra.rawContent);
      if (extra.contextualized) chunk.contextualized = String(extra.contextualized);
      if (extra.title) chunk.title = String(extra.title);
      if (extra.summary) chunk.summary = String(extra.summary);
      if (Array.isArray(extra.keywords)) chunk.keywords = extra.keywords.map(String);
      if (Number.isFinite(extra.start)) chunk.start = extra.start;
      if (Number.isFinite(extra.end)) chunk.end = extra.end;
      if (Array.isArray(extra.entities)) chunk.entities = extra.entities.map(String);
      if (Array.isArray(extra.sao)) chunk.sao = extra.sao;
    }

    // 标题与摘要兜底：确保不会出现空标题
    const ctx = (chunk.contextualized || chunk.content || '').trim();
    if (!chunk.title || !String(chunk.title).trim()) {
      const parts = [];
      if (Array.isArray(chunk.keywords) && chunk.keywords.length) {
        parts.push(chunk.keywords.slice(0, 2).join('、'));
      } else if (Array.isArray(chunk.entities) && chunk.entities.length) {
        parts.push(chunk.entities[0]);
      }
      const firstSentence = (ctx.split(/[。！？.!?\n]/)[0] || '').trim();
      const base = firstSentence || ctx.slice(0, 24);
      const title = parts.length ? `${parts.join(' ')} | ${base.slice(0, 24)}` : base.slice(0, 24);
      chunk.title = title || '未命名段落';
    }

    if (!chunk.summary || !String(chunk.summary).trim()) {
      const firstTwo = ctx.split(/[。！？.!?\n]/).slice(0, 2).join(' ').trim();
      const summary = firstTwo || ctx.slice(0, 80);
      chunk.summary = summary;
    }

    return chunk;
  }

  /**
   * 分割长文本
   * @param {string} text - 长文本
   * @param {number} maxSize - 最大块大小
   * @param {number} overlap - 重叠字符数
   * @returns {Array} 分割后的文本块
   */
  splitLongText(text, maxSize, overlap) {
    const chunks = [];
    let position = 0;
    
    while (position < text.length) {
      const endPos = Math.min(position + maxSize, text.length);
      let chunkText = text.slice(position, endPos);
      
      // 在句子边界处分割
      if (endPos < text.length) {
        const lastSentenceEnd = Math.max(
          chunkText.lastIndexOf('。'),
          chunkText.lastIndexOf('.'),
          chunkText.lastIndexOf('!'),
          chunkText.lastIndexOf('?')
        );
        
        if (lastSentenceEnd > maxSize * 0.5) {
          chunkText = text.slice(position, position + lastSentenceEnd + 1);
        }
      }
      
      chunks.push(chunkText);
      position += Math.max(chunkText.length - overlap, 1);
    }
    
    return chunks;
  }

  /**
   * 基于分词结果进行分块
   * @param {string} text - 文本
   * @param {Object} opts - 选项 { chunkSize, overlap, targetTokens }
   * @returns {Array} 文本块数组
   */
  splitTextBySegments(text, opts = {}) {
    const { chunkSize = this.chunkSize, overlap = this.chunkOverlap } = opts;
    try {
      const tokens = this.segmentation.segment(text, { useSegmentation: true }) || [text];
      logger.debug('分词驱动分块', { tokenCount: tokens.length, chunkSize, overlap });

      const chunks = [];
      let buffer = '';
      let index = 0;

      const isAsciiWordChar = ch => /[A-Za-z0-9]/.test(ch || '');
      const appendToken = (buf, token) => {
        if (!buf) return token;
        const needSpace = isAsciiWordChar(buf[buf.length - 1]) && isAsciiWordChar(token[0]);
        return buf + (needSpace ? ' ' : '') + token;
      };

      for (const token of tokens) {
        const test = appendToken(buffer, token);
        if (test.length <= chunkSize || buffer.length === 0) {
          buffer = test;
        } else {
          // 生成一个块
          chunks.push(this.createChunk(buffer, index++));
          // 处理重叠
          if (overlap > 0) {
            const tail = buffer.slice(Math.max(0, buffer.length - overlap));
            buffer = appendToken(tail, token);
          } else {
            buffer = token;
          }
        }
      }

      if (buffer && buffer.trim().length > 0) {
        chunks.push(this.createChunk(buffer, index++));
      }

      logger.info(`分词驱动分块完成: 生成 ${chunks.length} 个文本块`);
      return chunks;
    } catch (error) {
      logger.error('分词驱动分块失败', { error: error.message });
      return [this.createChunk(text, 0)];
    }
  }

  /**
   * 分割句子
   * @param {string} text - 文本
   * @returns {Array} 句子数组
   */
  splitIntoSentences(text) {
    // 基于标点符号分割句子
    return text.split(/([。！？.!?])\s*/)
      .reduce((sentences, part, index, array) => {
        if (index % 2 === 0) {
          const sentence = part + (array[index + 1] || '');
          if (sentence.trim()) {
            sentences.push(sentence.trim());
          }
        }
        return sentences;
      }, []);
  }

  /**
   * 使用OpenAI提取实体
   * @param {string} text - 文本内容
   * @param {Object} options - 提取选项
   * @returns {Array} 实体数组
   */
  async extractEntities(text, options = {}) {
    try {
      logger.debug('开始使用OpenAI提取实体', { textLength: text.length });

      const prompt = `请分析以下文本并提取其中的实体信息。注意识别人名、地名、机构名、时间、概念等各类实体，并为每个实体标注类型和置信度。

文本内容：
${text}

请使用extract_entities工具返回结果。`;

      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        tools: [this.analysisTools[0]], // 只使用实体提取工具
        tool_choice: { type: "function", function: { name: "extract_entities" } },
        temperature: 0.1
      });

      const toolCall = response.choices[0].message.tool_calls?.[0];
      if (toolCall && toolCall.function.name === 'extract_entities') {
        const result = JSON.parse(toolCall.function.arguments);
        const entities = result.entities.map(entity => ({
          ...entity,
          id: this.generateEntityId(),
          extractedBy: 'openai'
        }));

        logger.info(`OpenAI实体提取完成: 发现 ${entities.length} 个实体`);
        return entities;
      }

      return [];

    } catch (error) {
      logger.error('OpenAI实体提取失败', { error: error.message });
      throw new Error(`实体提取处理失败: ${error.message}`);
    }
  }

  /**
   * 使用OpenAI提取关系
   * @param {string} text - 文本内容
   * @param {Array} entities - 实体列表
   * @returns {Array} 关系数组
   */
  async extractRelations(text, entities) {
    try {
      logger.debug('开始使用OpenAI提取关系', { textLength: text.length, entityCount: entities.length });

      const entityNames = entities.map(e => e.name).join(', ');
      const prompt = `请分析以下文本中实体间的关系。已识别的实体包括：${entityNames}

文本内容：
${text}

请识别实体间的关系，如"工作于"、"位于"、"拥有"、"参与"等，并为每个关系标注置信度。

请使用extract_relations工具返回结果。`;

      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        tools: [this.analysisTools[1]], // 只使用关系提取工具
        tool_choice: { type: "function", function: { name: "extract_relations" } },
        temperature: 0.1
      });

      const toolCall = response.choices[0].message.tool_calls?.[0];
      if (toolCall && toolCall.function.name === 'extract_relations') {
        const result = JSON.parse(toolCall.function.arguments);
        const relations = result.relations.map(relation => ({
          ...relation,
          id: this.generateRelationId(),
          extractedBy: 'openai'
        }));

        logger.info(`OpenAI关系提取完成: 发现 ${relations.length} 个关系`);
        return relations;
      }

      return [];

    } catch (error) {
      logger.error('OpenAI关系提取失败', { error: error.message });
      throw new Error(`关系提取处理失败: ${error.message}`);
    }
  }

  /**
   * 使用OpenAI分析文本结构
   * @param {string} text - 文本内容
   * @returns {Object} 分析结果
   */
  async analyzeTextStructure(text) {
    try {
      logger.debug('开始使用OpenAI分析文本结构', { textLength: text.length });

      const prompt = `请分析以下文本的结构和主要内容：

文本内容：
${text}

请提供文本摘要、关键词、主题、情感倾向和复杂度分析。

请使用analyze_text_structure工具返回结果。`;

      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        tools: [this.analysisTools[2]], // 只使用文本结构分析工具
        tool_choice: { type: "function", function: { name: "analyze_text_structure" } },
        temperature: 0.3
      });

      const toolCall = response.choices[0].message.tool_calls?.[0];
      if (toolCall && toolCall.function.name === 'analyze_text_structure') {
        const result = JSON.parse(toolCall.function.arguments);
        
        logger.info('OpenAI文本结构分析完成', {
          summaryLength: result.summary?.length || 0,
          keywordCount: result.keywords?.length || 0,
          topicCount: result.topics?.length || 0
        });
        
        return {
          ...result,
          analyzedBy: 'openai'
        };
      }

      return {};

    } catch (error) {
      logger.error('OpenAI文本结构分析失败', { error: error.message });
      throw new Error(`文本结构分析失败: ${error.message}`);
    }
  }

  /**
   * 统计词数（使用分词系统）
   * @param {string} text - 文本
   * @returns {number} 词数
   */
  countWords(text) {
    const segments = this.segmentation.segment(text, { useSegmentation: true });
    return segments.filter(segment => segment.trim().length > 0).length;
  }

  /**
   * 估算token数量
   * @param {string} text - 文本内容
   * @returns {number} 估算的token数量
   */
  estimateTokenCount(text) {
    // 简单估算：中文字符约等于1个token，英文单词约等于1.3个token
    const languageDistribution = this.segmentation.analyzeLanguageDistribution(text);
    const chineseTokens = languageDistribution.chinese;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return Math.ceil(chineseTokens + englishWords * 1.3);
  }

  /**
   * 处理完整的文本文档
   * @param {string} text - 文档文本
   * @param {string} documentId - 文档ID
   * @returns {Object} 处理结果
   */
  async processDocument(text, documentId) {
    try {
      logger.info(`开始处理文档: ${documentId}`);

      // 1. 分割文本（默认使用 OpenAI Tools 的 Auto 模式，失败时自动回退）
      const chunks = await this.splitTextIntoChunksAuto(text);

      // 2. 为每个块生成增强嵌入向量（结合多种信息）
      const enrichedTexts = chunks.map(chunk => {
        const parts = [];
        // 主要内容（优先上下文化文本）
        if (chunk.contextualized) parts.push(`内容: ${chunk.contextualized}`);
        else if (chunk.content) parts.push(`内容: ${chunk.content}`);
        
        // 标题和摘要
        if (chunk.title) parts.push(`标题: ${chunk.title}`);
        if (chunk.summary) parts.push(`摘要: ${chunk.summary}`);
        
        // 关键词和实体
        if (Array.isArray(chunk.keywords) && chunk.keywords.length) {
          parts.push(`关键词: ${chunk.keywords.join(', ')}`);
        }
        if (Array.isArray(chunk.entities) && chunk.entities.length) {
          parts.push(`实体: ${chunk.entities.join(', ')}`);
        }
        
        // SAO三元组
        if (Array.isArray(chunk.sao) && chunk.sao.length) {
          const saoTexts = chunk.sao.map(s => `${s.subject}-${s.action}-${s.object}`);
          parts.push(`关系: ${saoTexts.join('; ')}`);
        }
        
        return parts.join('\n');
      });
      
      const embeddings = await embeddingService.getTextEmbedding(enrichedTexts);

      // 3. 将嵌入向量关联到块
      chunks.forEach((chunk, index) => {
        chunk.embedding = embeddings[index];
        chunk.documentId = documentId;
      });

      // 4. 提取实体
      const entities = await this.extractEntities(text);

      // 5. 提取关系
      const relations = await this.extractRelations(text, entities);

      // 6. 分析文本结构
      const structure = await this.analyzeTextStructure(text);

      const result = {
        documentId,
        chunks,
        entities,
        relations,
        structure,
        statistics: {
          totalLength: text.length,
          chunkCount: chunks.length,
          entityCount: entities.length,
          relationCount: relations.length,
          estimatedTokens: this.estimateTokenCount(text)
        }
      };

      logger.info(`文档处理完成: ${documentId}`, {
        chunks: result.chunks.length,
        entities: result.entities.length,
        relations: result.relations.length
      });

      return result;

    } catch (error) {
      logger.error('文档处理失败', { documentId, error: error.message });
      throw new Error(`文档处理失败: ${error.message}`);
    }
  }

  /**
   * 生成文本块ID
   * @returns {string} 唯一ID
   */
  generateChunkId() {
    return `chunk_${crypto.randomUUID()}`;
  }

  /**
   * 生成实体ID
   * @returns {string} 唯一ID
   */
  generateEntityId() {
    return `entity_${crypto.randomUUID()}`;
  }

  /**
   * 生成关系ID
   * @returns {string} 唯一ID
   */
  generateRelationId() {
    return `relation_${crypto.randomUUID()}`;
  }
}

export default new TextProcessor();
