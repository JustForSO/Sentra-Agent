## 📦 SDK 使用指南（Sentra RAG）

本项目内置一个可直接在 Node.js 中调用的 SDK，提供文档处理、检索、图谱搜索、图片处理/以图搜图、以及数据库与统计等功能。

### 1. 安装与导入

环境要求：Node >= 18，Neo4j >= 5

两种引入方式：

- 作为外部依赖（发布/打包后）：
```js
import sentraRAG from 'sentra-rag';
```

- 在本仓库内直接使用：
```js
import sentraRAG from './src/sdk/SentraRAG.js';
```

环境变量（示例）：
```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_password

OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
 
# 可选：消息库（OpenAI 风格消息）单独 Neo4j 数据库
# 不配置则默认与主库共用连接，数据库名默认为 messages（需要在 Neo4j 中预先创建）
MSG_NEO4J_URI=bolt://localhost:7687
MSG_NEO4J_USERNAME=neo4j
MSG_NEO4J_PASSWORD=your_password
MSG_NEO4J_DATABASE=messages
```

### 2. 快速开始

```js
import sentraRAG from './src/sdk/SentraRAG.js';

await sentraRAG.initialize();

// 文本文档入库
const doc = await sentraRAG.processDocument('示例文本...', { title: '示例文档' });

// 智能问答（向量+图谱）
const qa = await sentraRAG.query('问题是什么？', { limit: 5 });

// 关键词/全文/混合检索
const hits = await sentraRAG.search('关键字', { mode: 'hybrid', limit: 10 });

// 时间段检索（时间戳：毫秒）
const now = Date.now();
const timeHits = await sentraRAG.searchByTime({ startTime: now - 20*60*1000, endTime: now }, { limit: 5 });

// 图片处理 + 入库 + 以图搜图
const processed = await sentraRAG.processAndStoreImage('./1.jpeg');
const imgSearch = await sentraRAG.searchByImagePath('./1.jpeg', { limit: 10 });

// OpenAI 风格消息保存（user + assistant 成对存储）
await sentraRAG.saveOpenAIMessages([
  { role: 'user', content: '帮我总结一下今天的进度' },
  { role: 'assistant', content: '今天完成了模块A的单测与联调，模块B已提交PR待评审。' }
], { conversationId: 'conv_demo_1', userId: 'u_123' });

// 检索 assistant 消息（返回绑定的 user+assistant 成对）
const pairs = await sentraRAG.searchAssistantMessages('模块A 单测 进度', { limit: 5 });

await sentraRAG.close();
```

### 3. API 一览（方法与示例）

- **初始化与关闭**
  - `initialize(): Promise<void>`
  - `close(): Promise<void>`

- **文档处理**
  - `processDocument(content, metadata?): Promise<{document, chunks, entities, relations, summary}>`
    - metadata: `{ documentId?, title?, source?, filename?, ... }`
  - `processDocumentFile(filePath, metadata?): Promise<...>`

- **查询与检索**
  - `query(query, options?): Promise<{ results, totalFound, searchMeta }>`
    - options: `{ mode?: 'vector'|'graph'|'hybrid', limit?: number, threshold?: number, includeImages?: boolean, includeEntities?: boolean }`
    - 用法：`await sentraRAG.query('今年目标？', { limit: 5, mode: 'hybrid' })`
  - `search(text, options?): Promise<Array>`（关键词/全文/混合）
    - options: `{ mode?: 'keyword'|'fulltext'|'hybrid', limit?: number }`
  - `vectorSearch(embedding, options?): Promise<Array>`
    - 先获取向量：`const emb = await sentraRAG.getTextEmbedding('文本');`
    - `await sentraRAG.vectorSearch(emb, { topK: 3 })`
  - `searchByTime({startTime, endTime}, options?): Promise<Array>`
    - 用法：`await sentraRAG.searchByTime({ startTime, endTime }, { limit: 5 })`

