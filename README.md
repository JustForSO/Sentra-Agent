# Sentra Agent

<div align="center">

**全栈 AI Agent 解决方案 | Full-Stack AI Agent Solution**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![PM2](https://img.shields.io/badge/PM2-Ready-00D9FF.svg)](https://pm2.keymetrics.io/)
[![GitHub](https://img.shields.io/badge/GitHub-Sentra--Agent-181717.svg?logo=github)](https://github.com/JustForSO/Sentra-Agent)

*多平台适配 · 工具增强 · 知识图谱 · 情感分析 · 拟人交互*

</div>

---

## 项目简介

我们是 Sentra Agent，一个专为生产环境设计的全栈 AI Agent 系统。我们致力于为开发者提供一个开箱即用、高度可扩展的智能对话解决方案。

我们深知构建一个真正智能的对话系统的挑战：如何让 AI 既能理解用户意图，又能像人一样自然交流？如何平衡回复的频率，避免打扰用户却又不显得冷淡？如何让 AI 记住每个用户的特点，提供个性化的服务？

为此，我们整合了多平台适配、MCP 工具生态、RAG 知识检索、情绪分析和智能回复策略等核心能力，通过精心设计的模块化架构，确保系统的稳定性、可维护性和可扩展性。

### 我们的核心能力

**智能决策引擎**  
我们采用多阶段决策系统（Judge → Plan → Execute → Evaluate → Summary），让 AI 像人一样思考：先判断是否需要工具，再规划执行步骤，最后评估结果质量。这种渐进式的决策机制，确保每一步都经过深思熟虑。

**丰富的工具生态**  
我们内置了 50+ 开箱即用的 MCP 工具插件，涵盖网络搜索、文件操作、API 调用、多媒体处理等场景。更重要的是，我们提供了统一的工具接口标准，让你可以轻松扩展自己的工具。

**知识检索增强**  
我们通过 RAG（检索增强生成）技术，让 AI 能够访问你的专属知识库。无论是企业文档、产品手册还是历史对话，都能被智能检索并融入回答中，大幅提升回答的准确性和专业性。

**多平台无缝对接**  
我们支持 QQ、微信等主流 IM 平台的统一接口设计，让你一次开发，到处运行。适配器模式的架构设计，让接入新平台变得简单直接。

**情绪感知与理解**  
我们实现了实时情绪分析系统，能够识别用户的喜怒哀乐，并据此调整回复风格。这不仅让对话更自然，也为拟人化交互打下了基础。

**可视化配置管理**  
我们提供了一个 Windows 95 风格的配置管理界面，让复杂的环境变量配置变得直观易懂。拖拽、编辑、保存，一气呵成。

**智能回复策略**  
我们设计了基于欲望值算法的动态回复概率控制系统。它能根据对话节奏、消息频率、用户习惯等因素，智能决定何时回复、何时保持沉默，真正做到"该说话时说话，该闭嘴时闭嘴"。

**用户画像构建**  
我们使用 LLM 驱动的渐进式用户画像系统，让 AI 能够记住每个用户的特点、兴趣和习惯，提供越来越个性化的交互体验。画像会随着对话不断更新，让 AI 越来越懂你。

**生产级部署方案**  
我们集成了 PM2 进程管理，提供自动重启、日志管理、性能监控等生产级特性，确保系统 7x24 小时稳定运行

---

## 架构设计

```
sentra-agent/
├── Main.js                    # 主入口：消息聚合、任务调度、回复策略
├── agent.js                   # Agent 核心：多阶段决策引擎
├── src/                       # 核心模块
│   ├── agent/                 # Agent 逻辑（Judge、Plan、ArgGen、Eval、Summary）
│   ├── config/                # 配置管理
│   └── token-counter.js       # Token 计数器
├── utils/                     # 工具函数
│   ├── replyPolicy.js         # 智能回复策略（欲望值算法、并发控制）
│   ├── userPersonaManager.js  # 用户画像管理（LLM 驱动的渐进式认知构建）
│   ├── groupHistoryManager.js # 群聊历史管理（对话上下文追踪）
│   ├── messageCache.js        # 消息缓存（去重、持久化）
│   └── logger.js              # 日志系统
├── sentra-mcp/                # MCP 工具生态 SDK + 50+ 插件
├── sentra-rag/                # RAG 知识检索引擎
├── sentra-prompts/            # 智能提示词管理系统
├── sentra-emo/                # 情绪分析服务（FastAPI + 深度学习模型）
├── sentra-config-ui/          # 可视化配置管理界面（React + Win95 风格）
├── agent-presets/             # Agent 预设配置
├── ecosystem.config.cjs       # PM2 配置文件
└── docs/                      # 完整文档
```

---

## 核心模块详解

### 1. Sentra MCP（工具生态）

**路径**：`sentra-mcp/`

**功能**：
- 统一的 MCP（Model Context Protocol）工具接口
- 50+ 开箱即用的工具插件
- 支持本地工具和远程 MCP 服务器
- 工具分类：搜索、存储、API、多媒体、实用工具等

**插件示例**：
- `web_search`：网络搜索
- `local__read_file`：本地文件读取
- `qq_message_send`：QQ 消息发送
- `web_render_image`：网页截图
- `mindmap_gen`：思维导图生成

**文档**：[sentra-mcp/README.md](sentra-mcp/README.md)

---

### 2. Sentra RAG（知识检索）

**路径**：`sentra-rag/`

**功能**：
- 向量化知识库（支持文档、URL、本地文件）
- 混合检索策略（向量相似度 + 关键词匹配）
- 智能分块和 Embedding 生成
- 支持多种存储后端（Chroma、Pinecone 等）

**核心能力**：
- 文档上传和索引
- 语义搜索
- 相似度排序
- 上下文增强

**API**：
- `POST /upload`：上传文档
- `POST /query`：语义搜索
- `GET /documents`：列出文档
- `DELETE /documents/:id`：删除文档

**文档**：[sentra-rag/README.md](sentra-rag/README.md)

---

### 3. Sentra Prompts（提示词管理）

**路径**：`sentra-prompts/`

**功能**：
- 模板化提示词管理
- 动态变量替换
- 多语言支持
- 函数式提示词生成

**使用示例**：
```javascript
import SentraPromptsSDK from 'sentra-prompts';

const prompt = await SentraPromptsSDK(
  "现在时间：{{time}}\n用户问题：{{question}}"
);
```

**模板变量**：
- `{{time}}`：当前时间
- `{{sentra_tools_rules}}`：工具使用规则
- `{{qq_system_prompt}}`：QQ 平台提示词

**文档**：[sentra-prompts/README.md](sentra-prompts/README.md)

---

### 4. Sentra Emo（情绪分析）

**路径**：`sentra-emo/`

**功能**：
- 实时情绪分析（FastAPI 服务）
- 多维度情绪识别（开心、悲伤、愤怒、恐惧等）
- 用户情绪状态追踪
- VAD（Valence-Arousal-Dominance）映射

**API**：
- `POST /analyze`：单条消息情绪分析
- `POST /analyze/batch`：批量分析
- `GET /analytics/{user_id}`：用户情绪统计
- `GET /health`：健康检查

**SDK 使用**：
```javascript
import SentraEmo from './sentra-emo/sdk/index.js';

const emo = new SentraEmo({ baseURL: 'http://localhost:8765' });
await emo.analyze('我今天好开心啊！', { userid: '123', username: 'Alice' });
```

**文档**：[sentra-emo/README.md](sentra-emo/README.md)

---

### 5. Sentra Config UI（配置管理界面）

**路径**：`sentra-config-ui/`

**功能**：
- Windows 95 风格的可视化配置管理
- 环境变量编辑和预览
- 核心模块和 MCP 插件配置
- 实时保存和导出

**技术栈**：
- React 18
- React95 UI 库
- Vite 构建工具

**特性**：
- 拖拽排序桌面图标
- 多窗口管理
- 实时配置生成
- Win95 经典视觉体验

**启动**：
```bash
cd sentra-config-ui
npm install
npm run dev
```

---

## 快速开始

### 环境准备

在开始使用 Sentra Agent 之前，我们需要准备好运行环境。系统依赖以下核心组件：

#### 1. Node.js 环境

**要求版本**：>= 18.0.0

**安装方式**：

Windows:
```bash
# 下载安装包
# https://nodejs.org/

# 或使用 Chocolatey
choco install nodejs-lts

# 验证安装
node --version
npm --version
```

Linux:
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# 验证安装
node --version
npm --version
```

macOS:
```bash
# 使用 Homebrew
brew install node@18

# 验证安装
node --version
npm --version
```

---

#### 2. Redis 数据库

**用途**：消息缓存、去重、队列管理

**要求版本**：>= 6.0

**安装方式**：

Windows:
```bash
# 使用 Chocolatey
choco install redis-64

# 启动服务
redis-server

# 或使用 WSL2 安装 Linux 版本
```

Linux:
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install redis-server

# CentOS/RHEL
sudo yum install redis

# 启动服务
sudo systemctl start redis
sudo systemctl enable redis

# 验证安装
redis-cli ping
# 应返回 PONG
```

macOS:
```bash
# 使用 Homebrew
brew install redis

# 启动服务
brew services start redis

# 验证安装
redis-cli ping
# 应返回 PONG
```

**配置说明**：

编辑 `.env` 文件：
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=         # 如果设置了密码
REDIS_DB=0
```

---

#### 3. Neo4j 图数据库

**用途**：知识图谱存储、关系推理

**要求版本**：>= 4.4

**安装方式**：

通用方式（推荐使用 Docker）:
```bash
# 使用 Docker 快速启动
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/your_password \
  -v neo4j_data:/data \
  neo4j:latest

# 访问 Web 界面
# http://localhost:7474
```

Windows:
```bash
# 下载安装包
# https://neo4j.com/download/

# 或使用 Chocolatey
choco install neo4j-community

# 启动服务
neo4j console
```

Linux:
```bash
# Ubuntu/Debian
wget -O - https://debian.neo4j.com/neotechnology.gpg.key | sudo apt-key add -
echo 'deb https://debian.neo4j.com stable latest' | sudo tee /etc/apt/sources.list.d/neo4j.list
sudo apt update
sudo apt install neo4j

# 启动服务
sudo systemctl start neo4j
sudo systemctl enable neo4j

# 验证安装
# 访问 http://localhost:7474
```

macOS:
```bash
# 使用 Homebrew
brew install neo4j

# 启动服务
neo4j start

# 验证安装
# 访问 http://localhost:7474
```

**配置说明**：

编辑 `.env` 文件：
```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password
```

**首次使用**：
1. 访问 `http://localhost:7474`
2. 使用默认账号登录：`neo4j/neo4j`
3. 系统会要求修改密码
4. 将新密码更新到 `.env` 文件

---

#### 4. PM2 进程管理器

**用途**：生产环境进程守护、自动重启、日志管理

**安装方式**：

```bash
# 全局安装 PM2
npm install -g pm2

# 验证安装
pm2 --version

# 查看帮助
pm2 help
```

**基础配置**：

常用命令：
```bash
# 启动测试服务
npm run pm2:start

# 查看状态
npm run pm2:status

# 查看日志
npm run pm2:logs

# 重启服务
npm run pm2:restart

# 停止服务
npm run pm2:stop
```

---

#### 5. Python 环境（可选）

**用途**：仅 sentra-emo 情绪分析服务需要

**要求版本**：>= 3.8

**安装方式**：

Windows:
```bash
# 下载安装包
# https://www.python.org/downloads/

# 或使用 Chocolatey
choco install python

# 验证安装
python --version
pip --version
```

Linux:
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3 python3-pip

# CentOS/RHEL
sudo yum install python3 python3-pip

# 验证安装
python3 --version
pip3 --version
```

macOS:
```bash
# 使用 Homebrew
brew install python@3

# 验证安装
python3 --version
pip3 --version
```

---

### 环境检查清单

在继续之前，请确认以下服务已正常运行：

```bash
# 检查 Node.js
node --version  # 应显示 >= 18.0.0

# 检查 Redis
redis-cli ping  # 应返回 PONG

# 检查 Neo4j
# 访问 http://localhost:7474 能正常打开

# 检查 PM2
pm2 --version  # 显示版本号

# 检查 Python（如果使用 sentra-emo）
python --version  # 应显示 >= 3.8
```

---

### 安装项目依赖

```bash
# 主项目
npm install

# 子模块
cd sentra-mcp && npm install && cd ..
cd sentra-rag && npm install && cd ..
cd sentra-prompts && npm install && cd ..
cd sentra-config-ui && npm install && cd ..

# sentra-emo（Python）
cd sentra-emo
pip install -r requirements.txt
cd ..
```

### 配置环境变量

```bash
# 复制示例配置
cp .env.example .env

# 编辑配置（或使用可视化界面）
# 必填项：OPENAI_API_KEY、WS_HOST、WS_PORT
```

**推荐使用可视化配置界面**：
```bash
cd sentra-config-ui
npm run dev
```

### 启动服务

我们提供了两种运行模式：开发模式和生产模式。

#### 开发模式（适合调试）

开发模式下，进程运行在前台，便于实时查看日志和调试。

**Step 1**：启动 Redis 和 Neo4j
```bash
# Redis（如果未自动启动）
redis-server

# Neo4j（如果未自动启动）
neo4j start
# 或使用 Docker
docker start neo4j
```

**Step 2**：启动主服务
```bash
npm start
```

**Step 3**（可选）：启动情绪分析服务
```bash
cd sentra-emo
python run.py
```

现在你可以通过 IM 平台（如 QQ）连接到服务器，开始使用 Sentra Agent。

---

#### 生产模式（推荐）

生产模式使用 PM2 管理进程，提供自动重启、日志管理、性能监控等特性。

**Step 1**：确保环境服务运行
```bash
# 检查 Redis
redis-cli ping

# 检查 Neo4j
curl http://localhost:7474
```

**Step 2**：使用 PM2 启动主服务
```bash
# 启动服务
npm run pm2:start

# 查看运行状态
npm run pm2:status

# 查看实时日志
npm run pm2:logs
```

**Step 3**：配置开机自启（可选）
```bash
# 保存当前进程列表
pm2 save

# 生成开机自启脚本
pm2 startup
# 执行提示的命令（需要 sudo 权限）
```

**Step 4**：监控和管理
```bash
# 重启服务
npm run pm2:restart

# 停止服务
npm run pm2:stop

# 查看资源占用
npm run pm2:monit

# 删除进程
npm run pm2:delete
```

---

### 一键启动脚本（推荐）

为了简化启动流程，我们建议创建启动脚本：

**Windows（start.bat）**：
```batch
@echo off
echo Starting Sentra Agent...

echo [1/3] Starting Redis...
start /B redis-server

echo [2/3] Starting Neo4j...
neo4j start

echo [3/3] Starting Sentra Agent with PM2...
npm run pm2:start

echo.
echo Sentra Agent started successfully!
echo Run "npm run pm2:logs" to view logs
pause
```

**Linux/macOS（start.sh）**：
```bash
#!/bin/bash

echo "Starting Sentra Agent..."

echo "[1/3] Starting Redis..."
sudo systemctl start redis
# 或 brew services start redis (macOS)

echo "[2/3] Starting Neo4j..."
sudo systemctl start neo4j
# 或 neo4j start (macOS)

echo "[3/3] Starting Sentra Agent with PM2..."
npm run pm2:start

echo ""
echo "Sentra Agent started successfully!"
echo "Run 'npm run pm2:logs' to view logs"
```

使用方式：
```bash
# Windows
start.bat

# Linux/macOS
chmod +x start.sh
./start.sh
```

---

## 配置说明

### 核心配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `OPENAI_API_KEY` | OpenAI API 密钥 | 必填 |
| `OPENAI_BASE_URL` | API 基础 URL | `https://api.openai.com/v1` |
| `DEFAULT_MODEL` | 默认 LLM 模型 | `gpt-4o-mini` |
| `WS_HOST` | WebSocket 服务器地址 | `localhost` |
| `WS_PORT` | WebSocket 端口 | `6702` |

### 回复策略配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `ENABLE_SMART_REPLY` | 启用智能回复策略 | `true` |
| `BASE_REPLY_THRESHOLD` | 回复概率阈值 | `0.65` |
| `MIN_REPLY_INTERVAL` | 最小回复间隔（秒） | `5` |
| `MAX_CONCURRENT_PER_SENDER` | 单用户最大并发任务数 | `1` |
| `BUNDLE_WINDOW_MS` | 消息聚合窗口（毫秒） | `5000` |
| `BUNDLE_MAX_MS` | 最大聚合等待时间（毫秒） | `15000` |

### 用户画像配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `PERSONA_UPDATE_INTERVAL_MS` | 画像更新时间间隔（毫秒） | `600000`（10分钟） |
| `PERSONA_MIN_MESSAGES` | 触发更新的最小消息数 | `10` |
| `PERSONA_MODEL` | 画像分析使用的模型 | `gpt-4o-mini` |

### 工具策略配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `TOOL_STRATEGY` | 工具调用策略 | `auto` |
| `FC_MODEL` | FC 模式使用的模型 | 继承默认模型 |
| `JUDGE_FC_MODEL` | Judge 阶段 FC 模型 | 继承 FC_MODEL |

**完整配置**：参考 `.env.example`

---

## 开发指南

### 项目结构

```
核心流程：
Main.js → 消息接收 → 智能回复策略判断 → Agent 处理 → 回复发送
          ↓
          用户画像更新、情绪分析、历史记录

Agent 流程：
1. Judge：判断是否需要工具
2. Plan：任务分解和规划
3. ArgGen：参数生成
4. Execute：工具执行
5. Evaluate：结果评估
6. Summary：生成最终回复
```

### 添加 MCP 工具

```bash
cd sentra-mcp/plugins

# 创建新插件目录
mkdir my_tool

# 创建配置文件
cat > my_tool/config.json << EOF
{
  "name": "my_tool",
  "description": "我的工具描述",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": {
        "type": "string",
        "description": "参数1"
      }
    },
    "required": ["param1"]
  }
}
EOF

# 创建实现文件
cat > my_tool/index.js << EOF
export default async function myTool(args) {
  const { param1 } = args;
  // 工具逻辑
  return { success: true, data: "结果" };
}
EOF
```

### 调试技巧

```bash
# 查看详细日志
npm start

# 使用 PM2 查看日志
npm run pm2:logs
```

---

## 核心算法解析

### 智能回复策略（欲望值算法）

基于对数增长 + 时间衰减 + Sigmoid 激活的动态回复概率计算：

```
欲望值 = log(1 + k*w) / log(1 + k*N) + 时间衰减 + 提及加成 + 忽略惩罚
回复概率 = sigmoid(欲望值)
是否回复 = 回复概率 >= 阈值
```

**优势**：
- 防止频繁回复（时间间隔控制）
- 防止冷场（连续忽略惩罚）
- 动态调整（对话节奏感知）

---

### 用户画像系统（LLM 驱动）

渐进式用户认知构建，使用 Sentra XML 协议格式化画像数据：

```xml
<sentra-persona>
  <summary>核心概括</summary>
  <traits>
    <personality>性格特征</personality>
    <communication_style>沟通风格</communication_style>
    <interests>兴趣领域</interests>
    <behavioral_patterns>行为模式</behavioral_patterns>
  </traits>
  <insights>关键洞察</insights>
  <metadata>元数据</metadata>
</sentra-persona>
```

**触发条件**：
- 消息数 >= 阈值（默认 10 条）
- 时间间隔 >= 更新间隔（默认 10 分钟）

**详细文档**：[utils/userPersonaManager.js](utils/userPersonaManager.js)

---

## 文档导航

### 子模块文档

- [Sentra MCP](sentra-mcp/README.md)
- [Sentra RAG](sentra-rag/README.md)
- [Sentra Prompts](sentra-prompts/README.md)
- [Sentra Emo](sentra-emo/README.md)

### API 文档

- Sentra Emo API：`http://localhost:7200/docs`（启动后访问）
- Sentra RAG API：参考 [sentra-rag/README.md](sentra-rag/README.md)

---

## 实际应用场景

### 1. 客服bot

- 智能回复策略：避免过度回复，提升用户体验
- 用户画像系统：个性化服务
- RAG 知识库：快速检索常见问题
- 多平台适配：支持 QQ、微信等

### 2. 社群助手

- 情绪感知：识别群聊氛围
- 智能回复：根据对话节奏动态调整
- 工具集成：天气查询、新闻推送、图片生成等

### 3. 个人助理

- 任务管理：待办事项、提醒
- 知识检索：私有知识库
- 多模态交互：文本、图片、语音

---

## 故障排查指南

### 常见问题

#### 1. 服务无法启动

```bash
# 检查端口占用
netstat -ano | findstr :6702

# 检查环境变量
cat .env | grep OPENAI_API_KEY

# 查看错误日志
npm run pm2:logs --err
```

#### 2. 回复不生效

- 检查智能回复策略配置（`ENABLE_SMART_REPLY`）
- 调整回复阈值（`BASE_REPLY_THRESHOLD`）
- 查看欲望值日志（`[ReplyPolicy]`）

#### 3. 用户画像不更新

- 检查消息阈值（`PERSONA_MIN_MESSAGES`）
- 检查时间间隔（`PERSONA_UPDATE_INTERVAL_MS`）
- 查看画像日志（`[PersonaManager]`）

#### 4. PM2 频繁重启

- 检查 `max_memory_restart` 配置
- 查看错误日志：`pm2 logs sentra-agent --err`
- 确认 `.env` 配置正确

## 贡献指南

我们非常欢迎社区的贡献！无论是报告 Bug、提出新功能建议，还是直接提交代码，都是对我们最大的支持。

### 如何参与

**提交 Issue**  
如果你在使用过程中遇到问题，或者有好的想法，欢迎在 [GitHub Issues](https://github.com/JustForSO/Sentra-Agent/issues) 提交。请尽量提供详细的描述和复现步骤。

**提交 Pull Request**  
1. Fork 本项目到你的 GitHub 账号
2. 克隆到本地：`git clone https://github.com/YOUR_USERNAME/Sentra-Agent.git`
3. 创建特性分支：`git checkout -b feature/AmazingFeature`
4. 提交你的更改：`git commit -m 'Add some AmazingFeature'`
5. 推送到分支：`git push origin feature/AmazingFeature`
6. 在 GitHub 上创建 Pull Request

**代码规范**  
- 保持代码风格一致
- 添加必要的注释和文档
- 确保通过现有测试
- 为新功能添加测试用例

**讨论和交流**  
- GitHub Discussions：讨论设计、功能规划等
- Issue Comments：针对具体问题进行讨论

---

## 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。

这意味着你可以自由地使用、修改、分发本项目，无论是个人项目还是商业项目。我们唯一的期望是，如果你觉得这个项目有价值，可以在你的项目中保留版权声明，或者给我们一个 Star。

---

## 关于项目

**技术支持**  
- 查看文档：本 README 和 各个板块README 目录
- 提交问题：[GitHub Issues](https://github.com/JustForSO/Sentra-Agent/issues)
- 参与讨论：[GitHub Discussions](https://github.com/JustForSO/Sentra-Agent/discussions)

---

## 致谢

本项目的实现离不开以下优秀的开源项目：

- [OpenAI](https://openai.com/) - 提供强大的语言模型 API
- [LangChain](https://www.langchain.com/) - LLM 应用开发框架
- [PM2](https://pm2.keymetrics.io/) - Node.js 进程管理工具
- [React95](https://react95.io/) - Windows 95 风格的 React 组件库
- [FastAPI](https://fastapi.tiangolo.com/) - 现代化的 Python Web 框架
...

感谢所有为开源社区做出贡献的开发者！

---