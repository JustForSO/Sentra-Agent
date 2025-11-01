# 消息流服务 (Message Stream)

消息流服务通过 WebSocket 实时推送格式化后的 QQ 消息，方便集成到外部应用中。

## 功能特性

- ✅ **实时推送**：所有接收到的消息立即通过 WebSocket 推送
- ✅ **详细信息**：包含时间、发送者、群组、引用消息、多媒体等完整信息
- ✅ **统一格式**：私聊和群聊统一的 JSON 结构，易于解析
- ✅ **引用消息**：自动获取被引用消息的详细内容和多媒体
- ✅ **多媒体支持**：图片、视频、文件、语音、转发消息等
- ✅ **群名称解析**：自动获取群名称（异步）
- ✅ **多客户端**：支持多个客户端同时连接
- ✅ **SDK RPC 调用**：通过消息流直接调用 SDK 的所有能力（invoke 与 sdk 两种方式）

## 快速开始

### 0. 选择连接模式（正向/反向）

在 `.env` 文件中设置连接模式，默认正向（forward）：

```env
# forward | reverse（优先读取 MODE，若未设置则读取 NAPCAT_MODE）
MODE=forward
# NAPCAT_MODE=reverse

# 正向模式所需：
NAPCAT_WS_URL=ws://127.0.0.1:6700

# 反向模式所需（NapCat 主动连接到我们）
REVERSE_PORT=6701
REVERSE_PATH=/onebot

# 可选：若 NapCat 配置了 AccessToken，则在此设置
NAPCAT_ACCESS_TOKEN=
```

应用启动时由 `src/config.ts` 中的 `loadConfig()` 读取上述配置，`MODE/NAPCAT_MODE` 会决定 SDK 使用正向适配器还是反向适配器。

### 1. 启用消息流服务

在 `.env` 文件中配置：

```env
# 启用消息流服务
ENABLE_STREAM=true

# 消息流服务监听端口（默认 6702）
STREAM_PORT=6702

# 是否包含原始事件数据（调试用，默认 false）
STREAM_INCLUDE_RAW=false
```

### 2. 启动主程序

```bash
npm run dev
```

启动成功后会看到：

```
✅ 已连接到 NapCat
✅ 消息流服务已启动 { port: 6702 }
```

## 消息构建指南（MessageInput / MessageSegment）

### MessageInput 类型

- 字符串：`"你好"`
- 段数组（OneBot 11 消息段）：`Array<{ type: string; data: any }>`

示例段（`src/utils/message.ts` 有辅助构造器 `segment.*`）：

```ts
// 纯文本
{ type: 'text', data: { text: '你好' } }

// @某人 / @全体
{ type: 'at', data: { qq: '2166683295' } }
{ type: 'at', data: { qq: 'all' } }

// 图片/语音/视频（file 可为本地路径或 NapCat 可识别的标识）
{ type: 'image', data: { file: 'C:/path/photo.jpg' } }
{ type: 'record', data: { file: 'C:/path/audio.amr' } }
{ type: 'video', data: { file: 'C:/path/video.mp4' } }

// 回复消息
{ type: 'reply', data: { id: 123456 } }

// 表情/JSON/XML
{ type: 'face', data: { id: 66 } }
{ type: 'json', data: { data: '{"app":"com.tencent..."}' } }
{ type: 'xml', data: { data: '<msg>...</msg>' } }
```

### 发送消息（本地 SDK）

```ts
// 纯文本
await sdk.send.group(123456789, '大家好');

// 复杂消息（含 @与图片）
await sdk.send.group(
  123456789,
  [
    { type: 'at', data: { qq: 'all' } },
    { type: 'text', data: { text: ' 请查看下列图片' } },
    { type: 'image', data: { file: 'C:/images/a.jpg' } },
  ]
);
```

### 发送消息（通过消息流 RPC）

```json
{ "type": "sdk", "path": "send.group", "args": [ 123456789, "大家好" ], "requestId": "sg-1" }
```

或使用段数组：

```json
{
  "type": "sdk",
  "path": "send.group",
  "args": [
    123456789,
    [
      { "type": "at", "data": { "qq": "all" } },
      { "type": "text", "data": { "text": " 请查看下列图片" } },
      { "type": "image", "data": { "file": "C:/images/a.jpg" } }
    ]
  ],
  "requestId": "sg-2"
}
```

### 3. 连接到消息流

