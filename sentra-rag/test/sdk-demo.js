import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';
import sentraRAG from '../src/sdk/SentraRAG.js';

function step(title) {
  console.log(chalk.bold.cyan(`\n=== ${title} ===`));
  return Date.now();
}
function done(start, extra = '') {
  const ms = Date.now() - start;
  console.log(chalk.gray(`→ 用时 ${ms}ms${extra ? ' | ' + extra : ''}`));
}

async function main() {
  console.log(chalk.bold.green('\nSentra RAG SDK 集成测试'));
  console.log(chalk.gray('='.repeat(60)));

  // 1) 初始化
  let t = step('1) 初始化 SDK');
  await sentraRAG.initialize();
  done(t);

  // 2) 文档处理
  t = step('2) 处理文本文档');
  const text = '这是我们公司 2025 年 OKR 的关键目标与优先级……';
  const doc = await sentraRAG.processDocument(text, { title: '公司OKR', source: 'sdk-demo' });
  console.log(chalk.gray(`文档ID=${doc.document.id} 块数=${doc.chunks.length}`));
  done(t);

  // 3) 智能问答
  t = step('3) 智能问答');
  const qa = await sentraRAG.query('今年的关键目标是什么？', { topK: 5 });
  console.log(chalk.gray(`结果条数=${qa.results.length}`));
  if (qa.results[0]) {
    console.log(chalk.white(`预览: ${JSON.stringify(qa.results[0]).slice(0, 200)}...`));
  }
  done(t);

  // 4) 文本检索
  t = step('4) 文本检索');
  const hits = await sentraRAG.search('关键目标', { limit: 10, mode: 'hybrid' });
  console.log(chalk.gray(`检索结果数=${hits.length}`));
  done(t);

  // 5) 向量
  t = step('5) 向量生成');
  const emb = await sentraRAG.getTextEmbedding('向量测试文本');
  const batch = await sentraRAG.getBatchEmbeddings(['第一段', '第二段']);
  console.log(chalk.gray(`单向量维度=${emb.length} 批量数量=${batch.length}`));
  done(t);

  // 6) 图片处理与以图搜图（如有图片）
  const testImage = path.resolve('./1.jpeg');
  if (await fs.pathExists(testImage)) {
    t = step('6) 图片处理');
    const img = await sentraRAG.processAndStoreImage(testImage);
    console.log(chalk.gray(`图片块ID=${img.imageData.id} 维度=${img.imageData.embedding?.length || 0}`));
    done(t);

    t = step('7) 以图搜图');
    const imgSearch = await sentraRAG.searchByImagePath(testImage, { limit: 10 });
    console.log(chalk.gray(`完全相同图片数=${imgSearch.results.length}`));
    done(t);

    t = step('8) 重复图片检测');
    const dupGroups = await sentraRAG.findDuplicateImages({ limit: 1000 });
    console.log(chalk.gray(`重复组数量=${dupGroups.length}`));
    done(t);
  } else {
    console.log(chalk.yellow('\n(跳过图片流程: 未找到 ./1.jpeg)'));
  }

  // 9) 文档与统计
  t = step('9) 文档与统计');
  const list = await sentraRAG.getDocuments({ limit: 20 });
  const one = list?.[0] ? await sentraRAG.getDocument(list[0].id) : null;
  const stats = await sentraRAG.getStats();
  console.log(chalk.gray(`文档数=${list.length} 单个标题=${one?.filename || '-'} 统计=${JSON.stringify(stats)}`));
  done(t);

  // 10) 关闭
  t = step('10) 关闭');
  await sentraRAG.close();
  done(t);

  console.log(chalk.bold.green('\n完成\n'));
}

main().catch(err => {
  console.error(chalk.red('集成测试失败:'), err);
  process.exit(1);
});
