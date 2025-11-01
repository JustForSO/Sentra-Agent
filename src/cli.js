#!/usr/bin/env node

import { Command } from 'commander';
import { Agent, AgentConfig } from './agent.js';
import { tokenCounter } from './token-counter.js';
import { textSegmentation } from './segmentation.js';
import { translator } from './translation.js';
import { timeParser } from './time-parser.js';
import { createReadlineInterface } from './utils.js';

// 创建命令行程序
const program = new Command();

program
  .name('langchain-agent')
  .description('LangChain Agent CLI for OpenAI compatible API')
  .version('1.0.0');

// 聊天命令
program
  .command('chat')
  .description('开始交互式聊天')
  .option('-m, --model <model>', '模型名称', 'gpt-4o-mini')
  .option('-t, --temperature <temperature>', '温度参数', '0.7')
  .option('-u, --url <url>', 'API基础URL', 'https://yuanplus.cloud/v1/')
  .option('-k, --key <key>', 'API密钥', '')
  .option('--max-tokens <tokens>', '最大token数', '1000')
  .option('--stream', '启用流式输出', false)
  .action(async (options) => {
    const config = new AgentConfig({
      modelName: options.model,
      temperature: parseFloat(options.temperature),
      baseURL: options.url,
      apiKey: options.key,
      maxTokens: parseInt(options.maxTokens)
    });

    const agent = new Agent(config);

    console.log(`Agent已启动:`);
    console.log(`   模型: ${config.modelName}`);
    console.log(`   温度: ${config.temperature}`);
    console.log(`   API: ${config.baseURL}`);
    console.log(`   流式输出: ${options.stream ? '启用' : '禁用'}\n`);

    const rl = createReadlineInterface();

    console.log('开始聊天吧！输入 "exit" 或 "quit" 退出，输入 "clear" 清空对话历史\n');

    const chatLoop = async () => {
      rl.question('你: ', async (input) => {
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          console.log('再见！');
          rl.close();
          return;
        }

        if (input.toLowerCase() === 'clear') {
          agent.clearHistory();
          console.log('对话历史已清空');
          chatLoop();
          return;
        }

        if (input.toLowerCase() === 'info') {
          const info = agent.getModelInfo();
          console.log('Agent信息:');
          console.log(`   模型名称: ${info.name}`);
          console.log(`   基础URL: ${info.baseURL}`);
          console.log(`   温度: ${info.temperature}`);
          console.log(`   最大token: ${info.maxTokens}`);
          console.log(`   历史长度: ${info.historyLength}`);
          console.log(`   历史token: ${info.historyTokens}`);
          chatLoop();
          return;
        }

        if (input.trim() === '') {
          chatLoop();
          return;
        }

        try {
          if (options.stream) {
            console.log('助手: ');
            const streamGenerator = agent.chatStream(input);

            let fullResponse = '';
            for await (const chunk of streamGenerator) {
              process.stdout.write(chunk);
              fullResponse += chunk;
            }
            console.log('\n'); // 换行
          } else {
            console.log('助手思考中...');
            const response = await agent.chat(input);
            console.log(`助手: ${response}\n`);
          }
        } catch (error) {
          console.error(`错误: ${error.message}\n`);
        }

        chatLoop();
      });
    };

    chatLoop();
  });

// 单次查询命令
program
  .command('query')
  .description('单次查询')
  .argument('<message>', '要查询的消息')
  .option('-m, --model <model>', '模型名称', 'gpt-4o-mini')
  .option('-t, --temperature <temperature>', '温度参数', '0.7')
  .option('-u, --url <url>', 'API基础URL', 'https://yuanplus.cloud/v1/')
  .option('-k, --key <key>', 'API密钥', '')
  .option('--max-tokens <tokens>', '最大token数', '1000')
  .option('--stream', '启用流式输出', false)
  .action(async (message, options) => {
    const config = new AgentConfig({
      modelName: options.model,
      temperature: parseFloat(options.temperature),
      baseURL: options.url,
      apiKey: options.key,
      maxTokens: parseInt(options.maxTokens)
    });

    const agent = new Agent(config);

    try {
      if (options.stream) {
        console.log('🤖 助手: ');
        const streamGenerator = agent.chatStream(message);

        for await (const chunk of streamGenerator) {
          process.stdout.write(chunk);
        }
        console.log('\n');
      } else {
        const response = await agent.chat(message);
        console.log(`🤖 助手: ${response}\n`);
      }
    } catch (error) {
      console.error(`❌ 错误: ${error.message}`);
      process.exit(1);
    }
  });

