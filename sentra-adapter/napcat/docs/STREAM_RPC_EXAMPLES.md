# Stream RPC 完整调用示例

以下为每个 SDK 方法的具体 WebSocket 调用示例（`type: 'sdk'`），可直接在客户端使用 `ws.send(JSON.stringify({...}))` 发送。

## send.* 发送消息

### send.private - 发送私聊消息
```json
{
  "type": "sdk",
  "path": "send.private",
  "args": [2166683295, "你好，这是一条私聊消息"],
  "requestId": "send-private-1"
}
```

发送带图片的私聊：
```json
{
  "type": "sdk",
  "path": "send.private",
  "args": [
    2166683295,
    [
      {"type": "text", "data": {"text": "看这张图"}},
      {"type": "image", "data": {"file": "C:/images/photo.jpg"}}
    ]
  ],
  "requestId": "send-private-2"
}
```

### send.group - 发送群消息
```json
{
  "type": "sdk",
  "path": "send.group",
  "args": [123456789, "大家好"],
  "requestId": "send-group-1"
}
```

发送带@和图片的群消息：
```json
{
  "type": "sdk",
  "path": "send.group",
  "args": [
    123456789,
    [
      {"type": "at", "data": {"qq": "all"}},
      {"type": "text", "data": {"text": " 请查看下列图片"}},
      {"type": "image", "data": {"file": "C:/images/a.jpg"}}
    ]
  ],
  "requestId": "send-group-2"
}
```

### send.reply - 回复消息（需要完整事件对象）
```json
{
  "type": "sdk",
  "path": "send.reply",
  "args": [
    {
      "message_type": "group",
      "group_id": 123456789,
      "message_id": 654321,
      "user_id": 2166683295,
      "message": [{"type": "text", "data": {"text": "原消息内容"}}]
    },
    "这是回复内容"
  ],
  "requestId": "send-reply-1"
}
```

### send.privateReply - 回复私聊消息
```json
{
  "type": "sdk",
  "path": "send.privateReply",
  "args": [2166683295, 654321, "回复你的私聊消息"],
  "requestId": "send-private-reply-1"
}
```

### send.groupReply - 回复群消息
```json
{
  "type": "sdk",
  "path": "send.groupReply",
  "args": [123456789, 654321, "回复群消息"],
  "requestId": "send-group-reply-1"
}
```

### send.forwardGroup - 转发消息到群
```json
{
  "type": "sdk",
  "path": "send.forwardGroup",
  "args": [
    123456789,
    [
      {
        "type": "node",
        "data": {
          "name": "消息发送者",
          "uin": "2166683295",
          "content": [{"type": "text", "data": {"text": "转发的消息1"}}]
        }
      },
      {
        "type": "node",
        "data": {
          "name": "另一个发送者",
          "uin": "1234567",
          "content": [{"type": "text", "data": {"text": "转发的消息2"}}]
        }
      }
    ]
  ],
  "requestId": "send-forward-group-1"
}
```

### send.forwardPrivate - 转发消息到私聊
```json
{
  "type": "sdk",
  "path": "send.forwardPrivate",
  "args": [
    2166683295,
    [
      {
        "type": "node",
        "data": {
          "name": "发送者",
          "uin": "1234567",
          "content": [{"type": "text", "data": {"text": "转发的消息"}}]
        }
      }
    ]
  ],
  "requestId": "send-forward-private-1"
}
```

## message.* 消息操作

### message.recall - 撤回消息
```json
{
  "type": "sdk",
  "path": "message.recall",
  "args": [654321],
  "requestId": "message-recall-1"
}
```

### message.get - 获取消息
```json
{
  "type": "sdk",
  "path": "message.get",
  "args": [654321],
  "requestId": "message-get-1"
}
```

### message.getForward - 获取转发消息
```json
{
  "type": "sdk",
  "path": "message.getForward",
  "args": ["forward_id_xxxxxxxxxxxx"],
  "requestId": "message-get-forward-1"
}
```

### message.getGroupHistory - 获取群历史消息
```json
{
  "type": "sdk",
  "path": "message.getGroupHistory",
  "args": [123456789, 0, 20],
  "requestId": "message-group-history-1"
}
```