使用任何 WebSocket 客户端连接到 `ws://localhost:6702`

#### Node.js 示例

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:6702');

ws.on('open', () => {
  console.log('已连接到消息流');
});

ws.on('message', (data) => {
  const payload = JSON.parse(data.toString());
  
  if (payload.type === 'message') {
    const msg = payload.data;
    // 方式1：使用 summary 字段（推荐）
    console.log(msg.summary);
    
    // 方式2：手动拼接
    // console.log(`收到消息: ${msg.sender_name}: ${msg.text}`);
  }
});
```

#### Python 示例

```python
import websocket
import json

def on_message(ws, message):
    payload = json.loads(message)
    
    if payload['type'] == 'message':
        msg = payload['data']
        # 方式1：使用 summary 字段（推荐）
        print(msg['summary'])
        
        # 方式2：手动拼接
        # print(f"收到消息: {msg['sender_name']}: {msg['text']}")

ws = websocket.WebSocketApp(
    "ws://localhost:6702",
    on_message=on_message
)

ws.run_forever()
```

#### 浏览器 JavaScript 示例

```javascript
const ws = new WebSocket('ws://localhost:6702');

ws.onopen = () => {
  console.log('已连接到消息流');
};

ws.onmessage = (event) => {
  const payload = JSON.parse(event.data);
  
  if (payload.type === 'message') {
    const msg = payload.data;
    // 方式1：使用 summary 字段（推荐）
    console.log(msg.summary);
    
    // 方式2：手动拼接
    // console.log(`收到消息: ${msg.sender_name}: ${msg.text}`);
  }
};
```

## 从零到一：完整流程

### 正向模式（Forward）

1. 配置 `.env`
   ```env
   MODE=forward
   NAPCAT_WS_URL=ws://127.0.0.1:6700
   ENABLE_STREAM=true
   STREAM_PORT=6702
   ```
2. 在 NapCat/OneBot 端确保 WebSocket Server 已开启（指向 `NAPCAT_WS_URL`）。
3. 启动本项目：
   ```bash
   npm run dev
   ```
4. 连接消息流：`ws://127.0.0.1:6702`
5. 可运行 `node 1.js` 进行快速验证（会打印 `result` 与推送 `message`）。

### 反向模式（Reverse）

1. 配置 `.env`
   ```env
   MODE=reverse
   ENABLE_STREAM=true
   STREAM_PORT=6702
   REVERSE_PORT=6701
   REVERSE_PATH=/onebot
   ```
2. 在 NapCat 端配置“反向 WS”，目标地址填写：`ws://<你的IP或localhost>:6701/onebot`
3. 启动本项目（脚本已内置 reverse）：
   ```bash
   npm run start
   ```
4. 连接消息流：`ws://127.0.0.1:6702`
5. 可运行 `node 1.js` 进行快速验证。

### 验证要点

- 日志应包含：`✅ 已连接到 NapCat`、`✅ 消息流服务已启动`。
- 客户端应收到：`welcome`、`pong`、`result`（RPC 响应，可选）、`message`（推送）。

## 消息摘要 (summary)

每条消息都包含一个 `summary` 字段，使用标准 Markdown 格式生成类似通讯平台的消息描述，包含完整详细信息（QQ号、群号、媒体路径等），便于人类阅读和机器学习。

### Summary 格式说明

基本结构（类似论坛风格）：
```
[时间] | 类型 | [群信息] | 发送者: 姓名(群名片)[角色](QQ:xxxxx)

说: 文本内容
发送了一张图片:
![filename](url)
```

#### 私聊文本消息
```markdown
[2025/10/16 09:25:35] | 私聊 | 发送者: 之一一(QQ:2166683295)

说: 你好啊
```

#### 群聊文本消息
```markdown
[2025/10/16 09:30:00] | 群聊 | 群名: 测试群 | 群号: 123456789 | 发送者: 之一一(小明)(QQ:2166683295)

说: 大家好
```

#### 群主/管理员消息
```markdown
[2025/10/16 09:30:00] | 群聊 | 群名: 测试群 | 群号: 123456789 | 发送者: 群主[群主](QQ:1234567)

说: 欢迎新成员
```

#### 图片消息
```markdown
[2025/10/16 10:00:00] | 私聊 | 发送者: 之一一(QQ:2166683295)

发送了一张图片:
![photo.jpg](https://multimedia.nt.qq.com.cn/download?appid=1406&fileid=xxx&rkey=xxx?file=photo.jpg)
```