// Token计算命令
program
  .command('tokens')
  .description('计算token数量')
  .argument('<text>', '要计算token的文本')
  .option('-m, --model <model>', '模型名称', 'gpt-4o-mini')
  .option('--stats', '显示详细统计信息')
  .option('--batch <file>', '批量计算文件中的文本')
  .action((text, options) => {
    const tokenCount = tokenCounter.countTokens(text, options.model);

    console.log(`文本: "${text}"`);
    console.log(`模型: ${options.model}`);
    console.log(`Token数量: ${tokenCount}`);

    if (options.stats) {
      const stats = tokenCounter.getTextStats(text, options.model);
      console.log(`\n详细统计:`);
      console.log(`   字符数: ${stats.charCount}`);
      console.log(`   单词数: ${stats.wordCount}`);
      console.log(`   Token数: ${stats.tokenCount}`);
      console.log(`   模型: ${stats.model}`);
      console.log(`   平均每字符Token数: ${stats.avgTokensPerChar}`);
      console.log(`   平均每Token字符数: ${stats.avgCharsPerToken}`);
    }

    if (options.batch) {
      console.log(`\n批量处理功能正在开发中...`);
    }
  });

// 独立分词分析命令
program
  .command('segment')
  .description('独立分词分析（不涉及token计算）')
  .argument('<text>', '要分析的文本')
  .option('--lang', '显示语言检测结果', false)
  .option('--blocks', '显示语言块详情', false)
  .option('--distribution', '显示语言分布统计', false)
  .option('--advanced', '使用高级分词模式', false)
  .action((text, options) => {
    console.log(`分析文本: "${text}"\n`);

    if (options.lang) {
      const language = textSegmentation.detectLanguage(text);
      console.log(`语言检测: ${language}`);
    }

    // 选择分词模式
    const segments = options.advanced
      ? textSegmentation.segmentAdvanced(text)
      : textSegmentation.segment(text);

    console.log(`分词结果 (${segments.length}个分词):`);
    console.log(`   [${segments.join(', ')}]\n`);

    if (options.blocks) {
      const blocks = textSegmentation.detectLanguageBlocks(text);
      console.log(`语言块详情:`);
      blocks.forEach((block, index) => {
        if (block.language !== 'punctuation') {
          console.log(`   块${index + 1}: "${block.text}" (${block.language})`);
        }
      });
      console.log();
    }

    if (options.distribution) {
      const distribution = textSegmentation.analyzeLanguageDistribution(text);
      console.log(`语言分布统计:`);
      console.log(`   中文字符: ${distribution.chinese} (${(distribution.chineseRatio * 100).toFixed(1)}%)`);
      console.log(`   英文字符: ${distribution.english} (${(distribution.englishRatio * 100).toFixed(1)}%)`);
      console.log(`   标点符号: ${distribution.punctuation} (${(distribution.punctuationRatio * 100).toFixed(1)}%)`);
      console.log(`   其他字符: ${distribution.other} (${(distribution.otherRatio * 100).toFixed(1)}%)`);
      console.log(`   总字符数: ${distribution.total}`);
      console.log(`   语言块数量: ${distribution.blocks.length}\n`);
    }
  });

// 模型信息命令
program
  .command('info')
  .description('显示agent信息')
  .option('-m, --model <model>', '模型名称', 'gpt-4o-mini')
  .option('-t, --temperature <temperature>', '温度参数', '0.7')
  .option('-u, --url <url>', 'API基础URL', 'https://yuanplus.cloud/v1/')
  .option('-k, --key <key>', 'API密钥', '')
  .option('--max-tokens <tokens>', '最大token数', '1000')
  .action((options) => {
    const config = new AgentConfig({
      modelName: options.model,
      temperature: parseFloat(options.temperature),
      baseURL: options.url,
      apiKey: options.key,
      maxTokens: parseInt(options.maxTokens)
    });

    console.log('Agent配置信息:');
    console.log(`   模型名称: ${config.modelName}`);
    console.log(`   API基础URL: ${config.baseURL}`);
    console.log(`   API密钥: ${config.apiKey.substring(0, 10)}...`);
    console.log(`   温度: ${config.temperature}`);
    console.log(`   最大token数: ${config.maxTokens}`);
    console.log(`   重试次数: ${config.maxRetries}`);
    console.log(`   超时时间: ${config.timeout}ms`);
  });

