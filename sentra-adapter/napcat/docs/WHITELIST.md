# 白名单过滤功能详解

## 概述

白名单功能允许你精确控制机器人处理哪些消息，忽略不在白名单中的群聊和私聊消息。这对于以下场景特别有用：

- 🎯 只在特定群组中提供服务
- 🔒 限制私聊功能仅对特定用户开放
- 📊 减少日志噪音，只记录关心的消息
- ⚡ 提高性能，避免处理无关消息

## 配置方式

### 方式 1: 环境变量配置（推荐）

在 `.env` 文件中配置：

```bash
# 群聊白名单（逗号分隔的群号）
WHITELIST_GROUPS=123456789,987654321,555666777

# 私聊白名单（逗号分隔的 QQ 号）
WHITELIST_USERS=2166683295,1234567890

# 是否记录被过滤的消息
LOG_FILTERED=true
```

### 方式 2: 代码配置

```typescript
import { NapcatAdapter } from 'napcat-adapter';

const adapter = new NapcatAdapter({
  wsUrl: 'ws://127.0.0.1:6700',
  accessToken: 'your_token',
  
  // 白名单配置
  whitelistGroups: [123456789, 987654321],
  whitelistUsers: [2166683295],
  logFiltered: true,
});
```

### 方式 3: SDK 配置

```typescript
import createSDK from 'napcat-adapter';

const sdk = createSDK({
  wsUrl: 'ws://127.0.0.1:6700',
  whitelistGroups: [123456789],
  whitelistUsers: [2166683295],
  logFiltered: false,
});
```

## 使用场景

### 场景 1: 只在特定群组工作

```typescript
// 只处理这 3 个群的消息
const adapter = new NapcatAdapter({
  wsUrl: 'ws://127.0.0.1:6700',
  whitelistGroups: [123456, 789012, 345678],
  // 不设置 whitelistUsers，允许所有私聊
});

adapter.on('message', async (ev) => {
  // 只有来自白名单群的消息才会到这里
  if (ev.message_type === 'group') {
    console.log(`群 ${ev.group_id} 的消息`);
  }
});
```

### 场景 2: 只接受特定用户的私聊

```typescript
// 只处理管理员的私聊
const adapter = new NapcatAdapter({
  wsUrl: 'ws://127.0.0.1:6700',
  whitelistUsers: [2166683295, 1234567890], // 管理员 QQ
  // 不设置 whitelistGroups，允许所有群聊
});

adapter.on('message', async (ev) => {
  if (ev.message_type === 'private') {
    console.log(`管理员 ${ev.user_id} 的私聊`);
  }
});
```

### 场景 3: 同时限制群聊和私聊

```typescript
const adapter = new NapcatAdapter({
  wsUrl: 'ws://127.0.0.1:6700',
  whitelistGroups: [123456, 789012],      // 只处理这两个群
  whitelistUsers: [2166683295],           // 只处理这个用户的私聊
  logFiltered: true,                      // 记录被过滤的消息
});
```

### 场景 4: 测试环境 - 只响应开发者

```typescript
const isDev = process.env.NODE_ENV === 'development';

const adapter = new NapcatAdapter({
  wsUrl: 'ws://127.0.0.1:6700',
  // 开发环境只处理开发者的消息
  whitelistGroups: isDev ? [123456] : [],  // 空数组 = 允许所有
  whitelistUsers: isDev ? [2166683295] : [],
  logFiltered: isDev,
});
```

## 工作原理

### 过滤逻辑

1. **群聊消息**：
   - 如果 `whitelistGroups` 为空 → 允许所有群聊
   - 如果 `whitelistGroups` 有值 → 只允许白名单内的群

2. **私聊消息**：
   - 如果 `whitelistUsers` 为空 → 允许所有私聊
   - 如果 `whitelistUsers` 有值 → 只允许白名单内的用户

3. **其他事件**：
   - `notice`（通知）、`request`（请求）、`meta_event`（元事件）不受白名单影响

