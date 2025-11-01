# SDK 使用指南

## 概述

统一的 SDK 接口，支持正向和反向 WebSocket，提供简洁的调用方式。

## 特性

✨ **统一接口**: 正向/反向 WS 使用相同的 API  
🔧 **自动配置**: 从 .env 自动读取配置  
📦 **完整封装**: 覆盖所有 OneBot 11 动作  
🎯 **类型安全**: 完整的 TypeScript 类型定义  
⚡ **便捷方法**: 提供语义化的快捷方法  

## 快速开始

### 1. 配置 .env

```bash
# 正向 WS 配置
NAPCAT_WS_URL=ws://127.0.0.1:6700
NAPCAT_ACCESS_TOKEN=your_token

# 或反向 WS 配置
REVERSE_PORT=6701
REVERSE_PATH=/onebot

# 白名单（可选）
WHITELIST_GROUPS=123456,789012
WHITELIST_USERS=2166683295
```

### 2. 创建 SDK 实例

```typescript
import createSDK from 'napcat-adapter';

// 方式 1: 自动从 .env 读取（推荐）
const sdk = createSDK();

// 方式 2: 手动指定正向 WS
const sdk = createSDK({
  wsUrl: 'ws://127.0.0.1:6700',
  accessToken: 'your_token',
});

// 方式 3: 手动指定反向 WS
const sdk = createSDK({
  reverse: true,
  port: 6701,
  path: '/onebot',
});
```

### 3. 监听事件

```typescript
// 连接成功
sdk.on.open(() => {
  console.log('已连接');
});

// 接收消息
sdk.on.message(async (ev) => {
  console.log('收到消息:', ev.raw_message);
});

// 只监听群消息
sdk.on.groupMessage(async (ev) => {
  console.log(`群 ${ev.group_id}: ${ev.raw_message}`);
});

// 只监听私聊
sdk.on.privateMessage(async (ev) => {
  console.log(`私聊 ${ev.user_id}: ${ev.raw_message}`);
});
```

## 核心调用方法

### 直接调用 OneBot 动作

```typescript
// 最灵活的方式，直接调用任何 OneBot 动作
await sdk('send_group_msg', {
  group_id: 123456,
  message: [{ type: 'text', data: { text: 'Hello' } }]
});

await sdk('get_group_list');
await sdk('set_group_ban', { group_id: 123456, user_id: 789, duration: 600 });
```

### 提取数据

```typescript
// 自动提取 response.data
const loginInfo = await sdk.data('get_login_info');
console.log('Bot QQ:', loginInfo.user_id);

const groups = await sdk.data('get_group_list');
console.log('群列表:', groups);
```

### 校验响应

```typescript
// 校验 response.status === 'ok'
const response = await sdk.ok('send_private_msg', {
  user_id: 123456,
  message: 'Hello'
});
console.log('消息ID:', response.data.message_id);
```

### 自动重试

```typescript
// 失败时自动重试（带退避）
await sdk.retry('send_group_msg', {
  group_id: 123456,
  message: 'Hello'
});
```

## 消息发送

### 基础发送

```typescript
import { segment } from 'napcat-adapter';

// 发送私聊
await sdk.send.private(2166683295, 'Hello');
await sdk.send.private(2166683295, [
  segment.text('Hello '),
  segment.image('https://example.com/pic.jpg')
]);

// 发送群消息
await sdk.send.group(123456, 'Hello');
await sdk.send.group(123456, [
  segment.at(789),
  segment.text(' 你好')
]);
```

### 回复消息

```typescript
sdk.on.message(async (ev) => {
  // 自动判断群聊/私聊并回复
  await sdk.send.reply(ev, 'pong');
  
  // 或手动指定
  await sdk.send.groupReply(ev.group_id, ev.message_id, 'Hello');
  await sdk.send.privateReply(ev.user_id, ev.message_id, 'Hi');
});
```

### 合并转发

```typescript
import { ForwardBuilder } from 'napcat-adapter';

const nodes = new ForwardBuilder()
  .node([segment.text('消息1')], 'Alice', '1001')
  .node([segment.text('消息2')], 'Bob', '1002')
  .build();

await sdk.send.forwardGroup(123456, nodes);
await sdk.send.forwardPrivate(2166683295, nodes);
```

## 消息操作

```typescript
// 获取消息
const msg = await sdk.message.get(12345);
console.log('消息内容:', msg);

// 撤回消息
await sdk.message.recall(12345);

// 获取合并转发消息
const forward = await sdk.message.getForward('forward_id');
```

## 群组管理

