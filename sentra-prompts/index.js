/**
 * 动态系统提示词生成系统
 * 主入口文件 - 用于演示和测试
 */

import { loadJsonConfig, saveJsonConfig } from './config.js';
import { parseObject } from './parser.js';
import { getFunctionRegistry } from './functions/registry.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 主函数
 */
async function main() {
  try {
    console.log('='.repeat(60));
    console.log('动态系统提示词生成系统');
    console.log('='.repeat(60));
    console.log();
    
    // 加载 agent.json 配置
    const agentConfigPath = path.join(__dirname, 'agent.json');
    console.log(`📄 正在加载配置文件: ${agentConfigPath}`);
    const agentConfig = loadJsonConfig(agentConfigPath);
    console.log(`✅ 配置文件加载成功\n`);
    
    // 显示原始配置
    console.log('📋 原始配置（包含占位符）:');
    console.log('-'.repeat(60));
    console.log(JSON.stringify(agentConfig, null, 2));
    console.log();
    
    // 解析配置中的所有占位符
    console.log('🔄 正在解析占位符...\n');
    const parsedConfig = await parseObject(agentConfig);
    
    // 保存解析后的配置到文件
    const outputPath = path.join(__dirname, 'agent.parsed.json');
    saveJsonConfig(outputPath, parsedConfig);
    console.log(`✅ 解析后的配置已保存到: ${outputPath}\n`);
    
    // 显示解析后的配置（JSON格式）
    console.log('✨ 解析后的配置（JSON格式）:');
    console.log('='.repeat(60));
    console.log(JSON.stringify(parsedConfig, null, 2));
    console.log('='.repeat(60));
    console.log();
    
    // 显示可用函数列表
    console.log('📚 已注册的函数:');
    console.log('-'.repeat(60));
    const registry = getFunctionRegistry();
    const functionNames = Object.keys(registry);
    
    // 按类别分组显示
    const timeFunc = functionNames.filter(name => name.includes('Time') || name.includes('Date') || name.includes('Weekday') || name.includes('Year') || name.includes('Month') || name.includes('Day') || name.includes('Greeting') || name.includes('Timezone') || name.includes('Timestamp') || name.includes('Hour') || name.includes('Minute'));
    const holidayFunc = functionNames.filter(name => name.includes('Holiday') || name.includes('Lunar') || name.includes('Zodiac') || name.includes('GanZhi') || name.includes('Workday') || name.includes('Weekend') || name.includes('JieQi') || name.includes('Constellation'));
    const systemFunc = functionNames.filter(name => name.includes('System') || name.includes('Node') || name.includes('OS') || name.includes('Platform') || name.includes('CPU') || name.includes('Memory') || name.includes('Hostname') || name.includes('Username') || name.includes('Process') || name.includes('Directory') || name.includes('Architecture'));
    
    console.log('\n⏰ 时间相关函数:');
    timeFunc.forEach((name, index) => {
      console.log(`  ${index + 1}. ${name}`);
    });
    
    console.log('\n🎉 节日相关函数:');
    holidayFunc.forEach((name, index) => {
      console.log(`  ${index + 1}. ${name}`);
    });
    
    console.log('\n💻 系统信息函数:');
    systemFunc.forEach((name, index) => {
      console.log(`  ${index + 1}. ${name}`);
    });
    
    console.log(`\n共 ${functionNames.length} 个函数可用`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行主函数
main();
