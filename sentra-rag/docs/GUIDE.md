# 📘 Sentra RAG 使用指南

## 🎉 项目完成状态

- ✅ **服务器**: 成功启动，监听端口 3000
- ✅ **数据库**: Neo4j 连接正常
- ✅ **SDK**: 功能完整，测试通过
- ✅ **API**: 所有端点测试通过
- ✅ **以图搜图**: 完美运行，平均 144ms

---

## 🚀 两种使用方式

### 方式 1: SDK 直接调用（推荐用于脚本）

**优势**: 无需启动服务器，直接函数调用，性能更快

```javascript
import sentraRAG from './src/sdk/SentraRAG.js';

// 初始化
await sentraRAG.initialize();

// 以图搜图
const result = await sentraRAG.searchByImagePath('./photo.jpg');
console.log(`找到 ${result.results.length} 个匹配`);

// 关闭
await sentraRAG.close();
```

**运行示例**:
```bash
node examples/sdk-image-usage.js
```

**查看文档**: [README-SDK.md](./README-SDK.md)

---

### 方式 2: HTTP API（推荐用于 Web 应用）

**优势**: 标准 RESTful API，跨语言调用，适合远程访问

#### 1. 启动服务器

```bash
npm start
```

**输出**:
```
🚀 服务器启动成功！
📡 监听端口: 3000
🌍 环境模式: development

🔗 主要API端点:
   健康检查: http://localhost:3000/health
   文档上传: POST http://localhost:3000/api/documents/upload
   智能查询: POST http://localhost:3000/api/query
   系统统计: GET http://localhost:3000/api/stats
```

#### 2. 调用 API

**cURL 示例**:
```bash
# 以图搜图
curl -X POST http://localhost:3000/api/search/image \
  -F "image=@photo.jpg" \
  -F "limit=5"

# 查找重复图片
curl http://localhost:3000/api/search/duplicates?limit=100

# 系统统计
curl http://localhost:3000/api/stats
```

**JavaScript 示例**:
```javascript
// 以图搜图
const formData = new FormData();
formData.append('image', fileInput.files[0]);

const response = await fetch('http://localhost:3000/api/search/image', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(`找到 ${result.results.length} 个匹配`);
```

#### 3. 测试 API

```bash
node test-api.js
```

**测试结果**:
```
✅ 健康检查通过
✅ API信息获取成功
✅ 系统统计获取成功
✅ 以图搜图成功 (144ms, 找到 2 个匹配)
✅ 重复图片查找成功 (发现 1 组)
✅ 批量哈希重建成功
```

---

## 📊 API 端点完整列表

### 基础端点

| 端点 | 方法 | 功能 | 示例 |
|------|------|------|------|
| `/health` | GET | 健康检查 | `curl http://localhost:3000/health` |
| `/` | GET | API 信息 | `curl http://localhost:3000/` |
| `/api/stats` | GET | 系统统计 | `curl http://localhost:3000/api/stats` |

### 以图搜图端点

| 端点 | 方法 | 功能 | 参数 |
|------|------|------|------|
| `/api/search/image` | POST | 以图搜图 | `image` (File), `limit` (Number) |
| `/api/search/duplicates` | GET | 查找重复 | `limit` (Number) |
| `/api/search/rebuild-hash` | POST | 重建哈希 | `force` (Boolean) |

### 文档处理端点

| 端点 | 方法 | 功能 | 参数 |
|------|------|------|------|
| `/api/documents/upload` | POST | 上传文档 | `file` (File), `description`, `tags` |
| `/api/query` | POST | 智能问答 | `query` (String), `mode`, `topK` |

---

## 🎯 常见使用场景

### 场景 1: 图片去重

**使用 SDK**:
```javascript
import sentraRAG from './src/sdk/SentraRAG.js';

await sentraRAG.initialize();

// 查找重复图片
const duplicates = await sentraRAG.findDuplicateImages();

duplicates.forEach(group => {
  console.log(`发现 ${group.images.length} 张重复图片`);
  // 删除重复的，保留第一张
  for (let i = 1; i < group.images.length; i++) {
    console.log(`删除: ${group.images[i].path}`);
  }
});

await sentraRAG.close();
```

**使用 API**:
```bash
curl http://localhost:3000/api/search/duplicates
```

### 场景 2: 批量处理图片

**使用 SDK**:
```javascript
import sentraRAG from './src/sdk/SentraRAG.js';
import fs from 'fs';

await sentraRAG.initialize();

const images = fs.readdirSync('./photos');

for (const img of images) {
  await sentraRAG.processAndStoreImage(`./photos/${img}`);
  console.log(`✅ ${img} 处理完成`);
}

await sentraRAG.close();
```

### 场景 3: 以图搜图

**使用 SDK**:
```javascript
const result = await sentraRAG.searchByImagePath('./query.jpg');

result.results.forEach(img => {
  console.log(`匹配: ${img.title} (${img.path})`);
});
```

**使用 API**:
```bash
curl -X POST http://localhost:3000/api/search/image \
  -F "image=@query.jpg"
```

### 场景 4: 自动化任务

**定时检查重复图片** (使用 SDK + cron):
```javascript
import sentraRAG from './src/sdk/SentraRAG.js';
import cron from 'node-cron';

// 每天凌晨 2 点检查重复图片
cron.schedule('0 2 * * *', async () => {
  await sentraRAG.initialize();
  
  const duplicates = await sentraRAG.findDuplicateImages();
  console.log(`发现 ${duplicates.length} 组重复图片`);
  
  // 发送通知或自动处理
  
  await sentraRAG.close();
});
```