从指定消息序号开始获取：
```json
{
  "type": "sdk",
  "path": "message.getGroupHistory",
  "args": [123456789, 12345, 50],
  "requestId": "message-group-history-2"
}
```

### message.getFriendHistory - 获取好友历史消息
```json
{
  "type": "sdk",
  "path": "message.getFriendHistory",
  "args": [2166683295, 0, 20],
  "requestId": "message-friend-history-1"
}
```

### message.markAsRead - 标记消息已读
```json
{
  "type": "sdk",
  "path": "message.markAsRead",
  "args": [{"message_id": 654321}],
  "requestId": "message-mark-read-1"
}
```

### message.markPrivateAsRead - 标记私聊消息已读
```json
{
  "type": "sdk",
  "path": "message.markPrivateAsRead",
  "args": [{"user_id": 2166683295}],
  "requestId": "message-mark-private-read-1"
}
```

### message.markGroupAsRead - 标记群消息已读
```json
{
  "type": "sdk",
  "path": "message.markGroupAsRead",
  "args": [{"group_id": 123456789}],
  "requestId": "message-mark-group-read-1"
}
```

### message.markAllAsRead - 标记所有消息已读
```json
{
  "type": "sdk",
  "path": "message.markAllAsRead",
  "args": [],
  "requestId": "message-mark-all-read-1"
}
```

### message.recentContact - 获取最近联系人
```json
{
  "type": "sdk",
  "path": "message.recentContact",
  "args": [],
  "requestId": "message-recent-contact-1"
}
```

## group.* 群组管理

### group.list - 获取群列表
```json
{
  "type": "sdk",
  "path": "group.list",
  "args": [],
  "requestId": "group-list-1"
}
```

### group.info - 获取群信息
```json
{
  "type": "sdk",
  "path": "group.info",
  "args": [123456789, false],
  "requestId": "group-info-1"
}
```

强制刷新缓存：
```json
{
  "type": "sdk",
  "path": "group.info",
  "args": [123456789, true],
  "requestId": "group-info-2"
}
```

### group.memberList - 获取群成员列表
```json
{
  "type": "sdk",
  "path": "group.memberList",
  "args": [123456789],
  "requestId": "group-member-list-1"
}
```

### group.memberInfo - 获取群成员信息
```json
{
  "type": "sdk",
  "path": "group.memberInfo",
  "args": [123456789, 2166683295, false],
  "requestId": "group-member-info-1"
}
```

### group.wholeBan - 全体禁言
```json
{
  "type": "sdk",
  "path": "group.wholeBan",
  "args": [123456789, true],
  "requestId": "group-whole-ban-1"
}
```

解除全体禁言：
```json
{
  "type": "sdk",
  "path": "group.wholeBan",
  "args": [123456789, false],
  "requestId": "group-whole-ban-2"
}
```

### group.ban - 禁言群成员
```json
{
  "type": "sdk",
  "path": "group.ban",
  "args": [123456789, 2166683295, 600],
  "requestId": "group-ban-1"
}
```

解除禁言（duration 为 0）：
```json
{
  "type": "sdk",
  "path": "group.ban",
  "args": [123456789, 2166683295, 0],
  "requestId": "group-ban-2"
}
```

### group.kick - 踢出群成员
```json
{
  "type": "sdk",
  "path": "group.kick",
  "args": [123456789, 2166683295, false],
  "requestId": "group-kick-1"
}
```

踢出并拒绝再次申请：
```json
{
  "type": "sdk",
  "path": "group.kick",
  "args": [123456789, 2166683295, true],
  "requestId": "group-kick-2"
}
```

### group.setCard - 设置群名片
```json
{
  "type": "sdk",
  "path": "group.setCard",
  "args": [123456789, 2166683295, "新的群名片"],
  "requestId": "group-set-card-1"
}
```

清空群名片：
```json
{
  "type": "sdk",
  "path": "group.setCard",
  "args": [123456789, 2166683295, ""],
  "requestId": "group-set-card-2"
}
```