- **向量服务**
  - `getTextEmbedding(text): Promise<number[]>`
  - `getBatchEmbeddings(texts: string[]): Promise<number[][]>`

- **图片处理 / 以图搜图**
  - `processImage(imagePath, options?): Promise<ImageData>`（AI 分析 + OCR + 哈希 + 向量）
  - `storeImage(imageData, documentId): Promise<{success, imageId}>`
  - `processAndStoreImage(imagePath, documentId?, options?): Promise<{imageData, documentId}>`
  - `searchByImagePath(imagePath, options?): Promise<{results, stats}>`（哈希精确匹配）
  - `searchByImageBuffer(imageBuffer, options?): Promise<{results, stats}>`
  - `findDuplicateImages(options?): Promise<Array<Array<Image>>>>`（按 pHash 分组的重复）
  - `rebuildImageHash(options?): Promise<{updated, failed, total}>`
  - `calculateImageHash(imagePath): Promise<{phash, dhash, ahash, ...}>`

- **数据库与统计**
  - `getDocuments({ limit, offset }?): Promise<Array>`
  - `getDocument(documentId): Promise<Object>`
  - `deleteDocument(documentId): Promise<boolean>`
  - `getStats(): Promise<Object>`（包含缓存信息）

- **消息库（OpenAI 风格消息）**
  - `saveOpenAIMessages(messages, options?): Promise<Array<{turn,user,assistant}>>`
    - messages: OpenAI chat 格式数组，仅处理 `user/assistant`，按 user→assistant 成对保存为 `Turn`
    - options: `{ conversationId?, userId?, metadata? }`
  - `searchAssistantMessages(text, { userId?, conversationId?, limit?, threshold? }?): Promise<Array<{score, turn, assistant, user}>>`
    - 以 assistant 文本为主向量检索；可按 `userId` 与 `conversationId` 过滤
  - `getConversationTurns(conversationId, { limit? }): Promise<Array<{turn, assistant, user}>>`
  - `listRecentTurns({ limit? }): Promise<Array<{turn, assistant, user}>>`
  - `getUserTurns(userId, { conversationId?, limit? }): Promise<Array<{turn, assistant, user}>>`

### 4. 典型用法片段

```js
// 关键词检索
const keywordResults = await sentraRAG.search('关键目标', { mode: 'keyword', limit: 5 });

// 纯向量检索
const emb = await sentraRAG.getTextEmbedding('描述文本');
const vectorResults = await sentraRAG.vectorSearch(emb, { topK: 5 });

// 最近 20 分钟新增/更新内容
const now = Date.now();
const recent = await sentraRAG.searchByTime({ startTime: now - 20*60*1000, endTime: now }, { limit: 10 });

// 以图搜图与重复检测
const imgRes = await sentraRAG.searchByImagePath('./1.jpeg', { limit: 10 });
const dupGroups = await sentraRAG.findDuplicateImages({ limit: 1000 });
```

#### 4.1 完整示例：知识库 + 消息库（OpenAI 样式）

