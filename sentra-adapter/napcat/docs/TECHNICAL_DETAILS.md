# 技术实现细节

本文档说明消息流服务的关键技术实现。

---

## 媒体文件处理

### 概述

消息中的多媒体内容（图片、语音、视频、文件）需要调用专用 API 获取完整信息（本地路径、下载链接、文件大小等）。

---

## 1. 图片处理

### 当前消息图片
- **字段来源**: `segment.data.file`、`segment.data.url`
- **URL处理**: 原始URL + `?file=文件名` 参数
- **无需额外API**: 已包含完整URL

### 引用消息图片
- **API**: `get_image` 
- **参数**: `file` (文件名或URL)
- **返回**: `file`(本地路径)、`url`、`file_size`、`file_name`
- **优先级**: 使用本地路径 `file`

**代码位置**: 
- 提取: `src/stream.ts` `formatMessage()` 第250行
- 丰富: `src/sdk.ts` `enrichImages()` 第639行

---

## 2. 语音处理

### 当前消息语音
- **API**: `get_record`
- **参数**: `file` (文件名), `out_format: 'mp3'`
- **返回**: `file`(本地路径)、`file_size`
- **调用时机**: 推送到 stream 前（`src/main.ts` 第104-120行）

### 引用消息语音
- **API**: 同上 `get_record`
- **返回**: 本地完整路径
- **优先级**: 始终使用本地路径

**字段映射**:
```typescript
{
  file: seg.data?.file,        // 文件名
  url: seg.data?.url,           // 原始URL（可选）
  path: detail.file,            // 本地路径（从API获取）
  file_size: detail.file_size   // 文件大小（从API获取）
}
```

**代码位置**:
- 提取: `src/stream.ts` `formatMessage()` 第256-262行
- API调用: `src/main.ts` 第104-120行
- 丰富: `src/sdk.ts` `enrichRecords()` 第657行

---

## 3. 文件处理

### 当前消息文件

#### 字段提取
```typescript
// src/stream.ts formatMessage() 第254-260行
files.push({ 
  name: seg.data?.file || seg.data?.name,  // 文件名
  file_id: seg.data?.file_id,              // 文件ID（关键）
  size: seg.data?.file_size || seg.data?.size,
  url: seg.data?.url                        // 初始为空
});
```

#### API调用（推送前）
```typescript
// src/main.ts 第122-160行

// 私聊文件
if (message_type === 'private') {
  response = await sdk.call('get_file', {
    file_id: fileId
  });
}

// 群聊文件
if (message_type === 'group') {
  response = await sdk.call('get_group_file_url', {
    group_id: groupId,
    file_id: fileId,
    busid: 102  // 默认值
  });
}

// 更新 segment.data
seg.data.url = detail.url || detail.file_url;
seg.data.file_size = detail.file_size;
seg.data.file = detail.file_name || seg.data.file;
```

### 引用消息文件

#### API调用
```typescript
// src/sdk.ts enrichFiles() 第673-694行

const fileId = f.file_id || f.id;  // 兼容多种字段名

if (msgType === 'group' && targetId && fileId) {
  detail = await fn.data('get_group_file_url', { 
    group_id: targetId, 
    file_id: fileId, 
    busid: f.busid || 102 
  });
} else if (msgType === 'private' && targetId && fileId) {
  detail = await fn.data('get_file', { 
    file_id: fileId 
  });
}

return {
  name: detail?.file_name || f.file || f.name,
  url: detail?.url || detail?.file_url || f.url,
  size: detail?.file_size || f.file_size || f.size,
};
```

### API 返回字段差异

| API | 返回字段 | 说明 |
|-----|---------|------|
| `get_file` | `url`, `file_name`, `file_size` | 私聊文件 |
| `get_group_file_url` | `url` 或 `file_url` | 群聊文件，字段名可能不同 |

**关键点**:
- ✅ 必须使用 `file_id` 而不是 `id`
- ✅ 私聊和群聊使用不同的API
- ✅ 返回字段名不统一，需要兼容处理
- ✅ 在推送到 stream **之前**调用API获取URL

**代码位置**:
- 提取: `src/stream.ts` `formatMessage()` 第254-260行
- API调用: `src/main.ts` 第122-160行
- 丰富: `src/sdk.ts` `enrichFiles()` 第673-694行

---

## 4. 视频处理

### 当前消息视频
- **字段来源**: `segment.data.file`、`segment.data.url`
- **URL处理**: 原始URL + `?file=文件名` 参数
- **无专用API**: 暂无 `get_video` API

### 引用消息视频
- **处理**: 直接传递 `file`、`url`、`size`
- **无API调用**: NapCat 暂未提供视频详情API

**代码位置**: 
- 提取: `src/stream.ts` `formatMessage()` 第252行
- 传递: `src/sdk.ts` `collectMedia()` 第622行

---

## 5. 转发消息处理

### API调用
- **API**: `get_forward_msg`
- **参数**: `id` (转发消息ID)
- **返回**: `messages` (消息数组)