**注意**：
- **图片/视频**: URL会自动追加 `?file=文件名` 参数
- **语音**: 优先使用本地路径（通过 `get_record` API 获取）
- **文件**: 私聊使用 `get_file` API，群聊使用 `get_group_file_url` API 获取下载链接

#### 多张图片
```markdown
[2025/10/16 10:00:00] | 群聊 | 群名: 测试群 | 群号: 123456789 | 发送者: 之一一(QQ:2166683295)

说: 看这些图
发送了3张图片:
![photo1.jpg](https://...?file=photo1.jpg)
![photo2.jpg](https://...?file=photo2.jpg)
![photo3.jpg](https://...?file=photo3.jpg)
```

#### 文件消息
```markdown
[2025/10/16 10:05:00] | 私聊 | 发送者: 之一一(QQ:2166683295)

说: 发你个文件
发送了一个文件:
[文档.pdf](https://...?file=文档.pdf) (1.5MB)
```

#### 引用消息（图片）
```markdown
[2025/10/16 12:28:24] | 私聊 | 发送者: 之一一(QQ:2166683295)

> 回复 张三:
> [图片]
> ![FE861DCAA4F377713631CAE678228464.jpg](C:\Users\1\Documents\Tencent Files\2857896171\nt_qq\nt_data\Pic\2025-10\Ori\fe861dcaa4f377713631cae678228464.jpg)

说: 1255
```

#### @消息
```markdown
[2025/10/16 10:10:00] | 群聊 | 群名: 测试群 | 群号: 123456789 | 发送者: 之一一(QQ:2166683295)

说: 快来看

@12345 @67890
```

#### 语音消息
```markdown
[2025/10/16 12:16:20] | 私聊 | 发送者: 之一一(QQ:2166683295)

发送了一条语音消息:
[语音: 69c8ae88f10f9f85503b02c0476b1afa.amr](C:\Users\1\Documents\Tencent Files\2857896171\nt_qq\nt_data\Ptt\2025-10\Ori\69c8ae88f10f9f85503b02c0476b1afa.amr) (2.3KB)
```

### Summary 的优势

✅ **结构化**：格式统一，便于解析和处理  
✅ **详细信息**：包含QQ号、群号、角色等完整信息  
✅ **标准 Markdown**：使用 `![]()`、`[]()`等标准语法  
✅ **机器学习友好**：格式固定，易于训练模型  
✅ **人类可读**：清晰的描述性文本  
✅ **易于存储**：纯文本，支持全文搜索  

## 消息格式

### 推送消息结构

所有推送的消息都包裹在一个 payload 对象中：

```typescript
{
  type: 'message' | 'welcome' | 'pong' | 'shutdown',
  data?: FormattedMessage,  // 仅当 type='message' 时存在
  message?: string,          // 仅当 type='welcome' 或 'shutdown' 时存在
  time?: number              // 时间戳
}
```

### FormattedMessage 结构

```typescript
interface FormattedMessage {
  // 基础信息
  message_id: number;           // 消息ID
  time: number;                 // 时间戳（秒）
  time_str: string;             // 格式化时间字符串 "2025-10-16 09:25:30"
  type: 'private' | 'group';    // 消息类型：私聊或群聊
  summary: string;              // 消息摘要（Markdown格式，包含时间、发送者、内容、多媒体）
  
  // 发送者信息
  sender_id: number;            // 发送者QQ号
  sender_name: string;          // 发送者昵称
  sender_card?: string;         // 群名片（仅群聊）
  sender_role?: 'owner' | 'admin' | 'member';  // 群角色（仅群聊）
  
  // 群组信息（仅群聊）
  group_id?: number;            // 群号
  group_name?: string;          // 群名称（异步获取）
  
  // 消息内容
  text: string;                 // 纯文本内容
  segments: Array<{             // 消息段数组（原始格式）
    type: string;
    data: any;
  }>;
  
  // 引用消息（如果有）
  reply?: {
    id: number;                 // 被引用的消息ID
    text: string;               // 被引用消息的文本
    media: {                    // 被引用消息的多媒体
      images: Array<{ file?: string; url?: string; size?: string | number; filename?: string }>;
      videos: Array<{ file?: string; url?: string; size?: string | number }>;
      files: Array<{ name?: string; url?: string; size?: string | number }>;
      records: Array<{ file?: string; format?: string }>;
      forwards: Array<{ id?: string | number; count?: number; preview?: string[] }>;
      faces: Array<{ id?: string; text?: string }>;
    };
  };
  
  // 多媒体（当前消息）
  images: Array<{ file?: string; url?: string }>;
  videos: Array<{ file?: string; url?: string }>;
  files: Array<{ name?: string; url?: string; size?: number | string }>;
  records: Array<{ file?: string; url?: string }>;
  
  // @提及
  at_users: number[];           // 被@的QQ号列表
  at_all: boolean;              // 是否@全体成员
  
  // 原始事件（可选，需要 STREAM_INCLUDE_RAW=true）
  raw?: any;
}
```

