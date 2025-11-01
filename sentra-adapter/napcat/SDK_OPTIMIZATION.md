# SDK 全面优化总结

## ✅ 已完成的优化

### 1. 修复编译错误

#### 问题 1: `import.meta` ES Module 错误
**错误信息**: `The 'import.meta' meta-property is only allowed when the '--module' option is 'es2020'...`

**解决方案**: 
- 移除了 ES Module 的 `import.meta.url` 检测
- 直接使用 CommonJS 的 `__dirname`
- 简化了项目根目录的定位逻辑

**修改文件**: `src/config.ts`

```typescript
// 修改前（有问题）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
projectRoot = resolve(__dirname, '..');

// 修改后（正确）
const projectRoot = resolve(__dirname, '..');
config({ path: resolve(projectRoot, '.env') });
```

#### 问题 2: EventEmitter 类型兼容性错误
**错误信息**: `This expression is not callable. Each member of the union type...`

**解决方案**:
- 将事件监听器先赋值给变量
- 使用类型断言 `(adapter as any)` 避免类型冲突
- 确保 `on` 和 `off` 使用相同的监听器引用

**修改文件**: `src/sdk.ts`

```typescript
// 修改前（有问题）
adapter.on('message', handler as any);
return () => adapter.off('message', handler as any);

// 修改后（正确）
const listener = handler as any;
(adapter as any).on('message', listener);
return () => (adapter as any).off('message', listener);
```

### 2. 统一的 SDK 接口

#### 核心调用方法

```typescript
// 直接调用 OneBot 动作
await sdk('send_group_msg', { group_id: 123456, message: 'Hello' });

// 提取数据
const data = await sdk.data('get_login_info');

// 校验响应
const response = await sdk.ok('send_private_msg', { user_id: 123, message: 'Hi' });

// 自动重试
await sdk.retry('send_group_msg', { group_id: 123456, message: 'Hello' });
```

#### 消息发送

```typescript
sdk.send = {
  private: (user_id, message) => ...,
  group: (group_id, message) => ...,
  reply: (ev, message) => ...,
  privateReply: (user_id, message_id, message) => ...,
  groupReply: (group_id, message_id, message) => ...,
  forwardGroup: (group_id, messages) => ...,
  forwardPrivate: (user_id, messages) => ...,
};
```

#### 消息操作

```typescript
sdk.message = {
  recall: (message_id) => ...,
  get: (message_id) => ...,
  getForward: (id) => ...,
};
```

#### 群组管理

```typescript
sdk.group = {
  list: () => ...,
  info: (group_id, no_cache?) => ...,
  memberList: (group_id) => ...,
  memberInfo: (group_id, user_id, no_cache?) => ...,
  wholeBan: (group_id, enable?) => ...,
  ban: (group_id, user_id, duration) => ...,
  kick: (group_id, user_id, reject_add_request?) => ...,
  setCard: (group_id, user_id, card?) => ...,
  setName: (group_id, group_name) => ...,
  leave: (group_id, is_dismiss?) => ...,
};
```

#### 文件操作

```typescript
sdk.file = {
  uploadGroup: (group_id, file, name?, folder?) => ...,
  uploadPrivate: (user_id, file, name?) => ...,
  getGroupRoot: (group_id) => ...,
  getGroupFolder: (group_id, folder_id) => ...,
  getGroupFileUrl: (group_id, file_id, busid) => ...,
  deleteGroupFile: (group_id, file_id, busid) => ...,
  deleteGroupFolder: (group_id, folder_id) => ...,
  createGroupFolder: (group_id, name, parent_id?) => ...,
};
```

#### 用户信息

```typescript
sdk.user = {
  info: (user_id, no_cache?) => ...,
  friendList: () => ...,
  sendLike: (user_id, times?) => ...,
};
```

#### 请求处理

```typescript
sdk.request = {
  setGroupAdd: (flag, sub_type, approve, reason?) => ...,
  setFriendAdd: (flag, approve, remark?) => ...,
};
```

#### 图片和媒体

```typescript
sdk.media = {
  getImage: (file) => ...,
  ocrImage: (image) => ...,
};
```

#### 系统信息

```typescript
sdk.system = {
  loginInfo: () => ...,
  status: () => ...,
  versionInfo: () => ...,
};
```

#### 事件监听

```typescript
sdk.on = {
  message: (handler) => ...,
  groupMessage: (handler) => ...,
  privateMessage: (handler) => ...,
  notice: (handler) => ...,
  request: (handler) => ...,
  meta_event: (handler) => ...,
  open: (handler) => ...,
  close: (handler) => ...,
  error: (handler) => ...,
};
```

#### 工具方法

```typescript
sdk.utils = {
  isAtMe: (ev) => ...,
  getPlainText: (ev) => ...,
};
```

### 3. 配置优化

#### .env 文件路径修复

- 确保从项目根目录加载 `.env` 文件
- 使用 `__dirname` 定位项目根目录
- 避免在其他项目中调用时出现路径问题

#### 新增配置项

```bash
# 反向 WS 配置
REVERSE_PORT=6701
REVERSE_PATH=/onebot
```

### 4. 正向/反向 WS 统一

#### 自动模式检测

```typescript
// 自动从 .env 读取配置
const sdk = createSDK();

// 手动指定正向 WS
const sdk = createSDK({
  wsUrl: 'ws://127.0.0.1:6700',
  accessToken: 'your_token',
});

// 手动指定反向 WS
const sdk = createSDK({
  reverse: true,
  port: 6701,
  path: '/onebot',
});
```

#### 统一的事件处理

- 正向模式: `open` / `close` 事件
- 反向模式: `connected` / `disconnected` 事件
- SDK 自动映射到统一的 `on.open()` / `on.close()`

