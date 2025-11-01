import path from 'path';
import fs from 'fs-extra';
import sentraRAG from '../src/sdk/SentraRAG.js';
import neo4jStorage from '../src/database/neo4j.js';
import emotionService from '../src/services/emotionService.js';

function printHeader(title) {
  const line = '='.repeat(80);
  console.log(`\n${line}\n${title}\n${line}`);
}

function printEmotion(obj, title = 'Emotion') {
  const safe = (v) => (v === undefined || v === null ? '' : v);
  const em = obj || {};
  const labels = Array.isArray(em.emotion_labels) ? em.emotion_labels.slice(0, 8) : [];
  const values = Array.isArray(em.emotion_values) ? em.emotion_values.slice(0, 8) : [];
  console.log(`- 情绪极性: ${safe(em.sentiment?.label)} | +${safe(em.sentiment?.scores?.positive)} / -${safe(em.sentiment?.scores?.negative)} / 0${safe(em.sentiment?.scores?.neutral)}`);
  console.log(`- 主情绪: ${safe(em.primary_emotion_label)} (${safe(em.primary_emotion_score)})`);
  if (labels.length) {
    console.log(`- Top情绪标签: ${labels.map((l, i) => `${l}(${values[i] ?? ''})`).join(', ')}`);
  } else {
    console.log(`- Top情绪标签: <空>`);
  }
  console.log(`- VAD: V=${safe(em.vad?.valence)} A=${safe(em.vad?.arousal)} D=${safe(em.vad?.dominance)}`);
  console.log(`- 压力: score=${safe(em.stress?.score)} level=${safe(em.stress?.level)}`);
}

function extractEmotionFromChunk(p) {
  return {
    sentiment: {
      label: p.sentiment_label,
      scores: {
        positive: p.sentiment_positive,
        negative: p.sentiment_negative,
        neutral: p.sentiment_neutral
      }
    },
    primary_emotion_label: p.primary_emotion_label,
    primary_emotion_score: p.primary_emotion_score,
    emotion_labels: p.emotion_labels,
    emotion_values: p.emotion_values,
    vad: {
      valence: p.vad_valence,
      arousal: p.vad_arousal,
      dominance: p.vad_dominance
    },
    stress: {
      score: p.stress_score,
      level: p.stress_level
    }
  };
}

async function runTextFlow() {
  printHeader('1) 文本入库与情绪验证');
  const content = '我们对新产品的发布充满期待，这是一次令人振奋的机会！';
  await sentraRAG.initialize();
  const result = await sentraRAG.processDocument(content, { title: '情绪文本Demo' });
  const chunk = result.chunks?.[0];
  if (!chunk) {
    console.log('未生成文本块');
  } else {
    const emo = extractEmotionFromChunk(chunk);
    console.log(`文档ID=${result.document.id} 文本块ID=${chunk.id}`);
    printEmotion(emo, 'Text Emotion');
  }
}

async function runImageFlow(imagePathArg) {
  printHeader('2) 图片入库与情绪验证');
  const imagePath = imagePathArg || path.resolve(process.cwd(), '1.jpeg');
  const exists = await fs.pathExists(imagePath);
  if (!exists) {
    console.log(`图片不存在: ${imagePath}`);
    return;
  }
  await sentraRAG.initialize();
  const processed = await sentraRAG.processImage(imagePath);
  const docId = `doc_${processed.id}`;
  await sentraRAG.storeImage(processed, docId);
  const chunk = await neo4jStorage.getChunkById(processed.id);
  if (!chunk) {
    console.log(`未找到图片对应的 Chunk: ${processed.id}`);
  } else {
    console.log(`图片块ID=${processed.id}`);
    const emo = extractEmotionFromChunk(chunk);
    printEmotion(emo, 'Image Emotion');
  }
}

async function runDirectAPI() {
  printHeader('3) 情绪服务直连验证');
  const sample = '今天的进展非常顺利，团队士气高涨，大家都很开心。';
  const res = await emotionService.analyzeText(sample);
  printEmotion({
    sentiment: res.sentiment,
    primary_emotion_label: res.emotions?.[0]?.label,
    primary_emotion_score: res.emotions?.[0]?.score,
    emotion_labels: res.emotion_labels,
    emotion_values: res.emotion_values,
    vad: res.vad,
    stress: res.stress
  }, 'Direct Emotion');
}

async function runEmotionSearch() {
  printHeader('4) 情绪检索样例');
  const pos = await sentraRAG.searchByEmotion({ sentimentLabel: 'positive', minSentimentScore: 0.6 }, { limit: 5, orderBy: 'sentiment_positive' });
  console.log(`正向情绪结果: ${pos.length}`);
  pos.slice(0, 3).forEach((p, i) => {
    console.log(`#${i+1} id=${p.id} title=${p.title} sentiment=${p.sentiment_label} primary=${p.primary_emotion_label}(${p.primary_emotion_score})`);
  });
}

async function main() {
  try {
    const imageArg = process.argv[2];
    await runTextFlow();
    await runImageFlow(imageArg);
    await runDirectAPI();
    await runEmotionSearch();
  } catch (e) {
    console.error('测试失败:', e);
  } finally {
    await sentraRAG.close();
  }
}

main();
