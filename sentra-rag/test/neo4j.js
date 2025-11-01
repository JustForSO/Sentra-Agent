#!/usr/bin/env node

/**
 * Neo4j连接测试脚本
 */

import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

async function testNeo4jConnection() {
  console.log('🔍 测试Neo4j数据库连接...');
  console.log(`📡 连接URI: ${process.env.NEO4J_URI}`);
  console.log(`👤 用户名: ${process.env.NEO4J_USERNAME}`);
  
  let driver;
  
  try {
    // 创建驱动器
    driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
      {
        connectionTimeout: 10000,
        disableLosslessIntegers: true
      }
    );

    console.log('🔗 正在验证连接...');
    
    // 验证连接
    await driver.verifyConnectivity();
    console.log('✅ 连接验证成功');

    // 测试简单查询
    console.log('📝 执行测试查询...');
    const session = driver.session();
    
    try {
      const result = await session.run('RETURN "Neo4j连接成功!" as message, datetime() as timestamp');
      const record = result.records[0];
      
      console.log('✅ 查询执行成功');
      console.log(`📨 消息: ${record.get('message')}`);
      console.log(`⏰ 时间戳: ${record.get('timestamp')}`);
      
      // 获取数据库版本信息
      const versionResult = await session.run('CALL dbms.components() YIELD name, versions');
      console.log('📊 数据库信息:');
      versionResult.records.forEach(record => {
        console.log(`   ${record.get('name')}: ${record.get('versions')[0]}`);
      });
      
    } finally {
      await session.close();
    }

    console.log('🎉 Neo4j连接测试完全成功！');
    
  } catch (error) {
    console.error('❌ Neo4j连接测试失败:');
    console.error(`   错误类型: ${error.name}`);
    console.error(`   错误消息: ${error.message}`);
    
    if (error.code === 'ServiceUnavailable') {
      console.error('💡 建议检查:');
      console.error('   1. Neo4j服务是否已启动');
      console.error('   2. 端口7687是否被占用');
      console.error('   3. 防火墙设置');
    } else if (error.code === 'Neo.ClientError.Security.Unauthorized') {
      console.error('💡 建议检查:');
      console.error('   1. 用户名和密码是否正确');
      console.error('   2. Neo4j是否需要修改默认密码');
    }
    
    process.exit(1);
  } finally {
    if (driver) {
      await driver.close();
    }
  }
}

// 运行测试
testNeo4jConnection().catch(console.error);
