# Schedule 延迟反馈功能

## 概述

支持 schedule 参数的插件可以使用延迟反馈功能，用于控制**反馈时间**而不是执行时间。

**按需启用**：只有在插件的 `config.json` 中定义了 `schedule` 参数，该插件才支持延迟反馈。

## 核心特性

### 1. 立刻执行，延迟反馈

- ✅ 插件立刻开始执行（不等待）
- ✅ 控制何时向用户反馈结果
- ✅ 适用于需要定时通知的场景

### 2. 智能反馈策略

#### 场景 A：提前完成
```
用户: "2分钟后告诉我结果"
实际: 1分钟就完成了
行为: 等到2分钟到了再反馈结果
```

#### 场景 B：延迟完成
```
用户: "2分钟后告诉我结果"
实际: 3分钟才完成
行为: 
  - 2分钟时：发送中间状态 (tool_choice)
    人性化消息（继承 overlays 品牌语气）
    例如："正在为您绘制精美的图片，还需要一些时间，请稍候~"
  - 3分钟时：发送最终结果 (tool_result)
```

**人性化进度消息**：
- 使用 `src/agent/prompts/schedule_progress.json` 提示词模板
- 自动继承 `context.overlays.global` 全局品牌语气
- 支持 `context.overlays.schedule_progress` 进度消息专用叠加
- 使用 `loadPrompt`、`composeSystem`、`renderTemplate` 工具函数
- 如果没有配置 overlays，使用默认消息
- 1-2句话，友好简洁，不使用技术术语

## 已支持的插件

目前已添加 schedule 支持的插件：

- ✅ `image_draw` - 图像生成/绘制
- ✅ `realtime_search` - 实时网络搜索
- ✅ `html_to_app` - HTML 转桌面应用
- ✅ `qq_message_markGroupAsRead` - QQ 消息群组标记已读
- ✅ `github_repo_info` - GitHub 仓库查询

其他插件需要在 `config.json` 中添加 schedule 参数定义才能使用此功能。

## 为插件添加 schedule 支持

在插件的 `config.json` 中添加 schedule 参数定义：

```json
{
  "name": "your_plugin",
  "inputSchema": {
    "type": "object",
    "properties": {
      // ... 其他参数
      "schedule": {
        "oneOf": [
          {
            "type": "string",
            "description": "当用户需要延迟处理/延迟反馈时使用：例如 '5分钟后'、'30秒后'、'明天09:00'、ISO 字符串。"
          },
          {
            "type": "object",
            "properties": {
              "when": {
                "type": "string",
                "description": "时间表达：如 '5分钟后' / '明天09:00' / ISO 字符串"
              },
              "language": {
                "type": "string",
                "description": "语言标识，例如 zh|en（默认 zh）"
              },
              "timezone": {
                "type": "string",
                "description": "IANA 时区名称，例如 Asia/Shanghai"
              }
            },
            "additionalProperties": true
          }
        ],
        "description": "可选：当用户需要延迟处理/延迟反馈时使用；仅控制反馈时间，不延迟执行。若到点未完成，将先反馈进行中状态。"
      }
    }
  }
}
```

添加后，该插件即可支持 schedule 延迟反馈功能，无需修改插件 handler 代码。

## 使用方法

### 字符串形式

支持中文/英文自然语言：

```json
{
  "prompt": "1girl, beautiful anime style",
  "schedule": "in 2 minutes"
}
```

```json
{
  "prompt": "1boy, handsome style",
  "schedule": "2分钟后"
}
```

```json
{
  "description": "创建一个计算器",
  "app_name": "calc",
  "details": "...",
  "schedule": "5分钟后"
}
```

### 对象形式

更精确的控制：

```json
{
  "prompt": "...",
  "schedule": {
    "when": "in 5 minutes",
    "language": "en",
    "timezone": "Asia/Shanghai"
  }
}
```

## 支持的时间表达式

### 英文

- `"in 2 minutes"` - 2分钟后
- `"in 30 seconds"` - 30秒后
- `"in 1 hour"` - 1小时后
- `"tomorrow 9am"` - 明天早上9点
- `"next Monday 10:00"` - 下周一上午10点

### 中文

- `"2分钟后"`
- `"30秒后"`
- `"1小时后"`
- `"明天早上9点"`
- `"下周一上午10点"`

### ISO 格式

- `"2025-10-30T15:00:00+08:00"`

## 事件流

### 正常流程（无 schedule）

```
1. args (参数确定)
2. tool_result (执行结果)
```

### 提前完成流程（有 schedule，提前完成）

```
1. args (参数确定)
   - schedule: "in 2 minutes"
2. [插件立刻开始执行]
3. [1分钟后插件完成，但等待到2分钟]
4. tool_result (2分钟时反馈结果)
```

### 延迟完成流程（有 schedule，超时）

```
1. args (参数确定)
   - schedule: "in 2 minutes"
2. [插件立刻开始执行]
3. tool_choice (2分钟时发送中间状态)
   - type: "tool_choice"
   - status: "in_progress"
   - message: "工具正在执行中，规定时间 120s 内未完成，继续等待..."
4. [继续等待插件完成]
5. tool_result (3分钟时反馈最终结果)
```

## 实现细节

### 时间解析

使用以下库进行时间解析：
- **chrono-node**: 英文自然语言
- **Microsoft Recognizers**: 中文自然语言
- **Luxon**: 时间计算和格式化

自动检测语言：
- 包含中文字符 → 使用中文解析器
- 其他 → 使用英文解析器

### 延迟计算

