import 'dotenv/config';
import sentraRAG from '../src/sdk/SentraRAG.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const excerpt = (t, n = 120) => (t ? String(t).slice(0, n) + (String(t).length > n ? '…' : '') : '');

async function main() {
  console.log('--- Sentra RAG Message DB Demo ---');

  // 建议：如使用 Neo4j 社区版，请在 .env 中设置 MSG_NEO4J_DATABASE=neo4j（或与你主库相同）
  // 否则若使用默认 messages 数据库且 Neo4j 不支持多 DB，将无法连接。

  await sentraRAG.initialize();

  const conversationId = `conv_demo_${Date.now()}`;
  const userId = 'user_demo_001';

  console.log('\n[1] 保存 OpenAI 风格消息 (user → assistant)');
  const turnsSaved = await sentraRAG.saveOpenAIMessages([
    { role: 'user', content: '帮我写一段团队周报，突出模块A进度和风险。' },
    { role: 'assistant', content: '本周模块A已完成单测与联调，风险主要在接口变更与上线排期。' },
    { role: 'user', content: '模块B 目前是否有阻塞？' },
    { role: 'assistant', content: '模块B 正在评审阶段，可能受接口依赖影响，需与接口方确认稳定性。' }
  ], { conversationId, userId, metadata: { project: 'ProjectX', env: 'demo' } });

  console.log('保存结果: ', turnsSaved.map(x => ({
    turnId: x.turn?.id,
    conv: x.turn?.conversation_id,
    userId: x.turn?.user_id,
    userText: excerpt(x.user?.content_text),
    assistantText: excerpt(x.assistant?.content_text)
  })));

  // 等待索引（通常不需要，但为稳妥可轻等片刻）
  await sleep(300);

  console.log('\n[2] 向量检索 assistant（过滤 userId + conversationId）');
  const pairsVec = await sentraRAG.searchAssistantMessages('模块A 风险 周报', {
    userId,
    conversationId,
    limit: 5,
    threshold: 0.6
  });
  console.log('向量检索命中数: ', pairsVec.length);
  console.log(pairsVec.map(p => ({
    score: Number(p.score).toFixed(4),
    conv: p.turn?.conversation_id,
    userId: p.turn?.user_id,
    assistantText: excerpt(p.assistant?.content_text),
    userText: excerpt(p.user?.content_text)
  })));

  console.log('\n[3] 按会话读取 Turn（倒序）');
  const turnsByConv = await sentraRAG.getConversationTurns(conversationId, { limit: 10 });
  console.log('会话轮次: ', turnsByConv.length);
  console.log(turnsByConv.map(t => ({
    turnId: t.turn?.id,
    ts: t.turn?.timestamp,
    assistantText: excerpt(t.assistant?.content_text),
    userText: excerpt(t.user?.content_text)
  })));

  console.log('\n[4] 按 userId 获取 Turn（倒序）');
  const turnsByUser = await sentraRAG.getUserTurns(userId, { limit: 10 });
  console.log('用户轮次: ', turnsByUser.length);
  console.log(turnsByUser.map(t => ({
    turnId: t.turn?.id,
    conv: t.turn?.conversation_id,
    assistantText: excerpt(t.assistant?.content_text),
    userText: excerpt(t.user?.content_text)
  })));

  console.log('\n[5] 文本全文检索消息（role=both + userId + conversationId）');
  const textMatches = await sentraRAG.searchMessagesByText('周报 风险', {
    role: 'both',
    userId,
    conversationId,
    limit: 10
  });
  console.log('全文检索命中数: ', textMatches.length);
  console.log(textMatches.map(m => ({
    roleMatched: m.matched?.role,
    matchedText: excerpt(m.matched?.content_text),
    turnId: m.turn?.id,
    conv: m.turn?.conversation_id,
    assistantText: excerpt(m.assistant?.content_text),
    userText: excerpt(m.user?.content_text)
  })));

  await sentraRAG.close();
  console.log('\n✅ 测试完成');
}

main().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
