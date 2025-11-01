#!/usr/bin/env node

/**
 * 数据存储和检索测试脚本
 */

import dotenv from 'dotenv';
import chalk from 'chalk';
import { validateConfig } from '../src/config/index.js';
import neo4jStorage from '../src/database/neo4j.js';
import textProcessor from '../src/services/textProcessor.js';
import embeddingService from '../src/services/embedding.js';

// 加载环境变量
dotenv.config();

/**
 * 测试数据存储功能
 */
async function testDataStorage() {
  console.log(chalk.bold.cyan('🚀 开始数据存储和检索测试\n'));

  try {
    // 1. 验证配置
    console.log(chalk.bold('1️⃣ 验证系统配置...'));
    validateConfig();
    console.log(chalk.green('✅ 配置验证通过\n'));

    // 2. 初始化数据库连接
    console.log(chalk.bold('2️⃣ 初始化数据库连接...'));
    await neo4jStorage.initialize();
    console.log(chalk.green('✅ 数据库连接成功\n'));

    // 3. 测试文本处理和存储
    console.log(chalk.bold('3️⃣ 测试文本处理功能...'));
    const testText = `
Sentra是集成世界树VCP模拟+向量记忆储存+拟真情绪算法系统+MCP集成工具流插件系统+聊天软件适配+程序窗口自动化操作的高度拟人化Agent系统。
Sentra api是免费 AI API 供应商
适合个人学习、原型测试或小型项目使用。

小贴士
认准官网域名：避免通过陌生链接注册，防止钓鱼网站窃取信息。
不要泄露 API Key：Key 相当于账户密码，一旦泄露可能导致额度被盗用甚至账户封禁。
警惕高额承诺：如果有人声称“永久免费无限调用”且需要付费解锁，基本都是骗局。
不要轻信第三方转售：正规 API 都可直接在官网申请。
    `.trim();

    console.log(chalk.gray(`📝 测试文本长度: ${testText.length} 字符`));

    // 4. 分割文本
    console.log(chalk.bold('4️⃣ 智能分割文本...'));
    const chunks = await textProcessor.splitTextIntoChunks(testText);
    console.log(chalk.green(`✅ 分割完成: ${chunks.length} 个文本块`));
    chunks.forEach((chunk, index) => {
      console.log(chalk.yellow(`\n—— 块 ${index + 1} ——`));
      console.log(chalk.white(`content:`));
      console.log(chunk.content);
      if (chunk.contextualized) {
        console.log(chalk.white(`contextualized:`));
        console.log(chunk.contextualized);
      }
      const title = chunk.title ? String(chunk.title) : null;
      const summary = chunk.summary ? String(chunk.summary) : null;
      if (title) console.log(chalk.magenta(`title: ${title}`));
      if (summary) console.log(chalk.magenta(`summary: ${summary}`));
      if (Array.isArray(chunk.keywords)) console.log(chalk.blue(`keywords: ${chunk.keywords.join(', ')}`));
      if (Array.isArray(chunk.entities)) console.log(chalk.blue(`entities: ${chunk.entities.join(', ')}`));
      if (Array.isArray(chunk.sao)) {
        console.log(chalk.blue(`sao:`));
        chunk.sao.forEach((triple, i2) => {
          const q = triple.qualifiers ? ` | ${triple.qualifiers}` : '';
          console.log(`   [${i2 + 1}] ${triple.subject} —${triple.action}→ ${triple.object}${q}`);
        });
      }
    });
    console.log('');

    // 5. 提取实体
    console.log(chalk.bold('5️⃣ 测试实体提取...'));
    try {
      const entities = await textProcessor.extractEntities(testText);
      console.log(chalk.green(`✅ 实体提取完成: ${entities.length} 个实体`));
      entities.slice(0, 10).forEach(entity => {
        console.log(chalk.white(`   - ${entity.name} (${entity.type}) - 置信度: ${entity.confidence.toFixed(2)}`));
      });
    } catch (error) {
      console.log(chalk.yellow(`⚠️ 实体提取失败 (可能是API配置问题): ${error.message}`));
    }
    console.log('');

    // 6. 生成嵌入向量
    console.log(chalk.bold('6️⃣ 测试向量嵌入...'));
    try {
      const embeddings = await embeddingService.getTextEmbedding([testText.substring(0, 100)]);
      console.log(chalk.green(`✅ 向量生成成功: 维度 ${embeddings[0].length}`));
    } catch (error) {
      console.log(chalk.yellow(`⚠️ 向量生成失败 (可能是API配置问题): ${error.message}`));
    }
    console.log('');

    // 7. 测试数据库存储
    console.log(chalk.bold('7️⃣ 测试数据库存储...'));
    const documentId = `test-doc-${Date.now()}`;
    
    // 存储文档
    await neo4jStorage.saveDocument({
      id: documentId,
      title: '测试文档',
      content: testText,
      filename: 'test.txt',
      type: 'text',
      size: testText.length,
      created_at: new Date().toISOString()
    });
    console.log(chalk.green(`✅ 文档存储成功: ${documentId}`));

    // 为每个文本块生成嵌入（组合多种文本信息）
    console.log(chalk.bold('🧮 正在为文本块生成增强向量...'));
    let chunkEmbeddings = [];
    try {
      const enrichedTexts = chunks.map(c => {
        const parts = [];
        // 主要内容
        if (c.contextualized) parts.push(`内容: ${c.contextualized}`);
        else if (c.content) parts.push(`内容: ${c.content}`);
        
        // 标题和摘要
        if (c.title) parts.push(`标题: ${c.title}`);
        if (c.summary) parts.push(`摘要: ${c.summary}`);
        
        // 关键词和实体
        if (Array.isArray(c.keywords) && c.keywords.length) {
          parts.push(`关键词: ${c.keywords.join(', ')}`);
        }
        if (Array.isArray(c.entities) && c.entities.length) {
          parts.push(`实体: ${c.entities.join(', ')}`);
        }
        
        // SAO三元组
        if (Array.isArray(c.sao) && c.sao.length) {
          const saoTexts = c.sao.map(s => `${s.subject}-${s.action}-${s.object}`);
          parts.push(`关系: ${saoTexts.join('; ')}`);
        }
        
        return parts.join('\n');
      });
      
      console.log(chalk.gray('🔍 增强文本示例:'));
      console.log(chalk.white(enrichedTexts[0]?.substring(0, 200) + '...'));
      
      chunkEmbeddings = await embeddingService.getTextEmbedding(enrichedTexts);
      console.log(chalk.green(`✅ 已生成 ${chunkEmbeddings.length} 个增强向量，维度 ${chunkEmbeddings[0]?.length || 0}`));
    } catch (e) {
      console.log(chalk.yellow(`⚠️ 生成增强向量失败，回退到基础向量: ${e.message}`));
      try {
        const contents = chunks.map(c => c.contextualized || c.content);
        chunkEmbeddings = await embeddingService.getTextEmbedding(contents);
      } catch (e2) {
        console.log(chalk.yellow(`⚠️ 生成向量失败，将继续保存无向量数据: ${e2.message}`));
      }
    }

    // 存储文本块（包含embedding）
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      await neo4jStorage.saveChunk({
        id: chunk.id,
        document_id: documentId,
        content: chunk.content,
        contextualized: chunk.contextualized || null,
        title: chunk.title || null,
        summary: chunk.summary || null,
        keywords: Array.isArray(chunk.keywords) ? chunk.keywords : null,
        entities: Array.isArray(chunk.entities) ? chunk.entities : null,
        sao: Array.isArray(chunk.sao) ? chunk.sao : null,
        start: Number.isFinite(chunk.start) ? chunk.start : null,
        end: Number.isFinite(chunk.end) ? chunk.end : null,
        index: i,
        tokens: chunk.tokens || 0,
        embedding: Array.isArray(chunkEmbeddings[i]) ? chunkEmbeddings[i] : null
      });
    }
    console.log(chalk.green(`✅ 文本块存储成功: ${chunks.length} 个块`));

    // 8. 测试数据检索
    console.log(chalk.bold('8️⃣ 测试数据检索...'));
    
    // 查询文档
    const documents = await neo4jStorage.getDocuments({ limit: 10 });
    console.log(chalk.green(`✅ 文档查询成功: 找到 ${documents.length} 个文档`));

    // 查询文本块
    const retrievedChunks = await neo4jStorage.getChunksByDocumentId(documentId);
    console.log(chalk.green(`✅ 文本块查询成功: 找到 ${retrievedChunks.length} 个块`));

    // 9. 测试增强搜索功能
    console.log(chalk.bold('9️⃣ 测试增强搜索功能...'));
    
    // 9.1 关键词搜索测试
    console.log(chalk.cyan('🔍 测试关键词搜索: "Sentra"'));
    const keywordResults = await neo4jStorage.searchChunks('Sentra', { limit: 5, mode: 'hybrid' });
    console.log(chalk.green(`✅ 关键词搜索成功: 找到 ${keywordResults.length} 个相关块`));
    keywordResults.forEach((r, i) => {
      console.log(chalk.white(`   [${i + 1}] ${r.matchType} score=${r.score} - ${r.title || 'No title'}`));
    });
    
    // 9.2 基础文本搜索
    console.log(chalk.cyan('🔍 测试文本搜索: "Sentra"'));
    const searchResults = await neo4jStorage.searchChunks('Sentra', { limit: 5, mode: 'hybrid' });
    console.log(chalk.green(`✅ 文本搜索成功: 找到 ${searchResults.length} 个相关块`));

    // 9.3 向量检索测试（若块向量存在）
    console.log(chalk.cyan('🔍 测试向量检索: "Sentra 向量记忆 拟真情绪 MCP 自动化 Agent 系统"'));
    try {
      const queryText = 'Sentra 向量记忆 拟真情绪 MCP 自动化 Agent 系统';
      const queryEmbedding = await embeddingService.getTextEmbedding(queryText);
      const vectorResults = await neo4jStorage.vectorSimilaritySearch(queryEmbedding, { topK: 5 });
      console.log(chalk.green(`✅ 向量检索成功: 返回 ${vectorResults.length} 条`));
      vectorResults.forEach((r, i) => {
        const preview = String(r.contextualized || r.content);
        const scoreStr = r.score?.toFixed ? r.score.toFixed(4) : r.score;
        console.log(chalk.white(`   [${i + 1}] score=${scoreStr}`));
        if (r.title) console.log(chalk.magenta(`      title: ${r.title}`));
        if (r.summary) console.log(chalk.magenta(`      summary: ${r.summary}`));
        if (Array.isArray(r.keywords)) console.log(chalk.blue(`      keywords: ${r.keywords.join(', ')}`));
        if (Array.isArray(r.entities)) console.log(chalk.blue(`      entities: ${r.entities.join(', ')}`));
        if (Array.isArray(r.sao)) console.log(chalk.blue(`      sao: ${r.sao.join(' | ')}`));
        if (typeof r.timestamp === 'number') console.log(chalk.gray(`      ts: ${r.timestamp}`));
        console.log(preview);
      });
    } catch (e) {
      console.log(chalk.yellow(`⚠️ 向量检索失败: ${e.message}`));
    }
    
    // 9.4 专门的关键词向量检索测试
    console.log(chalk.cyan('🔍 测试关键词向量检索: "Sentra"'));
    try {
      const keywordQueryEmbedding = await embeddingService.getTextEmbedding('Sentra VCP 向量记忆 拟真情绪 MCP');
      const keywordVectorResults = await neo4jStorage.vectorSimilaritySearch(keywordQueryEmbedding, { topK: 3 });
      console.log(chalk.green(`✅ 关键词向量检索成功: 返回 ${keywordVectorResults.length} 条`));
      keywordVectorResults.forEach((r, i) => {
        const scoreStr = r.score?.toFixed ? r.score.toFixed(4) : r.score;
        console.log(chalk.white(`   [${i + 1}] score=${scoreStr} - ${r.title || '无标题'}`));
        if (r.keywords) console.log(chalk.blue(`        关键词: ${Array.isArray(r.keywords) ? r.keywords.join(', ') : r.keywords}`));
        if (typeof r.timestamp === 'number') console.log(chalk.gray(`        ts: ${r.timestamp}`));
      });
    } catch (e) {
      console.log(chalk.yellow(`⚠️ 关键词向量检索失败: ${e.message}`));
    }

    // 9.5 时间戳检索测试（按时间段，使用数字时间戳范围）
    console.log(chalk.cyan('🔍 测试时间检索: 我们100分钟前聊了什么'));
    try {
      const now = Date.now();
      const start = now - 100 * 60 * 1000;
      const recentResults = await neo4jStorage.searchChunksByTimestamp({ startTime: start, endTime: now }, { limit: 3, orderBy: 'desc' });
      console.log(chalk.green(`✅ 时间戳检索成功: 返回 ${recentResults.length} 条`));
      recentResults.forEach((r, i) => {
        console.log(chalk.white(`   [${i + 1}] ts=${r.timestamp} - ${r.title || '无标题'}`));
        console.log(chalk.gray(`        内容预览: ${(r.contextualized || r.content || '').substring(0, 50)}...`));
      });
    } catch (e) {
      console.log(chalk.yellow(`⚠️ 时间戳检索失败: ${e.message}`));
    }

    // 10. 清理测试数据
    console.log(chalk.bold('🔟 清理测试数据...'));
    await neo4jStorage.deleteDocument(documentId);
    console.log(chalk.green('✅ 测试数据清理完成'));

    // 10.1 额外清理：按文件名删除可能残留的同名文档
    try {
      const extra = await neo4jStorage.deleteDocumentsByFilename('test.txt');
      if (extra?.deleted) {
        console.log(chalk.gray(`🧹 额外清理完成: 按文件名删除 ${extra.deleted} 条`));
      }
    } catch {}

    console.log(chalk.bold.green('\n🎉 所有测试通过！系统功能正常'));

  } catch (error) {
    console.error(chalk.red('\n❌ 测试失败:'), error.message);
    console.error(chalk.red('详细错误:'), error.stack);
    process.exit(1);
  } finally {
    // 关闭数据库连接
    try {
      await neo4jStorage.close();
      console.log('✅ 数据库连接已关闭');
    } catch (error) {
      console.error('⚠️ 关闭数据库连接时出错:', error.message);
    }
  }
}

/**
 * 运行测试
 */
testDataStorage().catch(console.error);
