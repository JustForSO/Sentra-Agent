# Sentra Prompts SDK

动态系统提示词生成与占位符解析工具。你可以在 `.env` 中把占位符映射到“静态值”或“动态函数”，然后用 SDK 解析模板、对象或配置文件，将 `{{placeholder}}` 自动替换为实际内容。

## 特性
- **占位符解析**：`{{placeholder}}` 自动替换。
- **函数注册表**：数十个内置动态函数，涵盖时间、节日、系统信息、文本/格式化、常用计算等，集中在 `functions/registry.js`。
- **环境配置驱动**：通过 `.env` 控制 placeholder → 函数/静态值 映射。
- **异步函数支持**：占位符可映射到异步函数（如系统信息、MCP 工具导出）。
- **扩展便捷**：支持注册自定义函数；提供函数搜索 `searchFunctions()`。
- **平台提示词内置**：`getWeChatSystemPrompt`、`getSandboxSystemPrompt` 已内置并可直接映射。
- **fetch 支持**：Node<18 自动注入 `globalThis.fetch`，也可 `import { fetch }` 使用。

## 环境要求
- Node.js >= 16（推荐 18+）
- Windows/macOS/Linux

> Node < 18 会由本 SDK 自动注入 `globalThis.fetch`（依赖 `node-fetch`）。

## 安装与准备

1) 安装依赖
```bash
npm install
```

2) 查看/配置 `.env`
- 参考 `./.env.example`
- 常见映射示例：
```ini
# 时间
time=getCurrentTime
# WeChat 平台系统提示词（内置约500字说明）
wechat_system_prompt=getWeChatSystemPrompt
# 沙箱环境系统提示词（结合系统信息）
sandbox_system_prompt=getSandboxSystemPrompt
# MCP 工具导出（从 Sentra MCP SDK 导出工具为 Markdown）
MCP_TOOLS=getMcpTools
```

## 核心概念
- `.env` 写法：`PLACEHOLDER=函数名` 或 `PLACEHOLDER=静态值`
- 模板中以 `{{PLACEHOLDER}}` 引用。
- SDK 解析时会根据 `.env` 中的映射：
  - 若映射为已注册函数名，则执行函数（支持异步）并将结果替换。
  - 若为静态值，则直接替换。

注册表入口：`functions/registry.js`

## 快速开始

### 方式 A：默认导出（根据入参类型自动分发）
```js
import sentra from './sdk.js'; // 或 import sentra from 'sentra-prompts';

// 解析单个模板字符串
const text = await sentra('现在时间：{{time}}，平台：WeChat\n{{wechat_system_prompt}}');
console.log(text);

// 解析对象
const obj = await sentra({
  title: '系统摘要',
  sandbox: '{{sandbox_system_prompt}}'
});
console.log(obj);

// 解析多个模板
const arr = await sentra(['{{time}}', '{{date}}']);
console.log(arr);
```

### 方式 B：按需 API
所有 API 都支持可选第二个参数 `envPath` 自定义 `.env` 路径；不传则使用默认路径（项目根目录 `./.env`）。

```js
import {
  parse, parseObj, parseMultiple,
  loadAgent, loadAgentJSON,
  register, unregister, has, getFunctions,
  execute, getRegistry,
  searchFunctions, fetch
} from './sdk.js';

// 解析模板
const s = await parse('工具列表：\n{{MCP_TOOLS}}');

// 解析对象
const o = await parseObj({
  name: '{{app_name}}',
  notice: '{{wechat_system_prompt}}'
});

// 解析多个模板
const list = await parseMultiple(['{{time}}', '{{weekday}}']);

// 加载并解析 agent.json
const agent = await loadAgent('./agent.json');
const agentJson = await loadAgentJSON('./agent.json');

// 函数信息
console.log(getFunctions());               // 所有已注册的函数名
console.log(searchFunctions('system'));    // 模糊搜索函数名
console.log(await execute('getCurrentTime'));
console.log(has('getWeChatSystemPrompt'));

// 获取注册表（对象）
console.log(Object.keys(getRegistry()));

// fetch（Node<18 自动注入 globalThis.fetch，也可直接用导出）
const resp = await fetch('https://httpbin.org/get');
console.log(await resp.json());
```

## WeChat / Sandbox / MCP 示例

- `getWeChatSystemPrompt()`（`functions/platform.js`）
  - 约 500 字描述：处于 WeChat 通讯平台对话环境的交互风格、合规与风险提示。
  - `.env`：`wechat_system_prompt=getWeChatSystemPrompt`
  - 模板：`{{wechat_system_prompt}}`

- `getSandboxSystemPrompt()`（`functions/platform.js`）
  - 强调沙箱最小权限与安全，动态拼接 `OS/CPU/负载/内存/磁盘/GPU/网络` 摘要（依赖 `functions/system.js`）。
  - `.env`：`sandbox_system_prompt=getSandboxSystemPrompt`
  - 模板：`{{sandbox_system_prompt}}`

- `getMcpTools()`（`functions/mcptools.js`）
  - 调用外部 Sentra MCP SDK 导出工具为 Markdown；内部自动 `sdk.init()` 并带错误捕获。
  - `.env`：`MCP_TOOLS=getMcpTools`
  - 模板：`{{MCP_TOOLS}}`

> 提示：请确保 `../../sentra-mcp/src/sdk/index.js` 可用，或根据你的实际路径/依赖改造导入。

## 注册自定义函数
```js
import { register, unregister, execute } from './sdk.js';

register('myFunc', () => 'Hello World');
// .env: greeting=myFunc
// 模板: {{greeting}}

console.log(await execute('myFunc')); // Hello World
unregister('myFunc');
```

## 在 agent.json 中使用
```json
{
  "name": "{{app_name}}",
  "systemPrompt": "当前平台：WeChat\n{{wechat_system_prompt}}\n\n沙箱说明：\n{{sandbox_system_prompt}}",
  "tools": "{{MCP_TOOLS}}"
}
```

然后：
```js
import { loadAgentJSON } from './sdk.js';
const jsonStr = await loadAgentJSON('./agent.json');
console.log(jsonStr);
```

## 常见问题（FAQ / Troubleshooting）
- **占位符未替换**：检查 `.env` 是否存在映射项；确保函数已在 `functions/registry.js` 注册。
- **异步函数报错**：解析器会捕获并以 `[Error: funcName]` 形式提示；查看控制台错误以定位实现问题。
- **fetch 不可用**：Node < 18 环境下本 SDK 会注入 `globalThis.fetch`；也可直接 `import { fetch } from './sdk.js'`。
- **MCP 导入失败**：确认 `functions/mcptools.js` 中 MCP SDK 的导入路径；确保 MCP 项目可用并具备必要初始化。
- **自定义 .env 路径**：所有解析 API 的第二个参数均可传 `envPath`，如 `await parse('...', 'E:/path/.env')`。

## 目录结构（简要）
```
.
├─ sdk.js                 // SDK 入口（默认导出 + 工具函数）
├─ index.js               // 演示（CLI）
├─ config.js              // .env / JSON 配置加载
├─ parser.js              // 模板解析核心
├─ functions/
│  ├─ registry.js         // 函数注册表（统一对外）
│  ├─ time.js             // 时间相关
│  ├─ system.js           // 系统信息相关
│  ├─ platform.js         // WeChat / Sandbox 提示词（新增）
│  └─ mcptools.js         // MCP 工具导出
├─ .env.example           // 占位符映射示例
└─ package.json
```

## 许可证
MIT