### 示例消息

#### 私聊文本消息

```json
{
  "type": "message",
  "data": {
    "message_id": 123456,
    "time": 1760580535,
    "time_str": "2025-10-16 09:25:35",
    "type": "private",
    "summary": "[2025/10/16 09:25:35] | 私聊 | 发送者: 之一一(QQ:2166683295)\n\n**消息内容:** 你好啊",
    "sender_id": 2166683295,
    "sender_name": "之一一",
    "text": "你好啊",
    "segments": [
      { "type": "text", "data": { "text": "你好啊" } }
    ],
    "images": [],
    "videos": [],
    "files": [],
    "records": [],
    "at_users": [],
    "at_all": false
  }
}
```

#### 群聊图片消息

```json
{
  "type": "message",
  "data": {
    "message_id": 789012,
    "time": 1760580600,
    "time_str": "2025-10-16 09:30:00",
    "type": "group",
    "summary": "[2025/10/16 09:30:00] | 群聊 | 群名: 测试群 | 群号: 123456789 | 发送者: 之一一(小明)(QQ:2166683295)\n\n**消息内容:** 看这张图\n\n**发送了1张图片:**\n- ![photo.jpg](https://multimedia.nt.qq.com.cn/...)",
    "sender_id": 2166683295,
    "sender_name": "之一一",
    "sender_card": "小明",
    "sender_role": "member",
    "group_id": 123456789,
    "group_name": "测试群",
    "text": "看这张图",
    "segments": [
      { "type": "text", "data": { "text": "看这张图" } },
      { "type": "image", "data": { "file": "xxx.jpg", "url": "https://..." } }
    ],
    "images": [
      {
        "file": "C:\\...\\photo.jpg",
        "url": "https://multimedia.nt.qq.com.cn/..."
      }
    ],
    "videos": [],
    "files": [],
    "records": [],
    "at_users": [],
    "at_all": false
  }
}
```

#### 引用消息

```json
{
  "type": "message",
  "data": {
    "message_id": 345678,
    "time": 1760580700,
    "time_str": "2025-10-16 09:31:40",
    "type": "group",
    "summary": "[2025/10/16 09:31:40] | 群聊 | 群名: 测试群 | 群号: 123456789 | 发送者: 之一一(QQ:2166683295)\n\n> 回复消息ID: 789012\n> 引用内容: 看这张图\n> 引用媒体: 1张图片\n\n**消息内容:** 收到",
    "sender_id": 2166683295,
    "sender_name": "之一一",
    "group_id": 123456789,
    "group_name": "测试群",
    "text": "收到",
    "reply": {
      "id": 789012,
      "text": "看这张图",
      "media": {
        "images": [
          {
            "file": "C:\\...\\photo.jpg",
            "url": "https://...",
            "size": "160170",
            "filename": "photo.jpg"
          }
        ],
        "videos": [],
        "files": [],
        "records": [],
        "forwards": [],
        "faces": []
      }
    },
    "segments": [
      { "type": "reply", "data": { "id": "789012" } },
      { "type": "text", "data": { "text": "收到" } }
    ],
    "images": [],
    "videos": [],
    "files": [],
    "records": [],
    "at_users": [],
    "at_all": false
  }
}
```

## 心跳机制

客户端可以定期发送心跳保持连接：

```javascript
// 发送心跳
ws.send(JSON.stringify({ type: 'ping' }));
```

示例（Node 客户端）：

```js
ws.send(JSON.stringify({ type: 'invoke', call: 'ok', action: 'get_login_info', params: {}, requestId: 'req-1' }));
```

### 2) sdk 路径调用

请求格式：

