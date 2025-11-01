import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';
import imageProcessor from '../src/services/imageProcessor.js';
import neo4jStorage from '../src/database/neo4j.js';

const logger = {
  info: (msg, data) => console.log(chalk.blue('ℹ️'), msg, data ? chalk.gray(JSON.stringify(data)) : ''),
  error: (msg, data) => console.log(chalk.red('❌'), msg, data ? chalk.gray(JSON.stringify(data)) : ''),
  warn: (msg, data) => console.log(chalk.yellow('⚠️'), msg, data ? chalk.gray(JSON.stringify(data)) : ''),
  success: (msg, data) => console.log(chalk.green('✅'), msg, data ? chalk.gray(JSON.stringify(data)) : '')
};

// 步骤计时工具
function step(title) {
  console.log(chalk.bold.cyan(`\n=== ${title} ===`));
  return Date.now();
}
function done(start, extra = '') {
  const ms = Date.now() - start;
  console.log(chalk.gray(`→ 用时 ${ms}ms${extra ? ' | ' + extra : ''}`));
}

/**
 * 测试图片处理和检索功能
 */
async function testImageProcessing() {
  try {
    console.log(chalk.bold.cyan('🖼️ Sentra RAG - 图片处理测试'));
    console.log(chalk.gray('='.repeat(50)));

    // 1. 检查配置
    console.log(chalk.bold('1️⃣ 检查配置...'));
    logger.info('视觉模型配置', {
      model: process.env.VISION_MODEL,
      baseURL: process.env.VISION_BASE_URL,
      maxTokens: process.env.VISION_MAX_TOKENS
    });
    console.log(chalk.gray(`NEO4J_URI=${process.env.NEO4J_URI || '-'}  OPENAI_BASE_URL=${process.env.OPENAI_BASE_URL || '-'}  LOG_LEVEL=${process.env.LOG_LEVEL || '-'}\n`));

    // 2. 初始化数据库连接
    let t = step('2️⃣ 初始化数据库连接');
    await neo4jStorage.initialize();
    done(t);
    logger.success('数据库连接成功');

    // 3. 检查支持的格式
    console.log(chalk.bold('\n3️⃣ 检查支持的图片格式...'));
    const supportedFormats = imageProcessor.getSupportedFormats();
    const supportedMimeTypes = imageProcessor.getSupportedMimeTypes();
    const formatsInfo = imageProcessor.getSupportedFormatsInfo();
    
    logger.info('支持的格式', supportedFormats);
    logger.info('支持的MIME类型', supportedMimeTypes.slice(0, 5));
    
    // 显示格式信息
    console.log(chalk.cyan('\n📋 格式详情:'));
    Object.entries(formatsInfo).slice(0, 6).forEach(([ext, info]) => {
      console.log(chalk.white(`   ${ext.toUpperCase()}: ${info.description} (${info.mimeType})`));
    });

    // 4. 测试格式验证
    console.log(chalk.bold('\n4️⃣ 测试格式验证...'));
    const testFiles = [
      'test.jpg',
      'test.png', 
      'test.gif',
      'test.webp',
      'test.txt',
      'test.svg'
    ];
    
    testFiles.forEach(filename => {
      const isSupported = imageProcessor.isSupportedImageFormat(filename);
      const mimeType = imageProcessor.getMimeType(filename);
      const isMimeSupported = imageProcessor.isSupportedMimeType(mimeType);
      
      console.log(chalk.white(`   ${filename}: 格式${isSupported ? '✅' : '❌'} MIME${isMimeSupported ? '✅' : '❌'} (${mimeType})`));
    });

    // 5. 创建测试图片（如果没有的话使用网络图片或跳过）
    console.log(chalk.bold('\n5️⃣ 查找测试图片...'));
    const testImagePath = await findOrCreateTestImage();
    
    if (!testImagePath) {
      logger.warn('未找到测试图片，跳过图片处理测试');
      return;
    }

    logger.info('找到测试图片', { path: testImagePath });

    // 6. 测试图片信息提取
    console.log(chalk.bold('\n6️⃣ 测试图片信息提取...'));
    try {
      const validation = await imageProcessor.validateImageEnhanced(testImagePath);
      logger.success('图片验证通过', validation);

      const imageInfo = await imageProcessor.extractImageInfoEnhanced(testImagePath);
      logger.success('图片信息提取完成', {
        dimensions: imageInfo.dimensions,
        format: imageInfo.format,
        size: `${imageInfo.sizeInMB}MB`,
        quality: imageInfo.quality,
        orientation: imageInfo.orientation
      });
    } catch (error) {
      logger.error('图片信息提取失败', { error: error.message });
    }

    // 7. 测试AI图片分析
    console.log(chalk.bold('\n7️⃣ 测试AI图片分析...'));
    try {
      // 新流程：视觉(仅描述) -> 文本(结构化)
      console.log(chalk.cyan('🧠 视觉→文本 两步结构化分析...'));
      const imageBuffer = await fs.readFile(testImagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = imageProcessor.getMimeType(testImagePath);

      // 1) 视觉描述
      const visionText = await imageProcessor.describeImageWithVision(base64Image, mimeType);
      console.log(chalk.gray(`   视觉描述预览: ${visionText.slice(0, 80)}${visionText.length>80?'...':''}`));

      // 2) 文本Tools结构化（失败回退JSON）
      let structured;
      try {
        structured = await imageProcessor.structureVisionDescriptionWithTools(visionText);
        logger.success('文本Tools结构化成功', {
          title: structured.title,
          descriptionLength: structured.description?.length || 0,
          keywordCount: structured.keywords?.length || 0,
          entityCount: structured.entities?.length || 0
        });
      } catch (e) {
        logger.warn('文本Tools结构化失败，回退JSON', { error: e.message });
        structured = await imageProcessor.structureVisionDescriptionWithJSON(visionText);
        logger.success('JSON回退结构化成功', {
          title: structured.title,
          descriptionLength: structured.description?.length || 0
        });
      }

      // 展示结构化结果
      console.log(chalk.magenta(`   标题: ${structured.title}`));
      console.log(chalk.magenta(`   摘要: ${structured.summary}`));
      if (structured.keywords?.length) {
        console.log(chalk.blue(`   关键词: ${structured.keywords.join(', ')}`));
      }
      if (structured.entities?.length) {
        console.log(chalk.green(`   实体: ${structured.entities.join(', ')}`));
      }
    } catch (error) {
      logger.error('AI图片分析失败', { error: error.message });
    }

    // 8. 测试文字提取
    console.log(chalk.bold('\n8️⃣ 测试图片文字提取...'));
    try {
      const extractedText = await imageProcessor.extractTextFromImageAI(testImagePath);
      if (extractedText) {
        logger.success('文字提取成功', { 
          textLength: extractedText.length,
          preview: extractedText.substring(0, 50) + (extractedText.length > 50 ? '...' : '')
        });
        console.log(chalk.yellow(`   提取文字: "${extractedText}"`));
      } else {
        logger.info('图片中未检测到文字内容');
      }
    } catch (error) {
      logger.error('文字提取失败', { error: error.message });
    }

    // 9. 测试完整图片处理
    console.log(chalk.bold('\n9️⃣ 测试完整图片处理流程...'));
    try {
      const result = await imageProcessor.processImage(testImagePath, {
        generateDescription: true,
        enableOCR: true,
        enableHash: true,  // 明确启用哈希计算
        generateThumbnail: false
      });

      logger.success('图片处理完成', {
        id: result.id,
        title: result.title,
        descriptionLength: result.description?.length || 0,
        keywordCount: result.keywords?.length || 0,
        entityCount: result.entities?.length || 0,
        extractedTextLength: result.extractedText?.length || 0,
        embeddingDimension: result.embedding?.length || 0,
        phash: result.phash || 'null',
        dhash: result.dhash || 'null',
        timestamp: result.timestamp
      });

      console.log(chalk.cyan('\n📊 处理结果详情:'));
      console.log(chalk.white(`   ID: ${result.id}`));
      console.log(chalk.white(`   标题: ${result.title}`));
      console.log(chalk.white(`   文件: ${result.filename} (${result.mimeType})`));
      console.log(chalk.white(`   尺寸: ${result.dimensions} (${result.orientation})`));
      console.log(chalk.white(`   质量: ${result.quality}`));
      if (result.keywords?.length) {
        console.log(chalk.blue(`   关键词: ${result.keywords.join(', ')}`));
      }
      if (result.entities?.length) {
        console.log(chalk.green(`   实体: ${result.entities.join(', ')}`));
      }
      if (result.extractedText) {
        console.log(chalk.yellow(`   提取文字: "${result.extractedText}"`));
      }
      // 显示哈希信息
      if (result.phash) {
        console.log(chalk.magenta(`   图片哈希:`));
        console.log(chalk.gray(`     pHash: ${result.phash}`));
        console.log(chalk.gray(`     dHash: ${result.dhash}`));
        console.log(chalk.gray(`     aHash: ${result.ahash}`));
      } else {
        console.log(chalk.yellow(`   ⚠️  未计算哈希`));
      }
      console.log(chalk.gray(`   向量维度: ${result.embedding?.length || 0}`));
      console.log(chalk.gray(`   时间戳: ${result.timestamp} (${result.local_time})`));

      // 10. 测试图片存储到数据库
      console.log(chalk.bold('\n🔟 测试图片存储到数据库...'));
      try {
        // 创建虚拟文档ID用于测试
        const testDocumentId = `test_doc_${Date.now()}`;
        
        // 构建完整的图片内容信息
        const fullImageContent = [
          `标题: ${result.title}`,
          `详细描述: ${result.description}`,
          result.summary ? `摘要: ${result.summary}` : '',
          result.keywords?.length ? `关键词: ${result.keywords.join(', ')}` : '',
          result.entities?.length ? `实体: ${result.entities.join(', ')}` : '',
          result.colors?.length ? `主要颜色: ${result.colors.join(', ')}` : '',
          result.objects?.length ? `检测对象: ${result.objects.join(', ')}` : '',
          result.emotions?.length ? `情感色调: ${result.emotions.join(', ')}` : '',
          result.extractedText ? `图片文字: ${result.extractedText}` : '',
          `图片信息: ${result.dimensions}, ${result.format}, ${result.orientation}, ${result.quality}`
        ].filter(Boolean).join('\n');

        // 存储图片信息（完整内容版）
        const chunkData = {
          id: result.id,
          content: fullImageContent, // 存储完整内容
          contextualized: fullImageContent, // 上下文化内容也是完整内容
          title: result.title,
          summary: result.summary || result.description?.substring(0, 100) + '...',
          keywords: result.keywords || [],
          entities: result.entities || [],
          embedding: result.embedding,
          // 图片哈希（用于以图搜图）
          phash: result.phash,
          dhash: result.dhash,
          ahash: result.ahash,
          hash_algorithm: result.hash_algorithm,
          // 时间戳
          timestamp: result.timestamp,
          local_time: result.local_time,
          created_at: result.created_at,
          path: result.path,  // 添加路径字段
          metadata: {
            type: 'image',
            filename: result.filename,
            path: result.path,
            mimeType: result.mimeType,
            dimensions: result.dimensions,
            size: result.size,
            quality: result.quality,
            extractedText: result.extractedText,
            description: result.description, // 保存原始描述
            colors: result.colors,
            objects: result.objects,
            emotions: result.emotions
          }
        };

        await neo4jStorage.saveChunk({ ...chunkData, document_id: testDocumentId });
        logger.success('图片数据存储成功', { chunkId: result.id, documentId: testDocumentId });

        // 11. 测试图片检索
        console.log(chalk.bold('\n1️⃣1️⃣ 测试图片检索...'));
        
        // 关键词检索
        if (result.keywords?.length) {
          const keywordQuery = result.keywords[0];
          console.log(chalk.cyan(`🔍 关键词检索: "${keywordQuery}"`));
          const keywordResults = await neo4jStorage.searchChunks(keywordQuery, { limit: 3, mode: 'keyword' });
          logger.success('关键词检索完成', { 
            query: keywordQuery,
            resultCount: keywordResults.length,
            matches: keywordResults.map(r => ({ id: r.id, title: r.title, matchType: r.matchType, score: r.score }))
          });
          
          // 显示检索结果详情
          if (keywordResults.length > 0) {
            console.log(chalk.green('\n   🔍 关键词检索结果详情:'));
            keywordResults.forEach((r, i) => {
              console.log(chalk.white(`   ${i+1}. ${r.title} (${r.matchType}, score: ${r.score})`));
              if (r.content) {
                const preview = r.content.length > 150 ? r.content.substring(0, 150) + '...' : r.content;
                console.log(chalk.gray(`      ${preview.replace(/\n/g, ' ')}`));
              }
            });
          }
        }

        // 向量相似性检索
        if (result.embedding?.length) {
          console.log(chalk.cyan('🔍 向量相似性检索...'));
          const vectorResults = await neo4jStorage.vectorSimilaritySearch(result.embedding, { topK: 3 });
          logger.success('向量检索完成', { 
            resultCount: vectorResults.length,
            matches: vectorResults.map(r => ({ 
              id: r.id, 
              title: r.title, 
              score: r.score?.toFixed ? r.score.toFixed(4) : r.score 
            }))
          });
          
          // 显示向量检索结果详情
          if (vectorResults.length > 0) {
            console.log(chalk.green('\n   🤖 向量相似性检索结果详情:'));
            vectorResults.forEach((r, i) => {
              const score = r.score?.toFixed ? r.score.toFixed(4) : r.score;
              console.log(chalk.white(`   ${i+1}. ${r.title} (相似度: ${score})`));
              if (r.content) {
                const preview = r.content.length > 150 ? r.content.substring(0, 150) + '...' : r.content;
                console.log(chalk.gray(`      ${preview.replace(/\n/g, ' ')}`));
              }
            });
          }
        }

        // 时间戳检索
        console.log(chalk.cyan('🔍 时间戳检索: 最近20分钟'));
        const now = Date.now();
        const timeResults = await neo4jStorage.searchChunksByTimestamp({ startTime: now - 1200000, endTime: now }, { limit: 2 });
        logger.success('时间戳检索完成', { 
          resultCount: timeResults.length,
          timeRange: '20分钟内',
          matches: timeResults.map(r => ({ 
            id: r.id, 
            title: r.title, 
            timestamp: r.timestamp,
            type: r.metadata?.type 
          }))
        });
        
        // 显示时间戳检索结果详情
        if (timeResults.length > 0) {
          console.log(chalk.green('\n   ⏰ 时间戳检索结果详情:'));
          timeResults.forEach((r, i) => {
            const timeStr = new Date(r.timestamp).toLocaleString('zh-CN');
            const type = r.metadata?.type || 'text';
            console.log(chalk.white(`   ${i+1}. ${r.title} (${type}, ${timeStr})`));
            if (r.content) {
              const preview = r.content.length > 150 ? r.content.substring(0, 150) + '...' : r.content;
              console.log(chalk.gray(`      ${preview.replace(/\n/g, ' ')}`));
            }
          });
        }

      } catch (storageError) {
        logger.error('数据库操作失败', { error: storageError.message });
      }

    } catch (error) {
      logger.error('完整图片处理失败', { error: error.message });
    }

    console.log(chalk.bold.green('\n🎉 图片处理测试完成！'));

  } catch (error) {
    logger.error('测试过程中发生错误', { error: error.message, stack: error.stack });
  } finally {
    // 关闭数据库连接
    try {
      const t = step('🧹 关闭数据库连接');
      await neo4jStorage.close();
      done(t);
      logger.info('数据库连接已关闭');
    } catch (e) {
      logger.error('关闭数据库连接失败', { error: e.message });
    }
  }
}

/**
 * 查找或创建测试图片
 */
async function findOrCreateTestImage() {
  const possiblePaths = [
    './1.jpeg'
  ];

  // 查找现有图片
  for (const imagePath of possiblePaths) {
    if (await fs.pathExists(imagePath)) {
      return path.resolve(imagePath);
    }
  }

  // 提示用户手动添加测试图片
  console.log(chalk.yellow('\n📁 未找到测试图片，请手动添加:'));
  console.log(chalk.white('   1. 在项目根目录放置任意图片文件'));
  console.log(chalk.white('   2. 将图片命名为: test-image.jpg 或 test-image.png'));
  console.log(chalk.white('   3. 重新运行测试'));
  
  return null;
}

// 运行测试
testImageProcessing().catch(console.error);