```javascript
import 'dotenv/config';
import sentraRAG from './src/sdk/SentraRAG.js';

async function main() {
  // 初始化（会同时初始化知识库与消息库连接与索引）
  await sentraRAG.initialize();

  // 1) 知识库：文本文档入库
  const docResult = await sentraRAG.processDocument(
    '这是一个演示文档内容，包含模块A、模块B的进度与风险评估。',
    { title: '演示文档 Demo' }
  );

  // 2) 知识库：关键词/全文/混合检索
  const hits = await sentraRAG.search('模块A 进度', { mode: 'hybrid', limit: 5 });

  // 3) 知识库：时间戳检索（近 20 分钟）
  const now = Date.now();
  const timeHits = await sentraRAG.searchByTime({
    startTime: now - 20 * 60 * 1000,
    endTime: now
  }, { limit: 5 });

  // 4) 知识库：情感/情绪检索（示例：负面情绪，分数>=0.8）
  const emotionHits = await sentraRAG.searchByEmotion(
    { sentimentLabel: 'negative', minSentimentScore: 0.8 },
    { limit: 5, orderBy: 'sentiment_negative', order: 'desc' }
  );

  // 5) 消息库：保存 OpenAI 风格消息（按 user → assistant 成对）
  await sentraRAG.saveOpenAIMessages([
    { role: 'user', content: '帮我写一段团队周报，突出模块A进度和风险。' },
    { role: 'assistant', content: '本周模块A已完成单测与联调，风险主要在接口变更与上线排期。' }
  ], { conversationId: 'conv_demo', userId: 'user_001', metadata: { project: 'ProjectX' } });

  // 6) 消息库：向量检索 assistant 文本（返回绑定的 user+assistant 成对）
  const pairs = await sentraRAG.searchAssistantMessages('模块A 周报 风险', { limit: 3, threshold: 0.7 });

  // 7) 消息库：按会话读取消息对（倒序）
  const turns = await sentraRAG.getConversationTurns('conv_demo', { limit: 10 });

  // 8) 获取统计（含消息库统计）
  const stats = await sentraRAG.getStats();

  console.log({
    documentId: docResult.document.id,
    searchCount: hits.length,
    timeSearchCount: timeHits.length,
    emotionSearchCount: emotionHits.length,
    assistantPairs: pairs.length,
    turnsInConversation: turns.length,
    stats
  });

  await sentraRAG.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

## 😀 情绪分析与情绪检索（Emotion）

本项目内置情绪分析与检索能力：在文本与图片入库时根据文本内容调用外部情绪服务进行分析，并把结果落库到 `Chunk` 节点；同时暴露 `searchByEmotion()` 供按情绪条件检索。

### 1) 字段说明（Chunk 节点）

```json
{
  "sentiment_label": "positive | negative | neutral",
  "sentiment_positive": 0.82,
  "sentiment_negative": 0.05,
  "sentiment_neutral": 0.13,

  "primary_emotion_label": "joy",
  "primary_emotion_score": 0.76,
  "emotion_labels": ["joy", "surprise", "trust"],
  "emotion_values": [0.76, 0.32, 0.21],

  "vad_valence": 0.70,
  "vad_arousal": 0.60,
  "vad_dominance": 0.50,

  "stress_score": 0.10,
  "stress_level": "low"
}
```

说明：
- **sentiment_***: 情绪极性与分数。
- **primary_emotion_***: 最高分的主情绪。
- **emotion_labels/values**: Top-N 情绪标签与分数（对应索引位置）。
- **VAD**: Valence/Arousal/Dominance 三维度值。
- **stress_***: 压力评分与等级。

### 2) 环境变量（.env）

```env
EMOTION_ENABLED=true
EMOTION_API_BASE_URL=http://127.0.0.1:7200
EMOTION_ANALYZE_PATH=/analyze
EMOTION_TIMEOUT=10000
EMOTION_MIN_TEXT_LENGTH=8
```

### 3) 入库行为

- **文本文档**：对每个 `Chunk` 取 `contextualized > content > summary` 的文本调用情绪服务，写入上述字段。
- **图片文档**：基于图片分析生成的完整文本（标题、描述、关键词、OCR 文本等组合）调用情绪服务，写入到对应 `Chunk`（与图片同 ID）。

### 4) SDK 检索方法

方法：`await sentraRAG.searchByEmotion(filters, options)`

- filters 支持：
  - **labels**: string | string[]，与 `emotion_labels` 匹配；
  - **match**: `'any' | 'all'`，默认 `any`；
  - **primaryLabel / minPrimaryScore**: 主情绪标签/最低分；
  - **sentimentLabel / minSentimentScore**: `'positive'|'negative'|'neutral'` 及最低分；
  - **vad**: `{ minValence?, maxValence?, minArousal?, maxArousal?, minDominance?, maxDominance? }`；
  - **stress**: `{ minScore?, level? }`。
- options：
  - **limit**: 数量，默认 10；
  - **orderBy**: `primary | sentiment_positive | sentiment_negative | sentiment_neutral | vad_valence | vad_arousal | vad_dominance | stress_score | timestamp`；
  - **order**: `'asc' | 'desc'`，默认 `desc`。

### 5) 示例

```js
// 负面情绪且置信度较高
const neg = await sentraRAG.searchByEmotion(
  { sentimentLabel: 'negative', minSentimentScore: 0.9 },
  { limit: 10, orderBy: 'sentiment_negative', order: 'desc' }
);