### 过滤时机

消息在到达你的事件处理器之前就被过滤，流程如下：

```
WebSocket 接收消息
    ↓
去重检查 (filterDuplicate)
    ↓
白名单检查 (filterWhitelist) ← 在这里过滤
    ↓
触发事件处理器 (on('message'))
```

### 日志输出

当 `LOG_FILTERED=true` 时，被过滤的消息会输出调试日志：

```
[debug] Filtered: group not in whitelist { group_id: 999999, user_id: 123456 }
[debug] Filtered: user not in whitelist { user_id: 888888 }
```

## 动态更新白名单

白名单在适配器初始化时设置，如果需要动态更新，可以：

### 方式 1: 重新创建适配器

```typescript
let adapter = new NapcatAdapter({
  wsUrl: 'ws://127.0.0.1:6700',
  whitelistGroups: [123456],
});

// 需要更新白名单时
await adapter.destroy();
adapter = new NapcatAdapter({
  wsUrl: 'ws://127.0.0.1:6700',
  whitelistGroups: [123456, 789012], // 新的白名单
});
await adapter.connect();
```

### 方式 2: 在事件处理器中手动过滤

```typescript
const allowedGroups = new Set([123456, 789012]);

adapter.on('message', async (ev) => {
  // 手动检查
  if (ev.message_type === 'group' && !allowedGroups.has(ev.group_id)) {
    return; // 忽略
  }
  
  // 处理消息
  console.log('处理消息:', ev.raw_message);
});

// 可以随时更新
allowedGroups.add(345678);
allowedGroups.delete(123456);
```

## 性能考虑

- ✅ 白名单检查使用 `Set` 数据结构，查找时间复杂度为 O(1)
- ✅ 过滤在事件分发前进行，避免不必要的处理
- ✅ 空白名单（未设置）不会进行任何检查，性能无影响
- ⚠️ 设置 `LOG_FILTERED=true` 会增加日志输出，生产环境建议关闭

## 常见问题

### Q: 白名单为空时会怎样？

A: 空白名单表示"允许所有"。如果你不设置 `WHITELIST_GROUPS`，所有群聊都会被处理。

### Q: 可以只设置群聊白名单，不限制私聊吗？

A: 可以。只设置 `WHITELIST_GROUPS`，不设置 `WHITELIST_USERS` 即可。

### Q: 白名单会影响机器人发送消息吗？

A: 不会。白名单只过滤接收的消息，不影响发送功能。你仍然可以向任何群或用户发送消息。

### Q: 如何获取群号和 QQ 号？

A: 
1. 临时关闭白名单（留空）
2. 设置 `LOG_LEVEL=debug` 和 `EVENT_SUMMARY=always`
3. 运行机器人，在日志中查看消息的 `group_id` 和 `user_id`
4. 将需要的 ID 添加到白名单

### Q: 白名单支持正则表达式吗？

A: 目前不支持。白名单只支持精确匹配的数字 ID。

## 示例代码

完整示例请查看：`examples/whitelist.ts`

运行示例：

```bash
npm run example:whitelist
```

## 反向 WebSocket 支持

反向 WS 模式同样支持白名单：

```typescript
import { NapcatReverseAdapter } from 'napcat-adapter';

const adapter = new NapcatReverseAdapter({
  port: 6701,
  path: '/onebot',
  accessToken: 'your_token',
  whitelistGroups: [123456],
  whitelistUsers: [2166683295],
  logFiltered: true,
});

adapter.start();
```

## 总结

白名单功能提供了灵活的消息过滤能力：

- 📝 支持环境变量和代码配置
- 🎯 可以分别控制群聊和私聊
- 🔍 可选的过滤日志记录
- ⚡ 高性能的 Set 查找
- 🔄 支持正向和反向 WS 模式

根据你的需求选择合适的配置方式，让机器人只关注重要的消息！
