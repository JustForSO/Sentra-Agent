# 消息流 Summary 格式完整示例

本文档展示类似论坛风格的 `summary` 字段格式，包含描述性前缀和人性化表述。

---

## 1. 纯文本消息

### 私聊
```markdown
[2025/10/16 12:28:24] | 私聊 | 发送者: 之一一(QQ:2166683295)

说: 你好，最近怎么样？
```

### 群聊
```markdown
[2025/10/16 12:30:00] | 群聊 | 群名: Python学习群 | 群号: 123456789 | 发送者: 张三(小张)(QQ:987654321)

说: 大家好，请教一个问题
```

### 群主发言
```markdown
[2025/10/16 12:35:00] | 群聊 | 群名: Python学习群 | 群号: 123456789 | 发送者: 李四[群主](QQ:111222333)

说: 欢迎新成员加入
```

---

## 2. 图片消息

### 单张图片
```markdown
[2025/10/16 12:40:00] | 私聊 | 发送者: 之一一(QQ:2166683295)

发送了一张图片:
![photo.jpg](https://multimedia.nt.qq.com.cn/download?appid=1406&fileid=xxx?file=photo.jpg)
```

### 多张图片
```markdown
[2025/10/16 12:45:00] | 群聊 | 群名: 摄影群 | 群号: 987654321 | 发送者: 摄影师(QQ:123123123)

发送了3张图片:
![photo1.jpg](https://multimedia.nt.qq.com.cn/xxx?file=photo1.jpg)
![photo2.jpg](https://multimedia.nt.qq.com.cn/yyy?file=photo2.jpg)
![photo3.jpg](https://multimedia.nt.qq.com.cn/zzz?file=photo3.jpg)
```

### 文本+图片
```markdown
[2025/10/16 12:50:00] | 私聊 | 发送者: 之一一(QQ:2166683295)

说: 看这张图
发送了一张图片:
![screenshot.png](https://multimedia.nt.qq.com.cn/xxx?file=screenshot.png)
```

---

## 3. 语音消息

### 单条语音
```markdown
[2025/10/16 12:16:20] | 私聊 | 发送者: 之一一(QQ:2166683295)

发送了一条语音消息:
[语音: 69c8ae88f10f9f85503b02c0476b1afa.amr](C:\Users\1\Documents\Tencent Files\2857896171\nt_qq\nt_data\Ptt\2025-10\Ori\69c8ae88f10f9f85503b02c0476b1afa.amr) (2.3KB)
```

### 多条语音
```markdown
[2025/10/16 13:00:00] | 群聊 | 群名: 工作群 | 群号: 555666777 | 发送者: 同事(QQ:444555666)

发送了2条语音消息:
[语音: voice1.amr](C:\...\voice1.amr) (3.5KB)
[语音: voice2.amr](C:\...\voice2.amr) (5.2KB)
```

---

## 4. 文件消息

### 单个文件（私聊）
```markdown
[2025/10/16 12:47:49] | 私聊 | 发送者: 之一一(QQ:2166683295)

发送了一个文件:
[others_file_enui8yfl_1745670615173.xlsx](https://download.qq.com/ftn_handler/xxx) (5.5KB)
```

**说明**: 私聊文件通过 `get_file` API（使用 `file_id`）获取下载链接

### 单个文件（群聊）
```markdown
[2025/10/16 13:10:00] | 群聊 | 群名: 项目组 | 群号: 123456789 | 发送者: 同事(QQ:999888777)

说: 这是会议纪要
发送了一个文件:
[会议纪要2025.docx](https://download.qq.com/xxx) (245.8KB)
```

**说明**: 群聊文件通过 `get_group_file_url` API（使用 `group_id` + `file_id`）获取下载链接

### 多个文件
```markdown
[2025/10/16 13:15:00] | 群聊 | 群名: 项目组 | 群号: 555666777 | 发送者: 项目经理(QQ:222333444)

发送了3个文件:
[需求文档.pdf](https://download.qq.com/aaa?file=需求文档.pdf) (1.2MB)
[技术方案.docx](https://download.qq.com/bbb?file=技术方案.docx) (856.3KB)
[时间表.xlsx](https://download.qq.com/ccc?file=时间表.xlsx) (45.6KB)
```

---

## 5. 视频消息

### 单个视频
```markdown
[2025/10/16 13:20:00] | 群聊 | 群名: 旅游群 | 群号: 333444555 | 发送者: 旅行者(QQ:666777888)

说: 昨天拍的视频
发送了一个视频:
[视频: 旅行日记.mp4](https://multimedia.nt.qq.com.cn/xxx?file=旅行日记.mp4)
```

---

## 6. 回复消息

### 回复文本
```markdown
[2025/10/16 12:28:24] | 私聊 | 发送者: 之一一(QQ:2166683295)

> 回复 张三:
> 这个bug怎么解决？

说: 已经修复了，请更新代码
```

### 回复图片（你的实际例子）
```markdown
[2025/10/16 12:28:24] | 私聊 | 发送者: 之一一(QQ:2166683295)

> 回复 张三:
> [图片]
> ![FE861DCAA4F377713631CAE678228464.jpg](C:\Users\1\Documents\Tencent Files\2857896171\nt_qq\nt_data\Pic\2025-10\Ori\fe861dcaa4f377713631cae678228464.jpg)

说: 1255
```