// 主情绪为 anger 且分数>=0.6
const anger = await sentraRAG.searchByEmotion(
  { primaryLabel: 'anger', minPrimaryScore: 0.6 },
  { limit: 10, orderBy: 'primary' }
);

// 情绪标签包含任一 ['anger','sadness']（any）
const emosAny = await sentraRAG.searchByEmotion(
  { labels: ['anger','sadness'] },
  { limit: 10 }
);

// 必须同时包含 ['joy','surprise']（all）
const emosAll = await sentraRAG.searchByEmotion(
  { labels: ['joy','surprise'], match: 'all' },
  { limit: 10 }
);

// VAD 过滤：快感低、唤醒高
const vad = await sentraRAG.searchByEmotion(
  { vad: { maxValence: 0.3, minArousal: 0.7 } },
  { limit: 10, orderBy: 'vad_arousal' }
);

// 压力分数与等级
const stress = await sentraRAG.searchByEmotion(
  { stress: { minScore: 0.8, level: 'high' } },
  { limit: 10, orderBy: 'stress_score' }
);
```

### 6) 快速验证脚本

提供测试脚本输出完整情绪字段：

```bash
npm run test:emotion            # 使用默认图片路径 ./1.jpeg
npm run test:emotion:img -- ./your-image.jpeg
```

脚本路径：`test/emotion-check.js`

---

### 5. 常见问题（SDK）

- **无法连接 Neo4j**：检查 `.env` 的 `NEO4J_URI/USERNAME/PASSWORD`，以及实例是否 RUNNING。
- **LIMIT 类型错误**：请传递整数；内部已使用 `toInteger()` 与 `neo4j.int()` 兜底。
- **统计中 images=0**：当前图片以 `Chunk` 形式入库，`images` 统计反映 `Image` 节点。可在后续版本合并统计口径。

---

# 🖼️ 以图搜图功能 - 完整使用指南

## 📖 功能简介

Sentra RAG 的以图搜图功能基于**感知哈希（Perceptual Hash）**技术，实现毫秒级的图片精确匹配和重复检测。

### ✨ 核心特性

- ⚡ **超快速度**: 平均查询时间 ~67ms（哈希匹配）
- 🎯 **精确匹配**: 100% 准确识别完全相同的图片
- 🔒 **鲁棒性**: 支持轻微压缩、格式转换、尺寸调整后的匹配
- 📊 **批量处理**: 支持为已有图片批量计算哈希
- 🔍 **重复检测**: 自动识别数据库中的重复图片

### 🔧 技术实现

- **pHash (Perceptual Hash)**: 主哈希算法，32x32 DCT变换
- **dHash (Difference Hash)**: 差分哈希，8x8 梯度比较
- **aHash (Average Hash)**: 平均哈希，8x8 均值比较
- **存储**: Neo4j 图数据库，字段级索引
- **图片处理**: Jimp 纯 JavaScript 实现

---

## 🚀 快速开始

### 1. 环境要求

```bash
Node.js >= 18.0.0
Neo4j >= 5.0
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

创建 `.env` 文件：