```typescript
// 获取群列表
const groups = await sdk.group.list();

// 获取群信息
const info = await sdk.group.info(123456);
const infoNoCache = await sdk.group.info(123456, true);

// 获取群成员列表
const members = await sdk.group.memberList(123456);

// 获取群成员信息
const memberInfo = await sdk.group.memberInfo(123456, 789);

// 禁言
await sdk.group.ban(123456, 789, 600); // 禁言 10 分钟
await sdk.group.ban(123456, 789, 0);   // 解除禁言

// 全员禁言
await sdk.group.wholeBan(123456, true);  // 开启
await sdk.group.wholeBan(123456, false); // 关闭

// 踢人
await sdk.group.kick(123456, 789);
await sdk.group.kick(123456, 789, true); // 踢出并拒绝加群请求

// 设置群名片
await sdk.group.setCard(123456, 789, '新名片');
await sdk.group.setCard(123456, 789, ''); // 清空名片

// 设置群名
await sdk.group.setName(123456, '新群名');

// 退群
await sdk.group.leave(123456);
await sdk.group.leave(123456, true); // 解散群（需要是群主）
```

## 用户信息

```typescript
// 获取陌生人信息
const userInfo = await sdk.user.info(2166683295);
const userInfoNoCache = await sdk.user.info(2166683295, true);

// 获取好友列表
const friends = await sdk.user.friendList();

// 点赞
await sdk.user.sendLike(2166683295, 10); // 点赞 10 次
```

## 文件操作

```typescript
// 上传群文件
await sdk.file.uploadGroup(123456, 'C:\\path\\to\\file.jpg', 'file.jpg');
await sdk.file.uploadGroup(123456, '/path/to/file.jpg', 'file.jpg', 'folder_id');

// 上传私聊文件
await sdk.file.uploadPrivate(2166683295, 'C:\\path\\to\\file.jpg', 'file.jpg');

// 获取群根目录文件列表
const files = await sdk.file.getGroupRoot(123456);

// 获取群文件夹文件列表
const folderFiles = await sdk.file.getGroupFolder(123456, 'folder_id');

// 获取群文件下载链接
const fileUrl = await sdk.file.getGroupFileUrl(123456, 'file_id', 102);

// 删除群文件
await sdk.file.deleteGroupFile(123456, 'file_id', 102);

// 删除群文件夹
await sdk.file.deleteGroupFolder(123456, 'folder_id');

// 创建群文件夹
await sdk.file.createGroupFolder(123456, '新文件夹');
await sdk.file.createGroupFolder(123456, '子文件夹', 'parent_folder_id');
```

## 图片和媒体

```typescript
// 获取图片信息
const imageInfo = await sdk.media.getImage('image_file_id');
console.log('图片URL:', imageInfo.data.url);

// OCR 识别
const ocrResult = await sdk.media.ocrImage('base64_image_data');
console.log('识别结果:', ocrResult.data.texts);
```

## 请求处理

```typescript
// 处理加群请求
sdk.on.request(async (ev) => {
  if (ev.request_type === 'group') {
    // 同意
    await sdk.request.setGroupAdd(ev.flag, ev.sub_type, true);
    // 拒绝
    await sdk.request.setGroupAdd(ev.flag, ev.sub_type, false, '拒绝理由');
  }
});

// 处理好友请求
sdk.on.request(async (ev) => {
  if (ev.request_type === 'friend') {
    // 同意
    await sdk.request.setFriendAdd(ev.flag, true);
    // 拒绝
    await sdk.request.setFriendAdd(ev.flag, false);
  }
});
```

## 系统信息

```typescript
// 获取登录信息
const loginInfo = await sdk.system.loginInfo();
console.log('Bot QQ:', loginInfo.data.user_id);
console.log('昵称:', loginInfo.data.nickname);

// 获取状态
const status = await sdk.system.status();
console.log('在线:', status.data.online);

// 获取版本信息
const version = await sdk.system.versionInfo();
console.log('版本:', version.data.app_name);
```

## 工具方法

```typescript
sdk.on.message(async (ev) => {
  // 检查是否 @ 了机器人
  if (sdk.utils.isAtMe(ev)) {
    await sdk.send.reply(ev, '你 @ 我了');
  }

  // 获取纯文本内容
  const plainText = sdk.utils.getPlainText(ev);
  console.log('纯文本:', plainText);
});
```

## 完整示例

### 简单的命令机器人

```typescript
import createSDK from 'napcat-adapter';

const sdk = createSDK();

sdk.on.open(() => {
  console.log('✅ 机器人已启动');
});

sdk.on.message(async (ev) => {
  const text = sdk.utils.getPlainText(ev).trim();

  // ping 命令
  if (text === 'ping') {
    await sdk.send.reply(ev, 'pong');
  }

  // 菜单命令
  if (text === 'menu') {
    await sdk.send.reply(ev, [
      '可用命令:',
      '- ping: 测试连接',
      '- info: 查看信息',
      '- menu: 显示菜单'
    ].join('\n'));
  }

  // 信息命令
  if (text === 'info') {
    const loginInfo = await sdk.data('get_login_info');
    await sdk.send.reply(ev, `Bot QQ: ${loginInfo.user_id}`);
  }
});

sdk.on.error((err) => {
  console.error('错误:', err.message);
});

process.on('SIGINT', async () => {
  await sdk.dispose();
  process.exit(0);
});
```

### 群管理机器人