### 处理逻辑
```typescript
// src/sdk.ts enrichForwards() 第696-717行

const detail = await fn.data('get_forward_msg', { id: fwd.id });
const nodes = detail?.messages || detail?.data?.messages || [];
const nodesCount = nodes.length;

// 提取前3条消息预览
const preview = nodes.slice(0, 3).map((n) => {
  const plain = segsToPlain(n.content || n.message);
  const sender = n.sender?.nickname || n.user_id || '?';
  return `${sender}: ${plain.slice(0, 30)}...`;
});

return { 
  id: fwd.id, 
  count: nodesCount, 
  preview 
};
```

**代码位置**: `src/sdk.ts` `enrichForwards()` 第696行

---

## 执行流程

### 当前消息

```
1. 接收 MessageEvent
   ↓
2. 检测是否有 record/file segments
   ↓
3. 并行调用 API 获取详情
   - get_record (语音)
   - get_file / get_group_file_url (文件)
   ↓
4. 更新 segment.data
   ↓
5. 推送到 MessageStream
   ↓
6. formatMessage 提取数据
   ↓
7. generateSummary 生成摘要
```

**代码位置**: `src/main.ts` 第99-168行

### 引用消息

```
1. 检测 reply segment
   ↓
2. 调用 getReplyContext
   ↓
3. 获取被引用消息详情
   ↓
4. collectMedia 收集多媒体
   ↓
5. 并行调用 API 丰富信息
   - enrichImages
   - enrichRecords
   - enrichFiles
   - enrichForwards
   ↓
6. 返回完整 replyContext
   ↓
7. 传递给 MessageStream
```

**代码位置**: `src/sdk.ts` `getReplyContext()` 第503-736行

---

## 字段名兼容性

由于 NapCat 不同版本和不同消息类型可能使用不同字段名，代码中做了兼容处理：

| 语义 | 可能的字段名 | 处理方式 |
|------|------------|---------|
| 文件名 | `file`, `name`, `file_name` | `f.file \|\| f.name \|\| detail.file_name` |
| 文件ID | `file_id`, `id` | `f.file_id \|\| f.id` |
| 文件大小 | `file_size`, `size` | `f.file_size \|\| f.size \|\| detail.file_size` |
| 下载URL | `url`, `file_url` | `detail.url \|\| detail.file_url \|\| f.url` |

---

## 性能优化

### 并行处理
- 语音和文件的API调用使用 `Promise.all()` 并行执行
- 引用消息的多媒体丰富也是并行的

### 限制数量
- 图片: 最多处理前 5 张 (`enrichImages`)
- 文件: 最多处理前 5 个 (`enrichFiles`)
- 语音: 最多处理前 5 条 (`enrichRecords`)
- 转发: 最多处理前 2 条 (`enrichForwards`)

### 错误容忍
- 所有API调用都有 `try-catch`
- 失败时返回原始数据
- 不阻塞消息流推送

---

## API 文档参考

- [获取私聊文件链接 - NapCat](https://napneko.github.io/zh-CN/develop/api)
- [获取群文件链接 - NapCat](https://napneko.github.io/zh-CN/develop/api)
- [获取语音 - NapCat](https://napneko.github.io/zh-CN/develop/api)
- [获取图片信息 - NapCat](https://napneko.github.io/zh-CN/develop/api)
- [获取转发消息 - NapCat](https://napneko.github.io/zh-CN/develop/api)

---

## 常见问题

### Q: 为什么文件URL是 undefined？
**A**: 需要使用 `file_id` 调用 `get_file` 或 `get_group_file_url` API 获取。segment 中只有 `file_id`，不包含直接可用的URL。

### Q: 私聊和群聊文件处理有什么不同？
**A**: 
- **私聊**: `get_file` API，只需 `file_id`
- **群聊**: `get_group_file_url` API，需要 `group_id` + `file_id` + `busid`

### Q: 为什么要在推送前调用API？
**A**: 因为 `formatMessage` 只是提取数据，不做异步操作。必须在推送前准备好所有数据。

### Q: 语音为什么优先使用本地路径？
**A**: 本地路径可以直接访问，速度更快，且不需要网络。从 `get_record` API 返回的 `file` 字段就是完整的本地路径。

### Q: 如何处理API调用失败？
**A**: 使用 `try-catch` 捕获错误，失败时使用原始数据（可能不完整）。不会阻塞消息流。

---

## 测试建议

1. **发送文件**: 测试私聊和群聊文件，检查URL是否正确
2. **回复文件**: 测试引用包含文件的消息，检查详情是否完整
3. **发送语音**: 检查本地路径和文件大小是否显示
4. **多媒体组合**: 测试文本+图片+文件的复杂消息
5. **API失败**: 模拟API失败，检查是否优雅降级

---

## 版本历史

- **2025-10-16**: 修复文件处理，正确使用 `file_id` 调用 API
- **2025-10-16**: 添加语音本地路径获取
- **2025-10-16**: 统一字段名兼容性处理