// 翻译命令
program
  .command('translate')
  .description('翻译文本到英文')
  .argument('<text>', '要翻译的文本')
  .option('-s, --source <language>', '指定源语言 (zh, en, ja, ko, fr, de, es, pt, ru, ar)', 'auto')
  .option('-c, --context <context>', '提供上下文信息', '')
  .option('--format', '保持原文格式', false)
  .option('--batch <file>', '批量翻译文件中的文本')
  .action(async (text, options) => {
    try {
      console.log(`翻译文本: "${text}"`);
      console.log(`源语言: ${options.source === 'auto' ? '自动检测' : translator.getLanguageName(options.source)}\n`);

      if (options.batch) {
        // 批量翻译功能
        console.log('批量翻译功能正在开发中...\n');
        return;
      }

      let translation;
      if (options.source === 'auto') {
        // 智能翻译
        console.log('正在进行智能翻译...');
        translation = await translator.smartTranslate(text, {
          context: options.context,
          preserveFormat: options.format
        });
      } else {
        // 指定源语言翻译
        console.log(`正在翻译${translator.getLanguageName(options.source)}到英文...`);
        translation = await translator.translateToEnglish(text, {
          sourceLanguage: options.source,
          context: options.context,
          preserveFormat: options.format
        });
      }

      console.log(`翻译结果:`);
      console.log(`   ${translation}\n`);

      // 如果保持格式，显示格式信息
      if (options.format) {
        console.log(`格式已保持`);
      }

    } catch (error) {
      console.error(`翻译失败: ${error.message}`);
      process.exit(1);
    }
  });

// 时间解析命令
program
  .command('time')
  .description('解析时间表达式')
  .argument('<text>', '包含时间表达式的文本')
  .option('-f, --format <format>', '输出格式 (full, iso, date, time, relative)', 'full')
  .option('-l, --language <language>', '指定文本语言 (auto, zh, en, ja, ko, fr, de, es, pt, ru, ar)', 'auto')
  .option('-t, --timezone <timezone>', '指定时区', 'Asia/Shanghai')
  .action(async (text, options) => {
    try {
      console.log(`解析时间表达式: "${text}"\n`);
      console.log(`语言: ${options.language === 'auto' ? '自动检测' : options.language}`);
      console.log(`时区: ${options.timezone}\n`);

      const result = await timeParser.parseTimeExpression(text, {
        language: options.language,
        timezone: options.timezone
      });

      if (result.success) {
        console.log(`解析成功:`);
        console.log(`   原始文本: ${result.original}`);
        console.log(`   检测语言: ${result.detectedLanguage}`);
        if (result.translationUsed) {
          console.log(`   翻译文本: ${result.translated}`);
        }
        console.log(`   解析时间: ${timeParser.formatTime(result.parsed, options.format)}`);
        console.log(`   置信度: ${(result.confidence * 100).toFixed(1)}%`);
        console.log(`   时区: ${result.timezone}`);
        console.log(`   解析方法: ${result.method}`);

        // 显示时间戳信息
        console.log(`\n时间戳信息:`);
        console.log(`   解析开始: ${result.parseStartTimestamp}`);
        console.log(`   解析完成: ${result.parseEndTimestamp}`);
        console.log(`   解析耗时: ${result.parseDuration}ms`);
        console.log(`   解析结果时间戳: ${result.parsedTimestamp}`);
        console.log(`   解析结果ISO: ${result.parsedISO}`);
        console.log(`   中国时区时间: ${result.parsedChinaTime}`);

        if (result.translationUsed && result.translationStartTimestamp) {
          console.log(`   翻译开始: ${result.translationStartTimestamp}`);
          console.log(`   翻译完成: ${result.translationEndTimestamp}`);
          console.log(`   翻译耗时: ${result.translationDuration}ms`);
        }

        if (result.chronoDuration !== undefined) {
          console.log(`   Chrono解析耗时: ${result.chronoDuration}ms`);
        }

        // 显示相对时间
        if (options.format === 'relative') {
          console.log(`\n相对时间: ${timeParser.formatTime(result.parsed, 'relative')}`);
        }

        // 显示详细时间信息
        console.log(`\n详细时间信息:`);
        console.log(`   年: ${result.parsedDetails.year}`);
        console.log(`   月: ${result.parsedDetails.month}`);
        console.log(`   日: ${result.parsedDetails.day}`);
        console.log(`   小时: ${result.parsedDetails.hours}`);
        console.log(`   分钟: ${result.parsedDetails.minutes}`);
        console.log(`   秒: ${result.parsedDetails.seconds}`);
        console.log(`   星期: ${result.parsedDetails.dayOfWeek}`);

      } else {
        console.log(`解析失败:`);
        console.log(`   原始文本: ${result.original}`);
        console.log(`   检测语言: ${result.detectedLanguage}`);
        console.log(`   错误信息: ${result.error || '未找到时间表达式'}`);
        console.log(`   解析方法: ${result.method}\n`);
      }

    } catch (error) {
      console.error(`时间解析失败: ${error.message}`);
      process.exit(1);
    }
  });

// 解析命令行参数
program.parse();

// 如果没有提供命令，显示帮助信息
if (!program.args.length) {
  program.help();
}