```javascript
// 解析 "in 2 minutes"
const parsed = timeParser.parseTimeExpression("in 2 minutes");
// parsed.parsedDateTime: Luxon DateTime 对象

const nowMs = Date.now();
const targetMs = parsed.parsedDateTime.toMillis();
const delayMs = Math.max(0, targetMs - nowMs);
// delayMs: 120000 (2分钟 = 120秒 = 120000毫秒)
```

### 并发控制

- ✅ 插件立刻开始执行，占用并发槽位
- ✅ 延迟反馈不影响其他插件的调度
- ✅ 中间状态事件不计入步骤完成

## 日志示例

### 启用延迟反馈

```
INFO  Schedule 延迟反馈启用
{
  "label": "SCHEDULE",
  "aiName": "local__image_draw",
  "scheduleText": "in 2 minutes",
  "delayMs": 120000,
  "targetISO": "2025-10-30T15:42:00.000+08:00"
}
```

### 提前完成

```
INFO  Schedule 延迟反馈: 工具已提前完成，延迟后反馈
{
  "label": "SCHEDULE",
  "aiName": "local__image_draw",
  "delayMs": 120000,
  "actualMs": 60000
}
```

### 超时未完成

```
INFO  Schedule 延迟反馈: 发送中间状态
{
  "label": "SCHEDULE",
  "aiName": "local__image_draw",
  "delayMs": 120000
}

INFO  Schedule 延迟反馈: 工具延迟完成
{
  "label": "SCHEDULE",
  "aiName": "local__image_draw",
  "totalMs": 180000
}
```

## 适用场景

### 1. 定时通知

```json
{
  "action": "send_message",
  "message": "会议提醒：10分钟后开始",
  "schedule": "in 10 minutes"
}
```

### 2. 延迟执行反馈

```json
{
  "description": "生成复杂报告",
  "schedule": "30分钟后"
}
```

说明：插件立刻开始生成，但30分钟后才反馈结果，避免中途打扰用户。

### 3. 批量任务间隔

在计划中使用 schedule 控制各步骤的反馈节奏：

```json
{
  "plan": {
    "steps": [
      {
        "aiName": "local__task1",
        "draftArgs": { "schedule": "1分钟后" }
      },
      {
        "aiName": "local__task2",
        "draftArgs": { "schedule": "2分钟后" },
        "dependsOn": [0]
      },
      {
        "aiName": "local__task3",
        "draftArgs": { "schedule": "3分钟后" },
        "dependsOn": [1]
      }
    ]
  }
}
```

## 技术栈

- **时间解析**: chrono-node + @microsoft/recognizers-text-date-time
- **时间计算**: luxon
- **延迟控制**: Promise + setTimeout
- **事件流**: RunEvents + HistoryStore

## 注意事项

### 1. schedule 不影响插件执行超时

```
插件超时 (timeoutMs): 60秒
schedule 延迟: 2分钟

实际行为:
- 插件立刻开始执行
- 如果60秒内完成 → 等到2分钟反馈
- 如果60秒超时 → 返回超时错误（不等2分钟）
```

### 2. schedule 参数会被自动移除

外部插件调用时，`schedule` 字段会被自动移除，不会传递给下游服务器。

### 3. 相对时间 vs 绝对时间

- **相对时间** (推荐): `"in 2 minutes"`, `"2分钟后"` - 相对于当前时间计算
- **绝对时间**: `"tomorrow 9am"`, `"明天早上9点"` - 解析为具体时间点

如果绝对时间已过，延迟时间为0（立刻反馈）。

## 示例代码

### 示例 1: 图片生成延迟反馈

```javascript
// 用户请求
{
  "aiName": "local__image_draw",
  "args": {
    "prompt": "1girl, beautiful anime style",
    "schedule": "in 2 minutes"
  }
}

// 执行流程:
// T+0s:    插件开始执行
// T+45s:   插件完成（提前了75秒）
// T+120s:  向用户反馈结果
```

### 示例 2: 长时间任务

```javascript
// 用户请求
{
  "aiName": "local__html_to_app",
  "args": {
    "description": "创建一个复杂应用",
    "app_name": "myapp",
    "details": "...",
    "schedule": "5分钟后"
  }
}

// 执行流程:
// T+0s:    插件开始执行（编译、打包）
// T+300s:  5分钟到了，插件还在运行
//          发送中间状态: "工具正在执行中，规定时间 300s 内未完成，继续等待..."
// T+420s:  插件完成（总耗时7分钟）
//          发送最终结果
```

## 常见问题

### Q: schedule 会延迟插件的执行吗？

**A:** 不会。插件立刻开始执行，schedule 只控制何时向用户反馈结果。

### Q: 如果插件1分钟完成，schedule是2分钟，会等1分钟再反馈吗？

**A:** 是的。会等到2分钟到了再反馈，确保用户在预期的时间收到通知。

### Q: 如果插件超时了怎么办？

**A:** 插件的 timeoutMs 机制仍然有效。如果插件在 timeoutMs 内超时，会立刻返回超时错误，不会等 schedule 时间。

### Q: 中间状态事件 (tool_choice) 会阻塞后续步骤吗？

**A:** 不会。中间状态只是通知，不影响调度。后续步骤会继续等待最终的 tool_result。

### Q: 所有插件都支持 schedule 吗？

**A:** 否。只有在插件的 `config.json` 中定义了 `schedule` 参数，该插件才支持延迟反馈（按需启用）。

---

**版本**: v1.0  
**更新日期**: 2025-10-30