### group.setName - 设置群名称
```json
{
  "type": "sdk",
  "path": "group.setName",
  "args": [123456789, "新的群名称"],
  "requestId": "group-set-name-1"
}
```

### group.leave - 退出群聊
```json
{
  "type": "sdk",
  "path": "group.leave",
  "args": [123456789, false],
  "requestId": "group-leave-1"
}
```

解散群聊（仅群主）：
```json
{
  "type": "sdk",
  "path": "group.leave",
  "args": [123456789, true],
  "requestId": "group-leave-2"
}
```

## file.* 文件操作

### file.uploadGroup - 上传群文件
```json
{
  "type": "sdk",
  "path": "file.uploadGroup",
  "args": [123456789, "C:/files/document.pdf", "文档.pdf", ""],
  "requestId": "file-upload-group-1"
}
```

上传到指定文件夹：
```json
{
  "type": "sdk",
  "path": "file.uploadGroup",
  "args": [123456789, "C:/files/image.jpg", "图片.jpg", "folder_id_xxx"],
  "requestId": "file-upload-group-2"
}
```

### file.uploadPrivate - 上传私聊文件
```json
{
  "type": "sdk",
  "path": "file.uploadPrivate",
  "args": [2166683295, "C:/files/document.pdf", "文档.pdf"],
  "requestId": "file-upload-private-1"
}
```

### file.getGroupRoot - 获取群根目录文件列表
```json
{
  "type": "sdk",
  "path": "file.getGroupRoot",
  "args": [123456789],
  "requestId": "file-get-group-root-1"
}
```

### file.getGroupFolder - 获取群文件夹内容
```json
{
  "type": "sdk",
  "path": "file.getGroupFolder",
  "args": [123456789, "folder_id_xxx"],
  "requestId": "file-get-group-folder-1"
}
```

### file.getGroupFileUrl - 获取群文件下载链接
```json
{
  "type": "sdk",
  "path": "file.getGroupFileUrl",
  "args": [123456789, "file_id_xxx", 102],
  "requestId": "file-get-group-file-url-1"
}
```

### file.deleteGroupFile - 删除群文件
```json
{
  "type": "sdk",
  "path": "file.deleteGroupFile",
  "args": [123456789, "file_id_xxx", 102],
  "requestId": "file-delete-group-file-1"
}
```

### file.deleteGroupFolder - 删除群文件夹
```json
{
  "type": "sdk",
  "path": "file.deleteGroupFolder",
  "args": [123456789, "folder_id_xxx"],
  "requestId": "file-delete-group-folder-1"
}
```

### file.createGroupFolder - 创建群文件夹
```json
{
  "type": "sdk",
  "path": "file.createGroupFolder",
  "args": [123456789, "新文件夹", ""],
  "requestId": "file-create-group-folder-1"
}
```

在指定父文件夹下创建：
```json
{
  "type": "sdk",
  "path": "file.createGroupFolder",
  "args": [123456789, "子文件夹", "parent_folder_id_xxx"],
  "requestId": "file-create-group-folder-2"
}
```

## user.* 用户信息

### user.info - 获取用户信息
```json
{
  "type": "sdk",
  "path": "user.info",
  "args": [2166683295, false],
  "requestId": "user-info-1"
}
```

### user.friendList - 获取好友列表
```json
{
  "type": "sdk",
  "path": "user.friendList",
  "args": [],
  "requestId": "user-friend-list-1"
}
```

### user.sendLike - 点赞
```json
{
  "type": "sdk",
  "path": "user.sendLike",
  "args": [2166683295, 10],
  "requestId": "user-send-like-1"
}
```

### user.getFriendsWithCategory - 获取带分组的好友列表
```json
{
  "type": "sdk",
  "path": "user.getFriendsWithCategory",
  "args": [],
  "requestId": "user-friends-category-1"
}
```

### user.deleteFriend - 删除好友
```json
{
  "type": "sdk",
  "path": "user.deleteFriend",
  "args": [2166683295],
  "requestId": "user-delete-friend-1"
}
```

### user.setFriendRemark - 设置好友备注
```json
{
  "type": "sdk",
  "path": "user.setFriendRemark",
  "args": [2166683295, "新备注名"],
  "requestId": "user-set-remark-1"
}
```