```json
{
  "type": "sdk",
  "path": "send.group",
  "args": [ 123456789, "你好，世界" ],
  "requestId": "req-2"
}
```

- **type**: 固定为 `sdk`
- **path**: SDK 方法路径（点号分隔）
- **args**: 按方法签名顺序传参
- **requestId**: 可选但推荐

响应格式与 `invoke` 相同（`type: 'result'`）。返回内容等同于被调用函数的返回值。

常用示例：

```js
// 读取信息
ws.send(JSON.stringify({ type: 'sdk', path: 'system.versionInfo', args: [], requestId: 'ver-1' }));
ws.send(JSON.stringify({ type: 'sdk', path: 'system.status', args: [], requestId: 'stat-1' }));

// 发送消息
ws.send(JSON.stringify({ type: 'sdk', path: 'send.private', args: [ 123456, '私聊测试' ], requestId: 'sp-1' }));
ws.send(JSON.stringify({ type: 'sdk', path: 'send.group', args: [ 987654321, '群聊测试' ], requestId: 'sg-1' }));

// 获取引用上下文（需要传入一条完整 OneBot 消息事件 JSON）
// const ev = ... // 从 message 推送拿到的 payload.data.raw 或按 OneBot 结构构造
// ws.send(JSON.stringify({ type: 'sdk', path: 'utils.getReplyContext', args: [ ev ], requestId: 'rc-1' }));
```

#### invoke 发送消息（OneBot 原始动作）

`send_group_msg` 参数：

```json
{
  "type": "invoke",
  "call": "ok",
  "action": "send_group_msg",
  "params": {
    "group_id": 123456789,
    "message": [
      { "type": "text", "data": { "text": "大家好" } },
      { "type": "image", "data": { "file": "C:/images/a.jpg" } }
    ]
  },
  "requestId": "ig-1"
}
```

`send_private_msg` 参数：

```json
{
  "type": "invoke",
  "call": "ok",
  "action": "send_private_msg",
  "params": { "user_id": 2166683295, "message": "你好" },
  "requestId": "ip-1"
}
```

> 提示：`call: 'data'` 会直接返回 `data` 字段；`call: 'retry'` 会在失败时进行退避重试。

### 可用 SDK 路径与参数（节选，均与 `src/sdk.ts` 一致）

- **send**
  - `send.private(user_id: number, message: MessageInput)`
  - `send.group(group_id: number, message: MessageInput)`
  - `send.reply(ev: MessageEvent, message: MessageInput)`
  - `send.privateReply(user_id: number, message_id: number, message: MessageInput)`
  - `send.groupReply(group_id: number, message_id: number, message: MessageInput)`
  - `send.forwardGroup(group_id: number, messages: any[])`
  - `send.forwardPrivate(user_id: number, messages: any[])`

  - `message.recall(message_id: number)`
  - `message.get(message_id: number)`
  - `message.getForward(id: string)`
  - `message.getGroupHistory(group_id: number, message_seq?: number, count?: number)`
  - `message.getFriendHistory(user_id: number, message_seq?: number, count?: number)`
  - `message.markAsRead(params: any)`
  - `message.markPrivateAsRead(params: any)`
  - `message.markGroupAsRead(params: any)`
  - `message.markAllAsRead()`
  - `message.recentContact(params?: any)`

- **group**
  - `group.list()`
  - `group.info(group_id: number, no_cache?: boolean)`
  - `group.memberList(group_id: number)`
  - `group.memberInfo(group_id: number, user_id: number, no_cache?: boolean)`
  - `group.wholeBan(group_id: number, enable?: boolean)`
  - `group.ban(group_id: number, user_id: number, duration: number)`
  - `group.kick(group_id: number, user_id: number, reject_add_request?: boolean)`
  - `group.setCard(group_id: number, user_id: number, card?: string)`
  - `group.setName(group_id: number, group_name: string)`
  - `group.leave(group_id: number, is_dismiss?: boolean)`

- **file**
  - `file.uploadGroup(group_id: number, file: string, name?: string, folder?: string)`
  - `file.uploadPrivate(user_id: number, file: string, name?: string)`
  - `file.getGroupRoot(group_id: number)`
  - `file.getGroupFolder(group_id: number, folder_id: string)`
  - `file.getGroupFileUrl(group_id: number, file_id: string, busid: number)`
  - `file.deleteGroupFile(group_id: number, file_id: string, busid: number)`
  - `file.deleteGroupFolder(group_id: number, folder_id: string)`
  - `file.createGroupFolder(group_id: number, name: string, parent_id?: string)`

