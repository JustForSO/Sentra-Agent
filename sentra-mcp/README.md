# Sentra MCP SDK

A plan-and-execute framework with tool-calling, reasoning, and streaming events. This repository now exposes an SDK for easy integration.

## Installation

Clone this repository and install dependencies:

```bash
npm install
```

CommonJS（Node >=18，使用动态 import）
```js
const { default: SentraMcpSDK } = await import('sentra-mcp');
const sdk = new SentraMcpSDK();
```

Configure your `.env` from `.env.example` with at least:

- `OPENAI_API_KEY` (required)
- Optionally separate models for judge/reasoner/summarizer: `JUDGE_*`, `REASONER_*`, `SUMMARIZER_*`
- Redis is optional but recommended for history, metrics, and memory

## Quick Start

```js
// ESM
import SentraMcpSDK, { SentraMcpSDK as SDK } from 'sentra-mcp';
// 或者按子路径：import SentraMcpSDK from 'sentra-mcp/sdk'

const sdk = new SentraMcpSDK();
await sdk.init();

const messages = [
  { role: 'system', content: '你是产品的智能助理。' },
  { role: 'user', content: '抓取 https://example.com 的标题和链接' }
];

// 1) One-shot run
const res = await sdk.runOnce({
  objective: '根据对话完成用户请求',
  conversation: messages,
  context: { tenantId: 'demo' },
});
if (res.success) {
  console.log('Summary:', res.data.summary);
  console.log('Exec stats:', res.data.exec);
  console.log('Plan steps:', res.data.plan.steps);
} else {
  console.error('Error:', res.error);
}

// 2) Streaming run
for await (const ev of sdk.stream({
  objective: '根据对话完成用户请求',
  conversation: messages,
})) {
  console.log(ev.type, ev);
  if (ev.type === 'summary') break;
}
```

## API

### class SentraMcpSDK

- **constructor(options?)**
  - `options.mcpcore?` Provide a pre-initialized `MCPCore` instance; otherwise a new one is created.

- **init(): Promise<void>**
  - Initializes underlying tool registries and external MCP servers.

- **runOnce({ objective, conversation?, context? }): Promise<Result>**
  - Runs judge → plan → execute once and returns a `Result` object.
  - `objective: string` High-level goal.
  - `conversation?: Array<{ role: 'system' | 'user' | 'assistant', content: string }>` OpenAI-style messages used across judge/plan/execute.
  - `context?: object` Arbitrary contextual metadata.
  - Result shape on success: `{ success: true, data: { runId, plan, exec, eval, summary }}`

- **stream({ objective, conversation?, context?}): AsyncIterable<Event>**
  - Returns an async iterator of events, pushed via in-process bus.
  - Typical sequence: `start → judge → plan → args/tool_result... → evaluation → retry_*? → done → summary`
  - Each event includes `runId` and `ts`.

- **streamWithCallback({ objective, conversation?, context?, onEvent }): Promise<{ stop():void, done: Promise<void> }>**
  - Convenience wrapper to handle events via callback. `stop()` stops consumption.

## Events

- **start**: `{ runId, ts, objective, context }`
- **judge**: `{ runId, ts, need, reason }`
- **plan**: `{ runId, ts, plan }`
- **args**: `{ runId, ts, stepIndex, aiName, args, reused }`
- **tool_result**: `{ runId, ts, stepIndex, aiName, args, result, elapsedMs }`
- **retry_begin | retry_done**
- **evaluation**: `{ runId, ts, result }`
- **done**: `{ runId, ts, exec }`
- **summary**: `{ runId, ts, summary }`

## Configuration

Key variables in `.env`:

- OpenAI-compatible LLM (tool calling):
  - `OPENAI_BASE_URL`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `OPENAI_TEMPERATURE`
  - `OPENAI_MAX_TOKENS` (`-1` to omit)

- Judge model (pre-run necessity decision):
  - `JUDGE_BASE_URL`, `JUDGE_API_KEY`, `JUDGE_MODEL`, `JUDGE_TEMPERATURE`, `JUDGE_MAX_TOKENS`

- Reasoner model (pre-thought):
  - `REASONER_*`

- Summarizer model:
  - `SUMMARIZER_*`