### user.getProfileLike - 获取点赞列表
```json
{
  "type": "sdk",
  "path": "user.getProfileLike",
  "args": [],
  "requestId": "user-profile-like-1"
}
```

### user.fetchCustomFace - 获取收藏表情
```json
{
  "type": "sdk",
  "path": "user.fetchCustomFace",
  "args": [],
  "requestId": "user-custom-face-1"
}
```

### user.getUnidirectionalFriendList - 获取单向好友列表
```json
{
  "type": "sdk",
  "path": "user.getUnidirectionalFriendList",
  "args": [],
  "requestId": "user-unidirectional-1"
}
```

## request.* 请求处理

### request.setGroupAdd - 处理加群请求
```json
{
  "type": "sdk",
  "path": "request.setGroupAdd",
  "args": ["flag_xxxxxxxxxxxx", "invite", true, "欢迎加入"],
  "requestId": "request-group-add-1"
}
```

拒绝加群：
```json
{
  "type": "sdk",
  "path": "request.setGroupAdd",
  "args": ["flag_xxxxxxxxxxxx", "add", false, "拒绝理由"],
  "requestId": "request-group-add-2"
}
```

### request.setFriendAdd - 处理加好友请求
```json
{
  "type": "sdk",
  "path": "request.setFriendAdd",
  "args": ["flag_xxxxxxxxxxxx", true, "同意备注"],
  "requestId": "request-friend-add-1"
}
```

拒绝好友请求：
```json
{
  "type": "sdk",
  "path": "request.setFriendAdd",
  "args": ["flag_xxxxxxxxxxxx", false, ""],
  "requestId": "request-friend-add-2"
}
```

### request.getDoubtFriendsAddRequest - 获取可疑好友申请
```json
{
  "type": "sdk",
  "path": "request.getDoubtFriendsAddRequest",
  "args": [],
  "requestId": "request-doubt-friends-1"
}
```

### request.setDoubtFriendsAddRequest - 处理可疑好友申请
```json
{
  "type": "sdk",
  "path": "request.setDoubtFriendsAddRequest",
  "args": [{"doubt_user_id": 2166683295, "approve": true}],
  "requestId": "request-doubt-friends-set-1"
}
```

## media.* 媒体操作

### media.getImage - 获取图片信息
```json
{
  "type": "sdk",
  "path": "media.getImage",
  "args": ["FE861DCAA4F377713631CAE678228464.jpg"],
  "requestId": "media-get-image-1"
}
```

### media.ocrImage - 图片OCR识别
```json
{
  "type": "sdk",
  "path": "media.ocrImage",
  "args": ["FE861DCAA4F377713631CAE678228464.jpg"],
  "requestId": "media-ocr-image-1"
}
```

## system.* 系统信息

### system.loginInfo - 获取登录信息
```json
{
  "type": "sdk",
  "path": "system.loginInfo",
  "args": [],
  "requestId": "system-login-info-1"
}
```

### system.status - 获取状态
```json
{
  "type": "sdk",
  "path": "system.status",
  "args": [],
  "requestId": "system-status-1"
}
```

### system.versionInfo - 获取版本信息
```json
{
  "type": "sdk",
  "path": "system.versionInfo",
  "args": [],
  "requestId": "system-version-1"
}
```

### system.getOnlineClients - 获取在线客户端
```json
{
  "type": "sdk",
  "path": "system.getOnlineClients",
  "args": [],
  "requestId": "system-online-clients-1"
}
```

### system.setOnlineStatus - 设置在线状态
```json
{
  "type": "sdk",
  "path": "system.setOnlineStatus",
  "args": [{"status": 11, "ext_status": 0, "battery_status": 0}],
  "requestId": "system-set-status-1"
}
```

### system.setDiyOnlineStatus - 设置自定义在线状态
```json
{
  "type": "sdk",
  "path": "system.setDiyOnlineStatus",
  "args": [{"status": "正在学习", "wording": "学习使我快乐"}],
  "requestId": "system-set-diy-status-1"
}
```