- **user**
  - `user.info(user_id: number, no_cache?: boolean)`
  - `user.friendList()`
  - `user.sendLike(user_id: number, times?: number)`
  - `user.getFriendsWithCategory()`
  - `user.deleteFriend(user_id: number)`
  - `user.setFriendRemark(user_id: number, remark: string)`
  - `user.getProfileLike(params?: any)`
  - `user.fetchCustomFace()`
  - `user.getUnidirectionalFriendList()`

- **request**
  - `request.setGroupAdd(flag: string, sub_type: 'add' | 'invite', approve: boolean, reason?: string)`
  - `request.setFriendAdd(flag: string, approve: boolean, remark?: string)`
  - `request.getDoubtFriendsAddRequest()`
  - `request.setDoubtFriendsAddRequest(params: any)`

- **media**
  - `media.getImage(file: string)`
  - `media.ocrImage(image: string)`

- **system**
  - `system.loginInfo()`
  - `system.status()`
  - `system.versionInfo()`
  - `system.getOnlineClients()`
  - `system.setOnlineStatus(params: any)`
  - `system.setDiyOnlineStatus(params: any)`
  - `system.getUserStatus(user_id: number)`
  - `system.getModelShow()`
  - `system.setModelShow(params: any)`

- **account**
  - `account.setQQProfile(params: any)`
  - `account.setQQAvatar(params: any)`
  - `account.setSelfLongnick(longnick: string)`

- **ark**
  - `ark.sharePeer(params: any)`
  - `ark.shareGroup(params: any)`
  - `ark.getMiniAppArk(params: any)`

- **collection**
  - `collection.create(params: any)`

- **utils**
  - `utils.isAtMe(ev: MessageEvent)`
  - `utils.getPlainText(ev: MessageEvent)`
  - `utils.parseReply(ev: MessageEvent)`
  - `utils.getReplyContext(ev: MessageEvent)`

注意：`on.*`（事件订阅）适用于本地 SDK 使用，不建议通过 RPC 远程调用。

### 📖 完整调用示例

**所有方法的具体 JSON 示例请查看：[Stream RPC 完整调用示例](./STREAM_RPC_EXAMPLES.md)**

该文档包含每个 SDK 方法的：
- 实际可运行的 JSON 请求示例
- 参数说明与可选用法
- 不同场景的变体示例（如带图片的消息、禁言/解除禁言等）
- 响应格式说明

### 错误处理与返回规范

- 所有 RPC 响应为 `type: 'result'`；
- `ok: true` 时，`data` 为目标函数的返回值；
- `ok: false` 时，`error` 为错误消息（如权限不足、参数错误、NapCat 返回失败等）。

### 安全建议

- 当前消息流 RPC 默认不鉴权，建议仅在受信网络/本机使用；
- 若需对外暴露，建议加反向代理与网络 ACL（后续版本将支持 `STREAM_ACCESS_TOKEN` 认证）。

## SDK 调用（本地代码中直接控制消息流）
在代码中也可以直接操作消息流：

```typescript
import createSDK from './sdk';

const sdk = createSDK();

// 启动消息流
if (sdk.stream) {
  await sdk.stream.start();
  console.log('消息流已启动');
  
  // 获取连接数
  const count = sdk.stream.getClientCount();
  console.log(`当前连接数: ${count}`);
  
  // 获取实例（高级用法）
  const streamInstance = sdk.stream.getInstance();
  
  // 停止消息流
  await sdk.stream.stop();
}
```

## 运行示例客户端

项目包含一个完整的示例客户端：

```bash
# 启动主程序
npm run dev

# 在另一个终端运行示例客户端
npx tsx examples/stream-client.ts
```

示例客户端会：
- 连接到消息流服务
- 接收并美化打印所有消息
- 显示引用消息详情
- 显示多媒体信息
- 定期发送心跳

## 应用场景

- 🤖 **聊天机器人**：实时接收消息并响应
- 📊 **数据分析**：收集消息数据用于分析
- 💬 **消息转发**：转发消息到其他平台（如微信、钉钉等）
- 📱 **移动应用**：手机App接收QQ消息
- 🌐 **Web界面**：浏览器端实时显示消息
- 🔔 **通知系统**：重要消息推送到其他系统
- 💾 **消息归档**：保存消息到数据库
- 🎮 **游戏集成**：游戏内接收QQ群消息

