# 🚀 Sentra RAG - 快速开始指南

## 📋 目录

1. [安装配置](#安装配置)
2. [启动服务](#启动服务)
3. [测试验证](#测试验证)
4. [常用功能](#常用功能)
5. [问题排查](#问题排查)

---

## 安装配置

### 1. 环境准备

确保已安装：
- **Node.js** >= 18.0.0
- **Neo4j** >= 5.0

```bash
# 检查版本
node --version  # v18.0.0+
```

### 2. 安装 Neo4j

**Windows**:
1. 下载 [Neo4j Desktop](https://neo4j.com/download/)
2. 创建新数据库，设置密码
3. 启动数据库

**Linux/Mac**:
```bash
# 使用 Docker
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/your_password \
  neo4j:latest
```

### 3. 克隆项目

```bash
git clone <your-repo-url>
cd sentra-rag
```

### 4. 安装依赖

```bash
npm install
```

### 5. 配置环境变量

创建 `.env` 文件：

```bash
# 复制模板
cp .env.example .env
```

编辑 `.env`：

```env
# Neo4j 数据库配置
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_password  # 改为你的密码

# OpenAI API 配置
OPENAI_API_KEY=sk-xxx  # 改为你的 API Key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
OPENAI_VISION_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-large

# 服务配置
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# 存储配置
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=52428800
```

---

## 启动服务

### 1. 启动 Neo4j

```bash
# Windows: 在 Neo4j Desktop 中点击 Start
# Linux/Mac: 
docker start neo4j
```

### 2. 启动应用

```bash
npm start
```

**成功输出**：
```
[INFO] Server running on http://localhost:3000
[INFO] Neo4j connected successfully
[INFO] Press Ctrl+C to shutdown
```

---

## 测试验证

### 1. 数据库连接测试

```bash
node test-neo4j.js
```

**预期输出**：
```
✅ Neo4j 连接成功
✅ 数据库版本: 5.x.x
✅ 索引创建成功
```

### 2. 图片处理测试

准备一张测试图片 `1.jpeg`，放在项目根目录。

```bash
node test-image-processing.js
```

**预期输出**：
```
✅ 图片处理完成
   标题: xxx
   pHash: 9e6b758a89a453b0
   向量维度: 1024
✅ 图片数据存储成功
```

### 3. 以图搜图测试

```bash
node test-image-search.js
```

**预期输出**：
```
✅ 以图搜图完成:
   找到结果: 1 个
   耗时: 63ms
✅ 性能测试完成:
   平均耗时: 66.8ms
```

### 4. API 测试

```bash
# 测试以图搜图 API
curl -X POST http://localhost:3000/api/search/image \
  -F "image=@1.jpeg"
```

**预期响应**：
```json
{
  "success": true,
  "method": "hash_exact",
  "results": [...]
}
```

---

## 常用功能

### 1. 上传并处理图片

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch('http://localhost:3000/api/documents/upload', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('上传成功:', result);
```

### 2. 以图搜图

```javascript
const formData = new FormData();
formData.append('image', imageFile);

const response = await fetch('http://localhost:3000/api/search/image', {
  method: 'POST',
  body: formData
});

const { results } = await response.json();
console.log(`找到 ${results.length} 个匹配图片`);
```

### 3. 查找重复图片

```javascript
const response = await fetch('http://localhost:3000/api/search/duplicates');
const { duplicateGroups } = await response.json();

duplicateGroups.forEach(group => {
  console.log(`发现 ${group.images.length} 张重复图片`);
});
```

### 4. 智能问答

```javascript
const response = await fetch('http://localhost:3000/api/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: '什么是 RAG？',
    mode: 'hybrid'
  })
});

const { answer, sources } = await response.json();
console.log('回答:', answer);
```

---

## 问题排查

### 问题 1: 连接 Neo4j 失败

**错误信息**:
```
Error: Could not connect to Neo4j
```

**解决方案**:
1. 检查 Neo4j 是否启动：
   ```bash
   # Windows: 查看 Neo4j Desktop
   # Linux: docker ps | grep neo4j
   ```

2. 检查 `.env` 配置：
   ```env
   NEO4J_URI=bolt://localhost:7687  # 确保端口正确
   NEO4J_PASSWORD=your_password     # 确保密码正确
   ```

3. 测试连接：
   ```bash
   node test-neo4j.js
   ```

### 问题 2: 图片搜索找不到结果

**原因**: 图片哈希未计算或未存储

**解决方案**:
```bash
# 1. 检查数据库中的哈希
node check-hash.js

# 2. 重新计算哈希
curl -X POST http://localhost:3000/api/search/rebuild-hash \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

### 问题 3: OpenAI API 调用失败

**错误信息**:
```
Error: OpenAI API error: 401 Unauthorized
```

**解决方案**:
1. 检查 API Key：
   ```bash
   echo $OPENAI_API_KEY  # 应该显示你的 key
   ```

2. 检查 `.env` 配置：
   ```env
   OPENAI_API_KEY=sk-xxx  # 确保 key 正确
   OPENAI_BASE_URL=https://api.openai.com/v1  # 或其他代理
   ```

3. 测试 API：
   ```bash
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer $OPENAI_API_KEY"
   ```

### 问题 4: 端口被占用

**错误信息**:
```
Error: Port 3000 is already in use
```

**解决方案**:
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill -9

# 或者修改端口
# .env: PORT=3001
```

### 问题 5: 文件上传失败

**错误信息**:
```
Error: File too large
```

**解决方案**:
修改 `.env`:
```env
MAX_FILE_SIZE=104857600  # 100MB
```

---

## 📚 进阶阅读

- [完整 API 文档](./docs/API-REFERENCE.md)
- [以图搜图详细指南](./README-IMAGE-SEARCH.md)
- [架构设计文档](./docs/ARCHITECTURE.md)
- [性能优化指南](./docs/PERFORMANCE.md)

---

## 🎯 下一步

1. **开发前端界面**: 使用 React/Vue 构建 Web UI
2. **集成更多模型**: 支持本地模型、其他 API
3. **扩展功能**: 添加更多搜索模式、过滤条件
4. **生产部署**: Docker化、负载均衡、监控

---

## 💡 实用命令

```bash
# 启动开发服务器
npm start

# 启动开发服务器（热重载）
npm run dev

# 运行测试
npm test

# 检查代码风格
npm run lint

# 清理缓存和日志
npm run clean

# 查看日志
tail -f logs/app.log

# 备份数据库
neo4j-admin dump --database=neo4j --to=backup.dump

# 查看系统统计
curl http://localhost:3000/api/stats
```

---

## 🤝 获取帮助

遇到问题？

1. 查看 [常见问题](./docs/FAQ.md)
2. 搜索 [Issues](https://github.com/your-repo/issues)
3. 提交新 Issue
4. 加入社区讨论

---

**祝你使用愉快！** 🎉