- Redis (optional):
  - `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `REDIS_PASSWORD`
  - Prefixes: `REDIS_METRICS_PREFIX`, `REDIS_CONTEXT_PREFIX`

- Planner/Executor:
  - `PLAN_MAX_STEPS`, `PLAN_MAX_CONCURRENCY`, `PLAN_TOTAL_TIME_BUDGET_MS`
  - `TOOL_TIMEOUT_MS`, `TOOL_COOLDOWN_DEFAULT_MS`, `TOOL_COOLDOWN_FUNC_RETRY`
  - Caching: `TOOL_CACHE_ENABLE`, `TOOL_CACHE_TTL_SEC`, `TOOL_CACHE_ALLOWLIST`, `TOOL_CACHE_DENYLIST`

- Function-Call Strategy:
  - `TOOL_STRATEGY`: `native` | `fc` | `auto` (default: `auto`)
    - `native`: 仅使用模型厂商原生的 tools/function-calling
    - `fc`: 使用 `<function_call> ... </function_call>` 文本标记方案（无需原生 tools），解析并执行
    - `auto`: 优先 `native`，当 native 无返回/不兼容时自动回退到 `fc`
  - 规划阶段：当 `TOOL_STRATEGY=fc` 或 `auto` 且 native 失败时，使用 `src/agent/plan/plan_fc.js` 通过 `<function_call>` 生成 `emit_plan` 计划
  - 参生阶段：`src/agent/stages/arggen.js` 将在 `fc/auto` 下引导模型输出目标工具的 `<function_call>`，并解析为最终 `args`
  - 提示构造与解析工具：`src/utils/fc.js`（`buildFunctionCallInstruction`、`buildPlanFunctionCallInstruction`、`parseFunctionCalls`）
  - 约束：仅输出一个 `<function_call>`；禁止 Markdown 代码块围栏；`arguments` 必须是对象且类型/命名匹配 `inputSchema`
  - FC 专用提供商（可选，未设置则回退到 `OPENAI_*`）：
    - `FC_BASE_URL`, `FC_API_KEY`, `FC_MODEL`, `FC_TEMPERATURE`, `FC_MAX_TOKENS`（`-1` 或留空表示省略 `max_tokens`）
    - 在 `TOOL_STRATEGY=fc` 时用于所有 FC 请求；在 `auto` 下作为 native 失败时的回退提供商
  - FC 输出格式：
    - `FC_FORMAT=sentra`（本项目标准）使用 `<sentra-tools>` + ReAct 行协议
    - 仅在 FC 模式/回退时生效

### Sentra Tools ReAct 格式

本项目在 FC 模式下标准化使用 `<sentra-tools>` 包裹的 ReAct 行协议。模型只需输出一个块：

```
<sentra-tools>
Action: <aiName>
Action Input: { ...JSON 参数对象... }
</sentra-tools>
```

- **约束**
  - 仅输出一个块，且不能包含其它文字/空行/Markdown 代码围栏。
  - `Action Input` 必须是 JSON 对象（不是字符串），键名大小写与工具 `inputSchema` 一致，类型严格匹配。
  - 工具名 `aiName` 必须在清单允许列表中。

- **规划示例**（生成 `emit_plan`）：

```
<sentra-tools>
Action: emit_plan
Action Input: {
  "plan": {
    "overview": "...",
    "steps": [
      {
        "aiName": "ws_user_sendLike",
        "reason": "为用户点赞",
        "nextStep": "检查结果",
        "draftArgs": { "user_id": 2166683295, "times": 10 }
      }
    ]
  }
}
</sentra-tools>
```

- **参数生成示例**（`aiName = ws_user_sendLike`）：

```
<sentra-tools>
Action: ws_user_sendLike
Action Input: { "user_id": 2166683295, "times": 10 }
</sentra-tools>
```

- **解析与执行**
  - 解析器从 `<sentra-tools>` 提取 `Action` 与 `Action Input`；统一转换为 `{ name, arguments }`。
  - 经过 `inputSchema` 严格校验后，由执行器路由到对应插件。

- Feature flags:
  - `ENABLE_HISTORY_SUMMARY`, `HISTORY_SUMMARY_TRIGGER`
  - `ENABLE_VERBOSE_STEPS`, `VERBOSE_PREVIEW_MAX`
  - `CONTEXT_*`, `RECENT_CONTEXT_LIMIT`
  - `EVAL_RETRY_ON_FAIL`, `EVAL_MAX_RETRIES`

## Best Practices

- Keep the last user message as the final `user` role when passing `conversation`.
- Put rules and tool overview in `system`; keep it concise.
- Use Redis for better metrics/history; SDK仍可在无Redis下工作（冷却和缓存会退化，但不影响基本能力）。
- Consider enabling `response_format: json_object` with compatible providers to improve structured outputs.