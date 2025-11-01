# 日志显示优化

## 修复的问题

### 1. `[object Object]` 显示问题

**问题根源：**
NapCat 在生成 `raw_message` 时，对于包含对象的字段（如 `face` 的 `raw` 属性），直接使用 `String(obj)` 导致序列化为 `[object Object]`。

**问题示例：**
```
[info] [message:private] text="[CQ:face,id=5,raw=[object Object]][CQ:face,id=311,raw=[object Object]]..."
                                                ^^^^^^^^^^^^^^^^                  ^^^^^^^^^^^^^^^^
```

**修复方案：**
1. 新增 `regenerateRawMessage()` 函数，从 `message` 段重新生成 `raw_message`
2. 对于对象类型的字段值，使用 `JSON.stringify()` 正确序列化
3. 在 `summarizeMessageEvent()` 中使用重新生成的 `raw_message`

**修复后效果：**
```
[info] [message:private] text="[CQ:face,id=5,raw={"width":100,"height":100}][CQ:face,id=311,raw={"width":100,"height":100}]..."
                                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

现在可以看到对象的**真实内容**，而不是 `[object Object]`。

### 2. 支持显示完整日志内容（不使用省略号）

**问题描述：**
默认情况下，消息文本超过 80 个字符会被截断并添加 `…` 省略号，无法查看完整内容。

**修复方案：**
添加环境变量 `MESSAGE_TEXT_MAX_LENGTH` 控制日志文本长度：
- 默认值：`80`（保持原有行为）
- 设置为 `0`：不限制长度，显示完整内容
- 设置为其他数字：自定义截断长度

---

## 使用方法

### 方式1：显示完整日志（推荐用于调试）

在 `.env` 文件中添加或修改：

```bash
MESSAGE_TEXT_MAX_LENGTH=0
```

效果：
```
[info] [message:private] text="这是一条非常非常非常非常非常长的消息内容，不会被截断，完整显示所有内容……"
```

### 方式2：自定义截断长度

```bash
MESSAGE_TEXT_MAX_LENGTH=200
```

效果：
```
[info] [message:private] text="这是一条非常非常非常非常非常长的消息内容，会在200个字符处截断，后面部分用省略号代替…"
```

### 方式3：使用默认长度（无需配置）

不设置或注释掉该变量，默认截断长度为 80 个字符：

```bash
# MESSAGE_TEXT_MAX_LENGTH=80  # 默认值，可以省略
```

---

## 配置示例

### 开发/调试环境（建议显示完整日志）

```bash
LOG_LEVEL=debug
EVENT_SUMMARY=always
MESSAGE_TEXT_MAX_LENGTH=0  # 不截断，显示完整内容
```

### 生产环境（建议适度截断）

```bash
LOG_LEVEL=info
EVENT_SUMMARY=debug
MESSAGE_TEXT_MAX_LENGTH=150  # 适度截断，节省日志空间
```

---

## 修改的文件

1. **`src/events.ts`**
   - 新增 `regenerateRawMessage()`: 从消息段重新生成 raw_message，正确序列化对象字段
   - 修改 `summarizeMessageEvent()`: 使用重新生成的 raw_message 替代 NapCat 原始值
   - 修改 `formatMessageCompact()`: 支持从环境变量读取文本长度限制
   - 简化 `sanitizeInline()`: 移除不必要的 `[object Object]` 替换（已在源头修复）

2. **`.env.example`**
   - 新增 `MESSAGE_TEXT_MAX_LENGTH` 配置说明

---

## 注意事项

1. **日志大小**：设置 `MESSAGE_TEXT_MAX_LENGTH=0` 会导致日志文件快速增长，建议仅在调试时使用。

2. **性能影响**：完整显示日志不会影响运行性能，只是会增加日志输出量。

3. **兼容性**：该配置仅影响日志显示，不影响实际消息处理逻辑。

4. **引用消息**：引用消息（quote）的文本长度固定为 60 个字符，不受此配置影响。

---

## 测试方法

### 测试 [object Object] 修复

发送包含特殊字段的消息（如表情），观察日志输出：

**之前（NapCat 原始 raw_message）：**
```
text="[CQ:face,id=5,raw=[object Object]]"
```

**现在（重新生成的 raw_message）：**
```
text="[CQ:face,id=5,raw={\"width\":100,\"height\":100}]"
```

可以看到对象的**真实内容**（JSON 格式）。

### 测试完整日志显示

1. 设置 `MESSAGE_TEXT_MAX_LENGTH=0`
2. 发送一条很长的消息（超过 80 字符）
3. 观察日志中的 `text="..."` 部分是否显示完整内容
4. 确认没有出现 `…` 省略号

---

## 相关环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `LOG_LEVEL` | `debug` | 日志级别 |
| `EVENT_SUMMARY` | `always` | 事件摘要打印方式 |
| `MESSAGE_TEXT_MAX_LENGTH` | `80` | 消息文本最大长度（0=不限制） |
| `JSON_LOG` | `false` | 是否使用 JSON 结构化日志 |