```typescript
import createSDK from 'napcat-adapter';

const sdk = createSDK();
const ADMIN_QQ = 2166683295; // 管理员 QQ

sdk.on.groupMessage(async (ev) => {
  // 只响应管理员
  if (ev.user_id !== ADMIN_QQ) return;

  const text = sdk.utils.getPlainText(ev).trim();
  const args = text.split(' ');
  const cmd = args[0];

  // 禁言命令: ban @user 600
  if (cmd === 'ban' && args.length >= 3) {
    const atSeg = ev.message.find(seg => seg.type === 'at');
    if (atSeg) {
      const userId = parseInt(atSeg.data.qq);
      const duration = parseInt(args[2]);
      await sdk.group.ban(ev.group_id, userId, duration);
      await sdk.send.reply(ev, `已禁言 ${duration} 秒`);
    }
  }

  // 踢人命令: kick @user
  if (cmd === 'kick') {
    const atSeg = ev.message.find(seg => seg.type === 'at');
    if (atSeg) {
      const userId = parseInt(atSeg.data.qq);
      await sdk.group.kick(ev.group_id, userId);
      await sdk.send.reply(ev, '已踢出');
    }
  }

  // 全员禁言: muteall on/off
  if (cmd === 'muteall' && args[1]) {
    const enable = args[1] === 'on';
    await sdk.group.wholeBan(ev.group_id, enable);
    await sdk.send.reply(ev, enable ? '已开启全员禁言' : '已关闭全员禁言');
  }
});
```

## 错误处理

```typescript
// 方式 1: try-catch
try {
  await sdk.send.group(123456, 'Hello');
} catch (err) {
  console.error('发送失败:', err.message);
}

// 方式 2: 使用 retry 自动重试
await sdk.retry('send_group_msg', {
  group_id: 123456,
  message: 'Hello'
});

// 方式 3: 监听错误事件
sdk.on.error((err) => {
  console.error('SDK 错误:', err);
});
```

## 生命周期管理

```typescript
// 创建 SDK
const sdk = createSDK();

// 监听连接状态
sdk.on.open(() => {
  console.log('已连接');
});

sdk.on.close((code, reason) => {
  console.log(`连接关闭: ${code} ${reason}`);
});

// 优雅退出
process.on('SIGINT', async () => {
  console.log('正在关闭...');
  await sdk.dispose(); // 清理资源
  process.exit(0);
});
```

## 访问底层适配器

```typescript
const sdk = createSDK();

// 访问适配器实例
const adapter = sdk.adapter;

// 使用适配器的原生方法
if (adapter instanceof NapcatAdapter) {
  await adapter.setGroupWholeBan(123456, true);
}

// 使用插件
import { createCommandRouter } from 'napcat-adapter';
const router = createCommandRouter({ prefix: '!' });
router.command('ping', async (ctx) => {
  await ctx.reply('pong');
});
adapter.use(router);
```

## 类型定义

```typescript
import type { 
  SdkInvoke,
  OneBotResponse,
  MessageEvent,
  MessageInput 
} from 'napcat-adapter';

// SDK 实例类型
const sdk: SdkInvoke = createSDK();

// 消息事件类型
sdk.on.message(async (ev: MessageEvent) => {
  console.log(ev.message_id);
});

// 响应类型
const response: OneBotResponse = await sdk('get_login_info');
```

## 最佳实践

### 1. 使用环境变量

```bash
# .env
NAPCAT_WS_URL=ws://127.0.0.1:6700
NAPCAT_ACCESS_TOKEN=your_token
WHITELIST_GROUPS=123456,789012
LOG_LEVEL=info
```

```typescript
// 代码中直接使用
const sdk = createSDK(); // 自动读取 .env
```

### 2. 错误处理

```typescript
sdk.on.error((err) => {
  console.error('[SDK Error]', err);
});

sdk.on.message(async (ev) => {
  try {
    await sdk.send.reply(ev, 'Hello');
  } catch (err) {
    console.error('发送失败:', err);
  }
});
```

### 3. 优雅退出

```typescript
const cleanup = async () => {
  console.log('正在关闭...');
  await sdk.dispose();
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
```

### 4. 使用白名单

```bash
# .env
WHITELIST_GROUPS=123456,789012
WHITELIST_USERS=2166683295
```

只有白名单内的消息会被处理，其他消息自动忽略。

## 运行示例

```bash
# 简单示例
npm run example:sdk

# 完整示例
npm run example:sdk-full

# 白名单示例
npm run example:whitelist
```

## 常见问题

### Q: 如何同时支持正向和反向 WS？

A: SDK 会根据配置自动选择模式。如果设置了 `reverse: true`，使用反向模式；否则使用正向模式。

### Q: 如何在其他项目中使用？

A: SDK 会从项目根目录读取 `.env` 文件。确保在项目根目录有 `.env` 文件即可。

### Q: 如何调试？

A: 设置 `LOG_LEVEL=debug` 查看详细日志。

### Q: 如何处理大量消息？

A: 使用白名单过滤不需要的消息，减少处理负担。

## 更多资源

- [完整 API 文档](./API.md)
- [白名单功能](./WHITELIST.md)
- [示例代码](../examples/)
- [OneBot 11 协议](https://github.com/botuniverse/onebot-11)