```env
# Neo4j 配置
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_password

# AI 模型配置（用于图片处理）
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1

# 服务配置
PORT=3000
NODE_ENV=development
```

### 4. 启动服务

```bash
# 启动 Neo4j
# Windows: 在 Neo4j Desktop 中启动
# Linux/Mac: sudo systemctl start neo4j

# 启动应用
npm start
```

---

## 📝 API 接口

### 1. 以图搜图

上传图片查找数据库中完全相同的图片。

**请求**

```http
POST /api/search/image
Content-Type: multipart/form-data

image: [图片文件]
limit: 20  (可选，默认 20)
```

**示例 (curl)**

```bash
curl -X POST http://localhost:3000/api/search/image \
  -F "image=@/path/to/image.jpg" \
  -F "limit=10"
```

**示例 (JavaScript)**

```javascript
const formData = new FormData();
formData.append('image', fileInput.files[0]);
formData.append('limit', '10');

const response = await fetch('http://localhost:3000/api/search/image', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result);
```

**响应**

```json
{
  "success": true,
  "method": "hash_exact",
  "results": [
    {
      "id": "image_cb0a16dd-02f2-419d-b88c-423cf4dafd74",
      "title": "动漫风格女性角色特写图",
      "path": "E:\\sentra-rag\\1.jpeg",
      "phash": "9e6b758a89a453b0",
      "similarity": 1.0,
      "matchType": "identical"
    }
  ],
  "stats": {
    "hashSearchTime": 63,
    "totalTime": 63,
    "resultCount": 1
  }
}
```

### 2. 查找重复图片

扫描数据库，找出所有完全相同的图片组。

**请求**

```http
GET /api/search/duplicates?limit=1000
```

**示例**

```bash
curl http://localhost:3000/api/search/duplicates?limit=1000
```

**响应**

```json
{
  "success": true,
  "duplicateGroups": [
    {
      "phash": "9e6b758a89a453b0",
      "images": [
        {
          "id": "image_001",
          "title": "图片1",
          "path": "/path/to/image1.jpg"
        },
        {
          "id": "image_002",
          "title": "图片2",
          "path": "/path/to/image2.jpg"
        }
      ]
    }
  ],
  "stats": {
    "totalGroups": 1,
    "totalDuplicates": 2
  }
}
```

### 3. 批量计算哈希

为数据库中没有哈希的图片批量计算哈希值。

**请求**

```http
POST /api/search/rebuild-hash
Content-Type: application/json

{
  "force": false  // true: 重新计算所有图片，false: 仅计算缺失的
}
```

**示例**

```bash
curl -X POST http://localhost:3000/api/search/rebuild-hash \
  -H "Content-Type: application/json" \
  -d '{"force": false}'
```

**响应**

```json
{
  "success": true,
  "total": 0,
  "updated": 0,
  "failed": 0
}
```

---

## 🧪 测试脚本

### 1. 图片处理测试

测试图片智能处理、哈希计算、数据库存储。

```bash
node test-image-processing.js
```

**测试内容**：
- ✅ 图片格式验证
- ✅ 图片信息提取
- ✅ AI 图片分析
- ✅ OCR 文字提取
- ✅ 哈希计算 (pHash/dHash/aHash)
- ✅ 向量生成
- ✅ 数据库存储
- ✅ 多种检索测试

### 2. 以图搜图测试

测试以图搜图的核心功能和性能。

```bash
node test-image-search.js
```

**测试内容**：
- ✅ 哈希计算
- ✅ 图片精确匹配
- ✅ 重复图片检测
- ✅ 批量哈希重建
- ✅ 性能基准测试（5次查询平均）

**预期结果**：
```
✅ 以图搜图完成:
   找到结果: 1 个
   耗时: 63ms

✅ 性能测试完成:
   平均耗时: 66.8ms
   总次数: 5 次
```

### 3. 数据库验证

验证哈希是否正确存入数据库。

```bash
node check-hash.js
```