## 注意事项

1. **性能**：消息流会实时推送所有消息，高流量群需注意客户端处理能力
2. **安全**：默认监听 localhost，如需外部访问请注意防火墙和访问控制
3. **断线重连**：客户端需自行实现断线重连逻辑
4. **数据量**：启用 `STREAM_INCLUDE_RAW=true` 会显著增加推送数据量
5. **群名称**：群名称异步获取，首次推送可能为空，后续会自动填充

## 故障排查

### 无法连接

- 检查 `.env` 中 `ENABLE_STREAM=true`
- 检查端口 `STREAM_PORT` 是否被占用
- 检查防火墙是否允许端口访问

### 收不到消息

- 检查主程序是否已连接到 NapCat
- 检查 `WHITELIST_GROUPS` 和 `WHITELIST_USERS` 配置
- 查看主程序日志是否有错误

### 推送延迟

- 检查网络连接质量
- 检查客户端处理速度
- 考虑使用消息队列缓冲

## 高级用法

### 自定义消息处理

可以直接访问 `MessageStream` 实例进行更高级的操作：

```typescript
const streamInstance = sdk.stream?.getInstance();

if (streamInstance) {
  // 手动推送自定义数据（需要实现扩展）
  // streamInstance.broadcast({ custom: 'data' });
  
  // 访问内部状态
  const clientCount = streamInstance.getClientCount();
}
```

### 多端口部署

可以在代码中创建多个 `MessageStream` 实例监听不同端口，用于不同的用途。

### 消息过滤

在客户端根据 `msg.type`、`msg.group_id`、`msg.sender_id` 等字段进行过滤，只处理需要的消息。

## 环境变量参考

- **MODE / NAPCAT_MODE**：`forward | reverse`（默认 `forward`）。决定正向/反向连接模式。
- **NAPCAT_WS_URL**：正向模式下 NapCat OneBot WS 地址（默认 `ws://127.0.0.1:6700`）。
- **NAPCAT_ACCESS_TOKEN**：若 NapCat 启用 AccessToken，在此填写。
- **RECONNECT**：正向模式下 SDK 自动重连（默认 `true`）。
- **RECONNECT_MIN_MS / RECONNECT_MAX_MS**：重连时间窗口（默认 `1000/15000`）。
- **REQUEST_TIMEOUT_MS**：请求超时时间（默认 `15000`）。
- **LOG_LEVEL**：日志级别（默认 `info`）。
- **AUTO_WAIT_OPEN**：发送前是否等待连接打开（默认 `true`）。
- **RATE_MAX_CONCURRENCY / RATE_MIN_INTERVAL_MS**：限速并发与最小间隔（默认 `5 / 200`）。
- **RETRY_MAX_ATTEMPTS / RETRY_INITIAL_DELAY_MS / RETRY_BACKOFF_FACTOR / RETRY_JITTER_MS**：`retry` 相关退避参数（默认 `3 / 500 / 2 / 200`）。
- **DEDUP_EVENTS / DEDUP_TTL_MS**：事件去重开关与 TTL（默认 `true / 120000ms`）。
- **EVENT_SUMMARY**：事件摘要日志：`always | debug | never`（默认 `debug`）。
- **JSON_LOG**：是否以 JSON 结构化日志输出（默认 `false`）。
- **WHITELIST_GROUPS / WHITELIST_USERS**：白名单，仅处理这些群/用户（逗号分隔 ID）。
- **LOG_FILTERED**：是否打印被过滤的事件（默认 `false`）。
- **REVERSE_PORT / REVERSE_PATH**：反向 WS 服务监听端口与路径（默认 `6701 / /onebot`）。
- **ENABLE_STREAM / STREAM_PORT / STREAM_INCLUDE_RAW**：启用流、端口、是否附带原始事件（默认 `false / 6702 / false`）。
- 其他：
  - **ENABLE_TEST_PLUGIN**：启用测试命令插件，支持 `#help`（在 `npm run start/dev` 中默认开启）。

## 相关链接

- [NapCat 文档](https://napcat.apifox.cn/)
- [OneBot 11 标准](https://github.com/botuniverse/onebot-11)
- [WebSocket 协议](https://developer.mozilla.org/zh-CN/docs/Web/API/WebSocket)