### 回复多张图片
```markdown
[2025/10/16 13:30:00] | 群聊 | 群名: 摄影群 | 群号: 888999000 | 发送者: 摄影爱好者(QQ:333000333)

> 回复 李四:
> 这些照片不错
> ![photo1.jpg](C:\...\photo1.jpg)
> ![photo2.jpg](C:\...\photo2.jpg)

说: 谢谢，都是精心拍摄的
```

### 回复文件（你的实际例子）
```markdown
[2025/10/16 12:48:27] | 私聊 | 发送者: 之一一(QQ:2166683295)

> 回复 之一一:
> [文件]
> [others_file_enui8yfl_1745670615173.xlsx](https://download.qq.com/ftn_handler/xxx) (5.5KB)

说: 111
```

### 回复多个文件
```markdown
[2025/10/16 13:35:00] | 私聊 | 发送者: 同事(QQ:444000444)

> 回复 王五:
> 会议资料
> [会议纪要.pdf](https://download.qq.com/xxx) (245.8KB)
> [时间表.xlsx](https://download.qq.com/yyy) (56.3KB)

说: 已经下载了
```

### 回复语音
```markdown
[2025/10/16 13:40:00] | 私聊 | 发送者: 朋友(QQ:555000555)

> 回复 赵六:
> [语音]
> [语音: voice.amr](C:\Users\1\Documents\Tencent Files\...\voice.amr)

说: 听到了
```

---

## 7. @消息

### @单人
```markdown
[2025/10/16 13:45:00] | 群聊 | 群名: 工作群 | 群号: 444555666 | 发送者: 主管(QQ:444000444)

说: 请处理一下这个任务

@555666777
```

### @多人
```markdown
[2025/10/16 13:50:00] | 群聊 | 群名: 项目组 | 群号: 555666777 | 发送者: PM(QQ:555000555)

说: 请大家注意明天的会议

@111222333 @444555666 @777888999
```

### @全体成员
```markdown
[2025/10/16 13:55:00] | 群聊 | 群名: 公司群 | 群号: 999000111 | 发送者: HR[管理员](QQ:666000666)

说: 明天放假通知

@全体成员
```

---

## 8. 复杂组合消息

### 文本+图片+@
```markdown
[2025/10/16 14:00:00] | 群聊 | 群名: 活动群 | 群号: 222333444 | 发送者: 组织者[管理员](QQ:777000777)

说: 活动现场照片来了
发送了5张图片:
![活动1.jpg](https://multimedia.nt.qq.com.cn/aaa?file=活动1.jpg)
![活动2.jpg](https://multimedia.nt.qq.com.cn/bbb?file=活动2.jpg)
![活动3.jpg](https://multimedia.nt.qq.com.cn/ccc?file=活动3.jpg)
![活动4.jpg](https://multimedia.nt.qq.com.cn/ddd?file=活动4.jpg)
![活动5.jpg](https://multimedia.nt.qq.com.cn/eee?file=活动5.jpg)

@888999000 @111222333
```

### 回复+文本+文件
```markdown
[2025/10/16 14:05:00] | 群聊 | 群名: 文档共享群 | 群号: 666777888 | 发送者: 文档管理员(QQ:888000888)

> 回复 用户123:
> 需要上周的会议记录

说: 找到了，发你
发送了一个文件:
[上周会议记录.pdf](https://download.qq.com/xxx?file=上周会议记录.pdf) (1.8MB)
```

### 回复+图片
```markdown
[2025/10/16 14:10:00] | 私聊 | 发送者: 之一一(QQ:2166683295)

> 回复 设计师:
> 这个设计稿怎么样
> ![design.png](C:\...\design.png)

说: 不错，就用这个
发送了一张图片:
![revised_design.png](https://multimedia.nt.qq.com.cn/xxx?file=revised_design.png)
```

---

## 格式特点总结

### 描述性前缀
- **文本**: `说: xxx`
- **图片**: `发送了一张图片:` / `发送了X张图片:`
- **语音**: `发送了一条语音消息:` / `发送了X条语音消息:`
- **文件**: `发送了一个文件:` / `发送了X个文件:`
- **视频**: `发送了一个视频:` / `发送了X个视频:`

### 回复格式
- **显示人名**: `> 回复 张三:` （而不是消息ID）
- **保留原内容**: 引用的文本和媒体
- **使用 Markdown**: 图片 `![]()`、其他 `[]()`

### 媒体URL与API调用
- **图片/视频**: URL自动追加 `?file=文件名` 参数
- **语音**: 
  - 通过 `get_record` API（使用 `file` 参数）获取本地路径和文件大小
  - 优先显示完整本地路径
- **文件**: 
  - **私聊**: 通过 `get_file` API（使用 `file_id`）获取下载链接
  - **群聊**: 通过 `get_group_file_url` API（使用 `group_id` + `file_id` + `busid`）获取下载链接
  - 包含文件名、URL和大小
- **引用媒体**: 
  - 图片/语音使用本地路径（通过相应API获取）
  - 文件使用下载URL（通过相应API获取）

### 优势
✅ **人性化**: 类似论坛/IM平台的自然表述  
✅ **描述性**: 清晰的动作描述（"说"、"发送了"）  
✅ **可读性**: 人类易读，上下文清晰  
✅ **完整性**: QQ号、群号、发送者名字、媒体路径  
✅ **结构化**: 格式统一，易于机器学习解析  
✅ **Markdown标准**: 符合标准语法，易于渲染
