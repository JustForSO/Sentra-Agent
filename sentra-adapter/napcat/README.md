# NapCat WS Adapter (OneBot 11)

一个基于 TypeScript/WS 的 NapCat 适配器框架，采用 OneBot 11 WebSocket 协议，支持私聊、群聊、撤回等常用动作，并提供事件分发。

- 支持 WS（优先正向 WS）；可在 URL 中附加 `access_token` 或使用 `Authorization: Bearer <token>`。
- 事件模型：`message` / `notice` / `request` / `meta_event`。
- 动作封装：`send_private_msg`、`send_group_msg`、`send_msg`、`delete_msg`、`get_msg`、`get_group_list`、`get_group_member_list`、`get_login_info` 等。
- 管理/请求：`set_group_whole_ban`、`set_group_ban`、`set_group_kick`、`set_group_card`、`set_group_name`、`send_like`、`set_group_add_request`、`set_friend_add_request`。
- 文件与媒体：`upload_group_file`、`upload_private_file`、`get_group_root_files`、`get_group_files_by_folder`、`get_group_file_url`、`delete_group_file`、`delete_group_folder`、`create_group_file_folder`、`get_image`、`ocr_image`。
- 合并转发：`send_group_forward_msg`、`send_private_forward_msg`。
- 消息段工具：`text`、`at`、`atAll`、`image`、`reply`、`face`、`record`、`video`、`xml`、`json`。
- 内置基于 `chalk` 的彩色日志，`.env` 支持 `LOG_LEVEL=debug|info|warn|error|silent`。
- 通用 `call(action, params)`，便于覆盖 NapCat 文档的更多能力。

> 📖 **文档导航：**
> - **[消息流服务文档 (STREAM.md)](./docs/STREAM.md)** - WebSocket 实时消息推送与 SDK RPC 调用完整指南
> - **[Stream RPC 完整示例 (STREAM_RPC_EXAMPLES.md)](./docs/STREAM_RPC_EXAMPLES.md)** - 每个 SDK 方法的具体 JSON 调用示例
> - **[技术细节 (TECHNICAL_DETAILS.md)](./docs/TECHNICAL_DETAILS.md)** - 架构设计与实现细节
> - **[白名单配置 (WHITELIST.md)](./docs/WHITELIST.md)** - 消息过滤与白名单设置
>
> 参考文档：
> - NapCat 接口文档 (Apifox): https://napcat.apifox.cn/
> - OneBot 11 协议（常见实现兼容）：https://github.com/botuniverse/onebot-11

##  Logger

基于 `chalk` 的彩色日志，`.env` 支持 `LOG_LEVEL=debug|info|warn|error|silent`。

##  Quick Start

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件：

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

### 3. 启动适配器

**生产环境（纯净模式）**:

```bash
# 正向 WS 模式
npm start

# 反向 WS 模式
npm run start:reverse
```

**开发环境（测试模式）**:

```bash
# 包含所有测试命令
npm test
```

### 4. 测试功能（仅测试模式）

在 QQ 中发送测试命令（以 `#` 开头）：

```
#help - 查看所有测试命令
#ping - 测试连接
#text - 发送文本消息
#image - 发送图片
#groupinfo - 获取群信息
```

**注意**: 
- 生产环境 (`npm start`) 不包含任何硬编码响应，适合集成自定义插件
- 测试环境 (`npm test`) 包含测试命令，用于功能测试

详细使用说明: [快速开始](./QUICK_START.md) | [完整文档](./USAGE.md)

##  Directory Structure

- `src/types/onebot.ts` OneBot 11 类型定义
- `src/utils/message.ts` 消息段构建与转换
- `src/ws/OneBotWSClient.ts` WS 客户端（鉴权、重连、请求-响应、事件分发）
- `src/adapter/NapcatAdapter.ts` 适配器封装（高阶方法 + 通用调用）
- `src/logger.ts` 基于 chalk 的彩色日志
- `examples/basic.ts` 示例脚本

##  Example Usage

在 `.env` 配好 `NAPCAT_WS_URL` 和必要的 token 后：

```bash
npm run example
```

示例会：
- 连接 NapCat WS
- 监听 `message` 事件
- 如果设置了 `TEST_GROUP_ID`/`TEST_USER_ID`，发送一条群/私聊消息；设置 `TEST_REPLY_MSG_ID` 可演示引用回复
 

如需强类型与更完善的封装，可以在 `NapcatAdapter` 中逐步添加方法。也欢迎将你需要的动作列出来，我可以按文档一次性补全。

##  Reverse WebSocket（反向 WS）

让 NapCat 主动连接到我们：

1) 在 `.env` 设置：

```
REVERSE_PORT=6701
REVERSE_PATH=/onebot
NAPCAT_ACCESS_TOKEN=your_token_if_any
```

2) 运行示例：

```bash
npm run example:reverse
```