### system.getUserStatus - 获取用户状态
```json
{
  "type": "sdk",
  "path": "system.getUserStatus",
  "args": [2166683295],
  "requestId": "system-user-status-1"
}
```

### system.getModelShow - 获取机型
```json
{
  "type": "sdk",
  "path": "system.getModelShow",
  "args": [],
  "requestId": "system-model-show-1"
}
```

### system.setModelShow - 设置机型
```json
{
  "type": "sdk",
  "path": "system.setModelShow",
  "args": [{"model": "iPhone 15 Pro Max", "model_show": "iPhone 15 Pro Max"}],
  "requestId": "system-set-model-1"
}
```

## account.* 账号设置

### account.setQQProfile - 设置QQ资料
```json
{
  "type": "sdk",
  "path": "account.setQQProfile",
  "args": [{"nickname": "新昵称", "company": "公司名", "email": "email@example.com"}],
  "requestId": "account-set-profile-1"
}
```

### account.setQQAvatar - 设置头像
```json
{
  "type": "sdk",
  "path": "account.setQQAvatar",
  "args": [{"file": "C:/images/avatar.jpg"}],
  "requestId": "account-set-avatar-1"
}
```

### account.setSelfLongnick - 设置个性签名
```json
{
  "type": "sdk",
  "path": "account.setSelfLongnick",
  "args": ["这是我的个性签名"],
  "requestId": "account-set-longnick-1"
}
```

## ark.* 卡片/小程序

### ark.sharePeer - 分享卡片到私聊
```json
{
  "type": "sdk",
  "path": "ark.sharePeer",
  "args": [{"user_id": 2166683295, "ark_data": "{...}"}],
  "requestId": "ark-share-peer-1"
}
```

### ark.shareGroup - 分享卡片到群
```json
{
  "type": "sdk",
  "path": "ark.shareGroup",
  "args": [{"group_id": 123456789, "ark_data": "{...}"}],
  "requestId": "ark-share-group-1"
}
```

### ark.getMiniAppArk - 获取小程序卡片
```json
{
  "type": "sdk",
  "path": "ark.getMiniAppArk",
  "args": [{"app_id": "123456", "path": "/pages/index"}],
  "requestId": "ark-mini-app-1"
}
```

## collection.* 收藏

### collection.create - 创建收藏
```json
{
  "type": "sdk",
  "path": "collection.create",
  "args": [{"raw_data": "收藏内容", "brief": "收藏简介"}],
  "requestId": "collection-create-1"
}
```

## utils.* 工具方法

### utils.getReplyContext - 获取引用消息上下文
```json
{
  "type": "sdk",
  "path": "utils.getReplyContext",
  "args": [
    {
      "message_type": "group",
      "group_id": 123456789,
      "message_id": 654321,
      "user_id": 2166683295,
      "message": [
        {"type": "reply", "data": {"id": "123456"}},
        {"type": "text", "data": {"text": "回复内容"}}
      ]
    }
  ],
  "requestId": "utils-reply-context-1"
}
```

> **注意**：`utils.isAtMe`, `utils.getPlainText`, `utils.parseReply` 需要传入完整的 MessageEvent 对象，建议开启 `STREAM_INCLUDE_RAW=true` 后使用推送中的 `payload.data.raw`。

## 使用建议

1. **requestId**: 建议每个请求都带上唯一的 requestId，方便追踪响应
2. **参数顺序**: args 数组中的参数必须严格按照方法签名顺序传递
3. **可选参数**: 可选参数可以用 `null` 或省略（取决于参数位置）
4. **文件路径**: 上传文件时路径必须是 NapCat 进程可访问的本地绝对路径
5. **flag**: 处理请求时的 flag 来自于 request 事件推送
6. **事件对象**: 某些方法（如 send.reply, utils.*）需要完整的 OneBot 事件对象

## 响应格式

所有调用统一返回：
```json
{
  "type": "result",
  "requestId": "your-request-id",
  "ok": true,
  "data": { ... }
}
```

失败时：
```json
{
  "type": "result",
  "requestId": "your-request-id",
  "ok": false,
  "error": "错误信息"
}
```