---

## 📊 性能指标

| 操作 | 平均耗时 | 说明 |
|------|---------|------|
| 哈希计算 | ~50-90ms | 单张图片计算 pHash/dHash/aHash |
| 精确匹配 | ~60-70ms | 数据库查询 + 结果返回 |
| 批量计算 | ~100ms/张 | 取决于图片大小和数量 |
| 重复检测 | ~100-200ms | 扫描整个数据库 |

**性能优势**：
- 🚀 比向量搜索快 **100x** 以上
- 💾 存储空间小（每张图片仅 64 字节）
- 📈 线性扩展性好，支持百万级图片

---

## 🔧 工作原理

### 感知哈希 (pHash)

1. **调整尺寸**: 将图片缩放至 32x32
2. **灰度化**: 转换为灰度图
3. **DCT 变换**: 离散余弦变换
4. **取低频**: 提取左上角 8x8 系数
5. **二值化**: 与均值比较，生成 64 位哈希

### 匹配流程

```
上传图片
   ↓
计算 pHash
   ↓
数据库查询 (WHERE phash = $hash)
   ↓
返回完全匹配的图片
```

### 存储结构

```cypher
// Neo4j 节点结构
(:Chunk {
  id: "image_xxx",
  title: "图片标题",
  path: "图片路径",
  phash: "9e6b758a89a453b0",  // 16 字符十六进制
  dhash: "534d1d61f1e9a6aa",  // 16 字符十六进制
  ahash: "8100041d1d1ddfde",  // 16 字符十六进制
  hash_algorithm: "pHash+dHash+aHash",
  embedding: [向量数据],
  metadata: "{...}",  // JSON 字符串
  timestamp: 1759181537717
})
```

---

## 💡 使用场景

### 1. 重复图片清理

```javascript
// 查找所有重复图片
const response = await fetch('http://localhost:3000/api/search/duplicates');
const { duplicateGroups } = await response.json();

// 处理每组重复图片
duplicateGroups.forEach(group => {
  console.log(`发现 ${group.images.length} 张重复图片`);
  // 保留第一张，删除其他
  const [keep, ...remove] = group.images;
  // ... 删除逻辑
});
```

### 2. 图片去重上传

```javascript
async function uploadWithDedup(file) {
  // 先搜索是否已存在
  const formData = new FormData();
  formData.append('image', file);
  
  const searchResult = await fetch('http://localhost:3000/api/search/image', {
    method: 'POST',
    body: formData
  });
  
  const { results } = await searchResult.json();
  
  if (results.length > 0) {
    return { exists: true, image: results[0] };
  }
  
  // 不存在，执行上传
  // ... 上传逻辑
}
```

### 3. 图片内容版权检测

```javascript
// 检测上传的图片是否已在数据库中
async function checkCopyright(imageFile) {
  const formData = new FormData();
  formData.append('image', imageFile);
  
  const response = await fetch('http://localhost:3000/api/search/image', {
    method: 'POST',
    body: formData
  });
  
  const { results } = await response.json();
  
  if (results.length > 0) {
    return {
      isCopyrighted: true,
      originalImage: results[0]
    };
  }
  
  return { isCopyrighted: false };
}
```

---

## ⚠️ 注意事项

### 1. 图片格式支持

支持的格式：
- ✅ JPEG/JPG
- ✅ PNG
- ✅ GIF
- ✅ WebP
- ✅ BMP

最大文件大小：**50MB**

### 2. 哈希匹配特性

**能匹配的情况**：
- ✅ 完全相同的图片
- ✅ 不同格式的同一图片（JPG ↔ PNG）
- ✅ 轻微压缩后的图片
- ✅ 尺寸调整后的图片（内容不变）

**无法匹配的情况**：
- ❌ 内容不同的图片
- ❌ 裁剪、旋转、镜像后的图片
- ❌ 添加水印、滤镜的图片
- ❌ 严重压缩导致内容失真