3) 在 NapCat WebUI → WebSocket 客户端（或相关入口）配置目标地址：

```
ws://<你的服务器IP或127.0.0.1>:6701/onebot?access_token=your_token_if_any
```

连接成功后，即可通过 `NapcatReverseAdapter` 的封装进行收发消息。

##  命令路由插件（Command Router）

提供简单前缀命令路由能力：

1) 可在 `.env` 设置命令前缀：

```
COMMAND_PREFIX=!
```

2) 运行命令示例：

```bash
npm run example:commands
```

3) 在代码中：

```ts
import { createCommandRouter } from './src';
const router = createCommandRouter({ prefix: process.env.COMMAND_PREFIX || '!' });
router.command('ping', async (ctx) => { await ctx.reply('pong'); });
adapter.use(router);
```

默认支持使用 `@机器人` 作为前缀（可关闭），示例内置 `!ping`、`!echo`、`!help`。

##  功能调用指南（API）

以下代码片段以仓库内导入为例：`import { ... } from '../src'`。
若作为依赖使用，请改为包名：`import { ... } from 'napcat-adapter'`。

### 发送消息（群/私聊）

```ts
import { segment } from '../src';

// 私聊
await adapter.sendPrivateMessage(2166683295, '你好');

// 群聊（支持数组形式的消息段）
await adapter.sendGroupMessage(987654321, [
  segment.text('Hello '),
  segment.image('https://example.com/pic.jpg'),
]);
```

### 引用回复（自动判断群/私聊）

```ts
// 在收到的事件 ev 上下文中直接回复
await adapter.sendReply(ev, '收到');

// 或显式指定
await adapter.sendPrivateReply(user_id, message_id, '私聊引用回复');
await adapter.sendGroupReply(group_id, message_id, '群聊引用回复');
```

### @相关

```ts
await adapter.sendGroupMessage(group_id, [segment.at(user_id), segment.text(' 你好！')]);
await adapter.sendGroupMessage(group_id, [segment.atAll(), segment.text(' 全体注意')]);
```

### 链式构建（MessageBuilder）

```ts
import { MessageBuilder } from '../src';

const msg = MessageBuilder
  .from('Hi ')
  .at(2166683295)
  .image('https://example.com/pic.jpg')
  .build();

await adapter.sendGroupMessage(987654321, msg);
```

### 合并转发（ForwardBuilder）

```ts
import { ForwardBuilder, segment } from '../src';

const nodes = new ForwardBuilder()
  .node([segment.text('来自 Alice 的消息')], 'Alice', '1001')
  .node([segment.text('来自 Bob 的消息')],   'Bob',   '1002')
  .build();

await adapter.sendGroupForwardMessage(987654321, nodes);
await adapter.sendPrivateForwardMessage(2166683295, nodes);
```

### 管理与请求（部分）

```ts
await adapter.setGroupWholeBan(group_id, true);         // 全员禁言
await adapter.setGroupBan(group_id, user_id, 600);      // 单人禁言 600 秒
await adapter.setGroupKick(group_id, user_id, true);    // 踢人并拒绝加群
await adapter.setGroupCard(group_id, user_id, '新名片');
await adapter.setGroupName(group_id, '新群名');
await adapter.setGroupLeave(group_id, false);           // 退群

// 请求处理
await adapter.setGroupAddRequest(flag, 'accept');
await adapter.setFriendAddRequest(flag, 'accept');
```

### 文件与媒体

```ts
// 上传群文件（Windows 注意本地路径）
await adapter.uploadGroupFile(group_id, 'C:\\path\\file.jpg', 'file.jpg');

// 获取图片 / OCR
await adapter.getImage('image_file_id_or_path');
await adapter.ocrImage('base64_or_path');
```

### 撤回 / 获取消息

```ts
const sent = await adapter.callOk('send_private_msg', { user_id, message: 'hi' });
const msgId = (sent.data as any).message_id;
await adapter.recallMessage(msgId);
const msg = await adapter.getMsg(msgId);
```

### 通用调用与重试

```ts
// 任意 OneBot/NapCat 动作
const res = await adapter.call('send_group_msg', { group_id, message: [segment.text('Hello')] });

// 严格校验/直接取 data
const okRes = await adapter.callOk('send_private_msg', { user_id, message: 'Hi' });
const data  = await adapter.callData('get_login_info');

// 带退避重试
const resRetry = await adapter.callRetry('send_group_msg', { group_id, message: 'Hi' }, {
  maxAttempts: 3, initialDelayMs: 500, backoffFactor: 2, jitterMs: 200,
});
```

### 事件辅助与快捷回复

```ts
// 仅群消息
const off1 = adapter.onGroupMessage(async (ev) => {
  if (adapter.isAtMe(ev)) await adapter.sendReply(ev, '收到 @ 我');
});

// 仅私聊
const off2 = adapter.onPrivateMessage(async (ev) => {
  if ((ev as any).raw_message?.includes('你好')) await adapter.sendReply(ev, '你好');
});
```

