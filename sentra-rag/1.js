// demo.js
// 中文注释示例：使用 SDK 进行初始化、文档处理、查询、以图搜图等

import sentraRAG from 'sentra-rag'; // 导入默认 SDK 单例
// 也可：import { SentraRAG } from 'sentra-rag'; const client = new SentraRAG();

async function main() {
  // 1) 初始化（内部会连接 Neo4j、创建索引等）
  await sentraRAG.initialize();

  // 2) 处理一段文本并写入知识库（自动分块、抽取结构化信息、生成向量）
  const doc = await sentraRAG.processDocument(
    '我们公司 2025 年 OKR 的关键目标与优先级非常好',
    { title: '公司OKR', source: 'sdk-demo' }
  );
  console.log('已入库文档ID:', doc.document.id, '生成块数量:', doc.chunks.length);

  // 3) 智能问答（混合：向量+图谱）
  const qa = await sentraRAG.query('今年的关键目标是什么？', { topK: 5 });
  console.log('回答条目数:', qa.results.length);

  // 4) 关键词/全文/混合文本检索
  const hits = await sentraRAG.search('关键目标', { limit: 10, mode: 'hybrid' });
  console.log('检索结果数:', hits.length);

  // 9) 文档/统计
  const list = await sentraRAG.getDocuments({ limit: 20 });
  const one = await sentraRAG.getDocument(list?.[0]?.id);
  const stats = await sentraRAG.getStats(); // 包含数据库与缓存概况
  console.log('文档总览:', list.length, '单个详情标题:', one?.filename, '统计:', stats);

  // 10) 结束时关闭（释放连接与缓存）
  await sentraRAG.close();
}

main().catch(err => {
  console.error('运行出错：', err);
});