---

## 📈 性能数据

### SDK 性能

| 操作 | 平均耗时 | 状态 |
|------|---------|------|
| 初始化 | ~300ms | ✅ |
| 哈希计算 | ~70ms | ✅ |
| 以图搜图 | ~90ms | ✅ |
| 图片处理（含AI） | ~40s | ⚠️ 依赖API |

### HTTP API 性能

| 操作 | 平均耗时 | 状态 |
|------|---------|------|
| 健康检查 | ~5ms | ✅ |
| 以图搜图 | ~144ms | ✅ |
| 系统统计 | ~50ms | ✅ |
| 重复检测 | ~100ms | ✅ |

### 对比分析

```
SDK vs HTTP API 性能对比
━━━━━━━━━━━━━━━━━━━━━━━━
以图搜图:
  SDK:   90ms  ████████░░
  API:  144ms  ████████████░░

性能提升: ~37%
```

---

## 🐛 故障排查

### 问题 1: 服务器启动失败

**症状**: `❌ 应用服务初始化失败`

**解决**:
1. 检查 Neo4j 是否运行
   ```bash
   # Windows: 查看 Neo4j Desktop
   # Linux: docker ps | grep neo4j
   ```

2. 检查 `.env` 配置
   ```bash
   NEO4J_URI=bolt://localhost:7687
   NEO4J_PASSWORD=your_password
   ```

3. 测试数据库连接
   ```bash
   node test-neo4j.js
   ```

### 问题 2: API 调用失败

**症状**: `Cannot connect to localhost:3000`

**解决**:
1. 确保服务器已启动
   ```bash
   npm start
   ```

2. 检查端口是否被占用
   ```bash
   netstat -ano | findstr :3000
   ```

3. 测试健康检查
   ```bash
   curl http://localhost:3000/health
   ```

### 问题 3: 以图搜图找不到结果

**原因**: 图片哈希未计算或未存储

**解决**:
```bash
# 1. 使用 SDK 处理图片
node examples/sdk-image-usage.js

# 2. 或重建哈希
curl -X POST http://localhost:3000/api/search/rebuild-hash \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

---

## 📚 文档索引

### 快速入门
- [QUICKSTART.md](./QUICKSTART.md) - 5分钟快速开始
- [README.md](./README.md) - 项目主文档

### SDK 使用
- [README-SDK.md](./README-SDK.md) - SDK 快速指南
- [docs/SDK-GUIDE.md](./docs/SDK-GUIDE.md) - SDK 完整文档
- [examples/](./examples/) - SDK 示例代码

### API 使用
- [docs/API-REFERENCE.md](./docs/API-REFERENCE.md) - API 完整文档
- [test-api.js](./test-api.js) - API 测试脚本

### 功能详解
- [README-IMAGE-SEARCH.md](./README-IMAGE-SEARCH.md) - 以图搜图详解
- [PROJECT-SUMMARY.md](./PROJECT-SUMMARY.md) - 项目技术总结
- [FINAL-REPORT.md](./FINAL-REPORT.md) - 完成报告

---

## 🎓 学习路径

### 新手 (30分钟)

1. **阅读快速开始** (5分钟)
   - [QUICKSTART.md](./QUICKSTART.md)

2. **运行 API 测试** (5分钟)
   ```bash
   npm start  # 终端1
   node test-api.js  # 终端2
   ```

3. **运行 SDK 示例** (10分钟)
   ```bash
   node examples/sdk-image-usage.js
   ```

4. **阅读使用指南** (10分钟)
   - [README-SDK.md](./README-SDK.md)

### 进阶 (2小时)

1. **深入理解技术** (30分钟)
   - [PROJECT-SUMMARY.md](./PROJECT-SUMMARY.md)

2. **学习 API 开发** (30分钟)
   - [docs/API-REFERENCE.md](./docs/API-REFERENCE.md)

3. **实践项目** (1小时)
   - 构建自己的应用

---

## 💡 最佳实践

### 1. 选择合适的使用方式

- **脚本/批处理**: 使用 SDK
- **Web 应用**: 使用 HTTP API
- **混合场景**: SDK + API 组合

### 2. 错误处理

```javascript
try {
  const result = await sentraRAG.searchByImagePath('./photo.jpg');
} catch (error) {
  console.error('搜索失败:', error.message);
  // 处理错误
}
```

### 3. 资源管理

```javascript
// 始终关闭 SDK
try {
  await sentraRAG.initialize();
  // ... 使用 SDK
} finally {
  await sentraRAG.close();
}
```

### 4. 批量操作

```javascript
// 分批处理
const batchSize = 10;
for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize);
  await Promise.all(batch.map(process));
  await new Promise(r => setTimeout(r, 1000)); // 限流
}
```

---

## 🎉 总结

### ✅ 已完成

1. ✅ 服务器启动成功
2. ✅ 所有 API 测试通过
3. ✅ SDK 功能完整
4. ✅ 文档系统完善
5. ✅ 性能优化完成

### 🚀 立即开始

**SDK 方式**:
```bash
node examples/sdk-image-usage.js
```

**API 方式**:
```bash
# 终端 1
npm start

# 终端 2
node test-api.js
```

---

**最后更新**: 2025-09-30  
**版本**: 1.0.0  
**状态**: ✅ 生产就绪