### 速率限制 / 去重（.env）

```
RATE_MAX_CONCURRENCY=5
RATE_MIN_INTERVAL_MS=200
DEDUP_EVENTS=true
DEDUP_TTL_MS=120000
```

### 日志与调试（紧凑彩色输出）

```ts
import { formatMessageCompact } from '../src';

adapter.on('message', (ev) => {
  if (process.env.LOG_LEVEL === 'debug') {
    log.debug(formatMessageCompact(ev as any, { plainMax: 80, withColor: true }));
  }
});
```

Windows 若颜色不生效，运行前设置：

```powershell
$env:FORCE_COLOR="1"
npm run example # 或 example:reverse
```

### 正向 / 反向模式说明

- 正向（`NapcatAdapter`）：我们作为客户端连接 NapCat 暴露的 WS。
- 反向（`NapcatReverseAdapter`）：我们启动反向 WS 服务端，NapCat 作为客户端主动连接。
  - `.env`：`REVERSE_PORT`、`REVERSE_PATH`、（可选）`NAPCAT_ACCESS_TOKEN`
  - NapCat 客户端 URL：`ws://127.0.0.1:REVERSE_PORT/REVERSE_PATH?access_token=...`

##  SDK 使用（fetch 风格）

框架提供了一个“调用即返回响应”的简洁 SDK 接口，默认读取 `.env` 并连接正向 WS。

```ts
import createSDK from 'napcat-adapter'; // 仓库内使用：import createSDK from '../src'

// 1) 正向 WS（默认从 .env 读取 NAPCAT_WS_URL 等）
const sdk = createSDK();

// 事件订阅（可取消订阅）
const off = sdk.on.message((ev) => {
  console.log('message event');
});

// 调用 OneBot 动作
await sdk('send_group_msg', { group_id: 123, message: [{ type: 'text', data: { text: 'Hello' } }] });

// 便捷方法
await sdk.actions.sendGroupMsg(123, [{ type: 'text', data: { text: 'Hello' } }]);

// 返回 data / 校验 ok / 带重试
const me = await sdk.data('get_login_info');
await sdk.ok('send_private_msg', { user_id: 456, message: 'Hi' });
await sdk.retry('send_group_msg', { group_id: 123, message: 'Hi' });

await sdk.dispose();
```

反向 WS 模式：

```ts
import createSDK from 'napcat-adapter';

const sdk = createSDK({ reverse: true, port: 5140, path: '/onebot', accessToken: process.env.NAPCAT_ACCESS_TOKEN });

sdk.on.message(async (ev) => {
  if (ev.post_type === 'message' && ev.message_type === 'private') {
    await sdk('send_private_msg', { user_id: ev.user_id, message: 'hello from reverse sdk' });
  }
});
```

### 日志控制开关

`.env` 中：

```
LOG_LEVEL=debug            # debug | info | warn | error | silent
EVENT_SUMMARY=debug        # always | debug | never
JSON_LOG=false             # true 输出 JSON 结构化日志
```

##  白名单过滤

支持设置群聊和私聊白名单，只处理指定群组或用户的消息，其他消息会被自动过滤。

### 配置方式

在 `.env` 中设置：

```bash
# 群聊白名单（逗号分隔，留空表示允许所有群）
WHITELIST_GROUPS=123456,789012,345678

# 私聊白名单（逗号分隔，留空表示允许所有用户）
WHITELIST_USERS=2166683295,1234567890

# 是否记录被过滤的消息（true/false）
LOG_FILTERED=true
```

### 代码示例

```ts
import { NapcatAdapter } from 'napcat-adapter';

const adapter = new NapcatAdapter({
  wsUrl: 'ws://127.0.0.1:6700',
  whitelistGroups: [123456, 789012],  // 只处理这两个群的消息
  whitelistUsers: [2166683295],       // 只处理这个用户的私聊
  logFiltered: true,                  // 记录被过滤的消息
});

adapter.on('message', async (ev) => {
  // 只有白名单内的消息才会到达这里
  console.log('收到消息:', ev.raw_message);
});
```

### 运行白名单示例

```bash
npm run example:whitelist
```

### 工作原理

- **群聊过滤**：如果设置了 `WHITELIST_GROUPS`，只有来自这些群的消息会被处理
- **私聊过滤**：如果设置了 `WHITELIST_USERS`，只有来自这些用户的私聊会被处理
- **空白名单**：如果白名单为空（未设置或空字符串），则允许所有消息通过
- **日志记录**：设置 `LOG_FILTERED=true` 可以在日志中看到被过滤的消息（用于调试）
- **其他事件**：白名单只过滤 `message` 事件，`notice`、`request`、`meta_event` 等事件不受影响

## 许可

MIT