### 5. 反向适配器增强

#### 新增方法

```typescript
// 合并转发消息
async sendGroupForwardMessage(group_id: number, messages: any[])
async sendPrivateForwardMessage(user_id: number, messages: any[])
```

### 6. 示例代码

#### 简单示例

**文件**: `examples/sdk-simple.ts`

```typescript
import createSDK from '../src/sdk';

const sdk = createSDK();

sdk.on.message(async (ev) => {
  const text = sdk.utils.getPlainText(ev);
  if (text === 'ping') {
    await sdk.send.reply(ev, 'pong');
  }
});
```

#### 完整示例

**文件**: `examples/sdk-unified.ts`

包含所有 SDK 功能的完整演示。

### 7. 文档

#### SDK 使用指南

**文件**: `docs/SDK.md`

- 快速开始
- 核心调用方法
- 所有功能的详细说明
- 完整示例代码
- 最佳实践
- 常见问题

### 8. 运行脚本

**package.json** 新增:

```json
{
  "scripts": {
    "example:sdk": "ts-node examples/sdk-simple.ts",
    "example:sdk-full": "ts-node examples/sdk-unified.ts"
  }
}
```

## 🎯 优化亮点

### 1. 统一接口

无论使用正向还是反向 WS，API 完全一致：

```typescript
// 正向和反向使用相同的代码
await sdk.send.group(123456, 'Hello');
await sdk.group.ban(123456, 789, 600);
```

### 2. 灵活调用

支持多种调用方式：

```typescript
// 方式 1: 直接调用（最灵活）
await sdk('send_group_msg', { group_id: 123456, message: 'Hello' });

// 方式 2: 便捷方法（最简洁）
await sdk.send.group(123456, 'Hello');

// 方式 3: 数据提取（最方便）
const data = await sdk.data('get_login_info');

// 方式 4: 自动重试（最可靠）
await sdk.retry('send_group_msg', { group_id: 123456, message: 'Hello' });
```

### 3. 自动配置

从 `.env` 自动读取所有配置：

```bash
# .env
NAPCAT_WS_URL=ws://127.0.0.1:6700
NAPCAT_ACCESS_TOKEN=your_token
WHITELIST_GROUPS=123456,789012
```

```typescript
// 代码中直接使用
const sdk = createSDK(); // 自动读取所有配置
```

### 4. 类型安全

完整的 TypeScript 类型定义：

```typescript
import type { SdkInvoke, MessageEvent } from 'napcat-adapter';

const sdk: SdkInvoke = createSDK();

sdk.on.message(async (ev: MessageEvent) => {
  // 完整的类型提示
});
```

### 5. 错误处理

多层错误处理机制：

```typescript
// 1. try-catch
try {
  await sdk.send.group(123456, 'Hello');
} catch (err) {
  console.error(err);
}

// 2. 自动重试
await sdk.retry('send_group_msg', { ... });

// 3. 错误事件
sdk.on.error((err) => {
  console.error('SDK Error:', err);
});
```

## 📊 对比

### 优化前

```typescript
// 需要手动判断正向/反向
if (isReverse) {
  adapter = new NapcatReverseAdapter(options);
  adapter.start();
} else {
  adapter = new NapcatAdapter(options);
  await adapter.connect();
}

// 需要手动调用原始方法
await adapter.call('send_group_msg', { group_id: 123456, message: 'Hello' });

// 事件监听不统一
if (isReverse) {
  adapter.on('connected', handler);
} else {
  adapter.on('open', handler);
}
```

### 优化后

```typescript
// 自动处理正向/反向
const sdk = createSDK();

// 统一的便捷方法
await sdk.send.group(123456, 'Hello');

// 统一的事件监听
sdk.on.open(() => {
  console.log('已连接');
});
```

## ✅ 验证

### 编译测试

```bash
npm run build
# ✅ 编译成功，无错误
```

### 功能测试

```bash
# 简单示例
npm run example:sdk

# 完整示例
npm run example:sdk-full

# 白名单示例
npm run example:whitelist
```

## 📝 使用建议

### 1. 推荐使用 SDK

```typescript
// ✅ 推荐：使用 SDK
import createSDK from 'napcat-adapter';
const sdk = createSDK();
await sdk.send.group(123456, 'Hello');

// ❌ 不推荐：直接使用适配器
import { NapcatAdapter } from 'napcat-adapter';
const adapter = new NapcatAdapter({ ... });
await adapter.call('send_group_msg', { ... });
```

### 2. 使用便捷方法

```typescript
// ✅ 推荐：使用便捷方法
await sdk.send.group(123456, 'Hello');
await sdk.group.ban(123456, 789, 600);

// ❌ 不推荐：直接调用
await sdk('send_group_msg', { group_id: 123456, message: 'Hello' });
await sdk('set_group_ban', { group_id: 123456, user_id: 789, duration: 600 });
```

### 3. 使用环境变量

```bash
# ✅ 推荐：使用 .env
NAPCAT_WS_URL=ws://127.0.0.1:6700
WHITELIST_GROUPS=123456,789012
```

```typescript
// 代码中直接使用
const sdk = createSDK();
```

## 🎉 总结

SDK 已经过全面优化，提供了：

- ✅ 统一的调用接口
- ✅ 完整的类型定义
- ✅ 自动配置加载
- ✅ 正向/反向 WS 统一
- ✅ 丰富的便捷方法
- ✅ 完善的错误处理
- ✅ 详细的文档和示例

现在可以用最简洁的方式开发 NapCat 机器人了！

---

**优化完成时间**: 2025-10-15  
**版本**: v0.1.0  
**状态**: ✅ 已完成并通过测试