### 3. 性能优化建议

**数据库优化**：
```cypher
// 创建哈希索引（已自动创建）
CREATE INDEX chunk_phash IF NOT EXISTS FOR (c:Chunk) ON (c.phash);
```

**批量处理**：
```javascript
// 分批处理大量图片
const batchSize = 100;
for (let i = 0; i < images.length; i += batchSize) {
  const batch = images.slice(i, i + batchSize);
  await processBatch(batch);
  await new Promise(r => setTimeout(r, 1000)); // 限流
}
```

---

## 🐛 常见问题

### Q1: 搜索找不到图片？

**检查清单**：
1. 确认图片已正确入库（包含哈希字段）
2. 运行 `node check-hash.js` 验证数据库
3. 检查 Neo4j 是否正常运行
4. 查看日志文件 `logs/*.log`

**解决方案**：
```bash
# 重新为图片计算哈希
curl -X POST http://localhost:3000/api/search/rebuild-hash \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

### Q2: 哈希计算失败？

**常见原因**：
- 图片文件损坏
- 格式不支持
- 文件过大
- 内存不足

**解决方案**：
```javascript
// 检查图片是否有效
try {
  const hashes = await imageHashService.calculateAllHashes(imagePath);
  console.log('哈希计算成功:', hashes);
} catch (error) {
  console.error('哈希计算失败:', error.message);
}
```

### Q3: 性能慢？

**优化建议**：
1. 确保 Neo4j 索引已创建
2. 增加 Neo4j 内存配置
3. 使用 SSD 存储
4. 批量查询合并请求

---

## 📚 代码示例

### 完整的图片处理流程

```javascript
import imageProcessor from './src/services/imageProcessor.js';
import imageHashService from './src/services/imageHashService.js';
import neo4jStorage from './src/database/neo4j.js';

async function processAndStoreImage(imagePath) {
  // 1. 初始化数据库
  await neo4jStorage.initialize();
  
  // 2. 智能处理图片（AI 分析 + 哈希计算）
  const result = await imageProcessor.processImage(imagePath, {
    enableHash: true,  // 启用哈希计算
    enableOCR: true    // 启用 OCR
  });
  
  console.log('图片处理完成:');
  console.log('- 标题:', result.title);
  console.log('- pHash:', result.phash);
  console.log('- 关键词:', result.keywords);
  
  // 3. 存入数据库
  await neo4jStorage.saveChunk({
    id: result.id,
    title: result.title,
    content: result.description,
    embedding: result.embedding,
    phash: result.phash,
    dhash: result.dhash,
    ahash: result.ahash,
    path: result.path,
    document_id: 'doc_001',
    timestamp: result.timestamp,
    metadata: result.metadata
  });
  
  console.log('✅ 图片已存入数据库');
  
  // 4. 测试搜索
  const searchResults = await imageHashService.calculatePHash(imagePath)
    .then(hash => neo4jStorage.searchImagesByHash(hash));
  
  console.log(`🔍 找到 ${searchResults.length} 个匹配结果`);
  
  await neo4jStorage.close();
}

// 使用
processAndStoreImage('./1.jpeg').catch(console.error);
```

---

## 🎯 路线图

### 已完成 ✅
- [x] 基础哈希算法 (pHash/dHash/aHash)
- [x] 数据库集成 (Neo4j)
- [x] RESTful API
- [x] 批量处理
- [x] 重复检测
- [x] 性能优化
- [x] 完整测试

### 计划中 🚧
- [ ] 相似图片搜索（Hamming 距离）
- [ ] 图片聚类分析
- [ ] Web 管理界面
- [ ] 缩略图生成
- [ ] 多格式转换
- [ ] 分布式处理

---

## 📄 许可证

MIT License

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📧 联系方式

如有问题，请提交 Issue 或联系开发团队。

---

**最后更新**: 2025-09-30
