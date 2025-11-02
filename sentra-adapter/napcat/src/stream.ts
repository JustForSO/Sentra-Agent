import { WebSocketServer, WebSocket } from 'ws';
import type { MessageEvent } from './types/onebot';
import type { SdkInvoke } from './sdk';
import { createLogger } from './logger';

const log = createLogger('info');

/**
 * 格式化的消息结构
 */
export interface FormattedMessage {
  /** 消息ID */
  message_id: number;
  /** 时间戳（秒） */
  time: number;
  /** 时间字符串 */
  time_str: string;
  /** 消息类型：private私聊 | group群聊 */
  type: 'private' | 'group';
  self_id?: number;
  /** 消息摘要（Markdown格式，可视化描述，包含 message_id） */
  summary: string;
  /** 发送者QQ号 */
  sender_id: number;
  /** 发送者昵称 */
  sender_name: string;
  /** 发送者群名片（仅群聊） */
  sender_card?: string;
  /** 发送者群角色：owner群主 | admin管理员 | member普通成员（仅群聊） */
  sender_role?: 'owner' | 'admin' | 'member';
  /** 群号（仅群聊） */
  group_id?: number;
  /** 群名称（仅群聊，需异步获取） */
  group_name?: string;
  /** 纯文本内容 */
  text: string;
  /** 消息段数组 */
  segments: Array<{
    type: string;
    data: any;
  }>;
  /** 引用消息详情（如果有） */
  reply?: {
    /** 被引用的消息ID */
    id: number;
    /** 被引用的消息文本 */
    text: string;
    /** 被引用消息的发送者名字 */
    sender_name?: string;
    /** 被引用消息的发送者QQ号 */
    sender_id?: number;
    /** 被引用消息的多媒体 */
    media: {
      images: Array<{ file?: string; url?: string; size?: string | number; filename?: string }>;
      videos: Array<{ file?: string; url?: string; size?: string | number }>;
      files: Array<{ name?: string; url?: string; size?: string | number }>;
      records: Array<{ file?: string; format?: string }>;
      forwards: Array<{ id?: string | number; count?: number; preview?: string[] }>;
      faces: Array<{ id?: string; text?: string }>;
    };
  };
  /** 图片列表 */
  images: Array<{ file?: string; url?: string; path?: string }>;
  /** 视频列表 */
  videos: Array<{ file?: string; url?: string }>;
  /** 文件列表 */
  files: Array<{ name?: string; url?: string; size?: number | string; file_id?: string }>;
  /** 语音列表 */
  records: Array<{ file?: string; url?: string; path?: string; file_size?: string | number }>;
  /** at列表 */
  at_users: number[];
  /** 是否at全体 */
  at_all: boolean;
  /** 原始事件（可选，调试用） */
  raw?: any;
}

/**
 * 消息流服务
 * 通过WebSocket实时推送格式化后的消息给外部应用
 */
export class MessageStream {
  private wss?: WebSocketServer;
  private clients = new Set<WebSocket>();
  private port: number;
  private includeRaw: boolean;
  private getGroupNameFn?: (groupId: number) => Promise<string | undefined>;
  private invoker?: SdkInvoke;

  constructor(options: {
    /** WebSocket服务器端口 */
    port: number;
    /** 是否在推送中包含原始事件数据（调试用） */
    includeRaw?: boolean;
  }) {
    this.port = options.port;
    this.includeRaw = options.includeRaw ?? false;
  }

  /**
   * 设置获取群名称的函数
   * 由于群名称需要异步查询，外部提供此函数
   */
  setGroupNameResolver(fn: (groupId: number) => Promise<string | undefined>) {
    this.getGroupNameFn = fn;
  }

  setInvoker(fn: SdkInvoke) {
    this.invoker = fn;
  }

  /**
   * 启动WebSocket服务器
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ 
          port: this.port,
          host: '0.0.0.0'
        });

        this.wss.on('listening', () => {
          const addr = this.wss?.address();
          const host = (addr && typeof addr === 'object') ? addr.address : '0.0.0.0';
          const port = (addr && typeof addr === 'object') ? addr.port : this.port;
          log.info(`消息流服务已启动，监听: ws://${host}:${port}`);
          resolve();
        });

        this.wss.on('error', (err) => {
          log.error({ err }, '消息流服务错误');
          reject(err);
        });

        this.wss.on('connection', (ws, req) => {
          const ip = req.socket.remoteAddress;
          log.info({ ip }, '新客户端连接');
          this.clients.add(ws);

          // 发送欢迎消息
          ws.send(JSON.stringify({
            type: 'welcome',
            message: 'NapCat消息流服务',
            time: Date.now(),
          }));

          ws.on('close', () => {
            log.info({ ip }, '客户端断开连接');
            this.clients.delete(ws);
          });

          ws.on('error', (err) => {
            log.error({ err, ip }, '客户端连接错误');
            this.clients.delete(ws);
          });

          // 处理客户端消息（可选，用于心跳等）
          ws.on('message', async (data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
                return;
              }
              if (msg.type === 'invoke' && this.invoker) {
                const reqId = msg.requestId ?? msg.reqId ?? msg.id;
                const call = String(msg.call || 'call');
                const action = msg.action;
                const params = msg.params;
                try {
                  let result: any;
                  if (call === 'data') result = await this.invoker.data(action, params);
                  else if (call === 'ok') result = await this.invoker.ok(action, params);
                  else if (call === 'retry') result = await this.invoker.retry(action, params);
                  else result = await this.invoker(action, params);
                  ws.send(JSON.stringify({ type: 'result', requestId: reqId, ok: true, data: result }));
                } catch (e: any) {
                  ws.send(JSON.stringify({ type: 'result', requestId: reqId, ok: false, error: e?.message || String(e) }));
                }
                return;
              }
              if (msg.type === 'sdk' && this.invoker) {
                const reqId = msg.requestId ?? msg.reqId ?? msg.id;
                const path = String(msg.path || '');
                const args = Array.isArray(msg.args) ? msg.args : [];
                try {
                  let target: any = this.invoker as any;
                  for (const key of path.split('.').filter(Boolean)) {
                    target = target?.[key];
                  }
                  if (typeof target !== 'function') throw new Error('invalid_path');
                  const result = await target(...args);
                  ws.send(JSON.stringify({ type: 'result', requestId: reqId, ok: true, data: result }));
                } catch (e: any) {
                  ws.send(JSON.stringify({ type: 'result', requestId: reqId, ok: false, error: e?.message || String(e) }));
                }
                return;
              }
            } catch {
            }
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 停止WebSocket服务器
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }

      // 关闭所有客户端连接
      for (const client of this.clients) {
        try {
          client.send(JSON.stringify({ type: 'shutdown', message: '服务器关闭' }));
          client.close();
        } catch {
          // 忽略
        }
      }
      this.clients.clear();

      this.wss.close(() => {
        log.info('消息流服务已停止');
        resolve();
      });
    });
  }

  /**
   * 推送格式化消息到所有已连接的客户端
   */
  async push(ev: MessageEvent, replyContext?: any) {
    if (this.clients.size === 0) return;

    try {
      const formatted = await this.formatMessage(ev, replyContext);
      const payload = JSON.stringify({
        type: 'message',
        data: formatted,
      });

      // 广播给所有客户端
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(payload);
          } catch (err) {
            log.error({ err }, '推送消息失败');
          }
        }
      }
    } catch (err) {
      log.error({ err }, '格式化消息失败');
    }
  }

  /**
   * 将OneBot消息事件格式化为统一结构
   */
  private async formatMessage(ev: MessageEvent, replyContext?: any): Promise<FormattedMessage> {
    const time = ev.time ?? Math.floor(Date.now() / 1000);
    const timeStr = new Date(time * 1000).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    // 提取纯文本
    const text = ev.message
      .filter((seg) => seg.type === 'text')
      .map((seg) => String(seg.data?.text ?? ''))
      .join('');

    // 提取多媒体
    const images: any[] = [];
    const videos: any[] = [];
    const files: any[] = [];
    const records: any[] = [];
    const atUsers: number[] = [];
    let atAll = false;

    for (const seg of ev.message) {
      if (seg.type === 'image') {
        images.push({ file: seg.data?.file, url: seg.data?.url, path: seg.data?.cache_path || seg.data?.path });
      } else if (seg.type === 'video') {
        videos.push({ file: seg.data?.file, url: seg.data?.url });
      } else if (seg.type === 'file') {
        files.push({ 
          name: seg.data?.file || seg.data?.name, 
          file_id: seg.data?.file_id,
          size: seg.data?.file_size || seg.data?.size,
          url: seg.data?.url 
        });
      } else if (seg.type === 'record') {
        records.push({ 
          file: seg.data?.file, 
          url: seg.data?.url,
          path: seg.data?.path,
          file_size: seg.data?.file_size
        });
      } else if (seg.type === 'at') {
        const qq = seg.data?.qq;
        if (qq === 'all') {
          atAll = true;
        } else if (qq) {
          atUsers.push(Number(qq));
        }
      }
    }

    // 基础消息结构
    const formatted: FormattedMessage = {
      message_id: ev.message_id,
      time,
      time_str: timeStr,
      type: ev.message_type,
      self_id: (ev as any).self_id,
      summary: '', // 稍后生成
      sender_id: ev.user_id ?? 0,
      sender_name: ev.sender?.nickname || String(ev.user_id ?? 0),
      text,
      segments: ev.message.map((seg) => ({ type: seg.type, data: seg.data })),
      images,
      videos,
      files,
      records,
      at_users: atUsers,
      at_all: atAll,
    };

    // 群聊特有字段
    if (ev.message_type === 'group' && ev.group_id) {
      formatted.group_id = ev.group_id;
      formatted.sender_card = ev.sender?.card;
      formatted.sender_role = ev.sender?.role as any;

      // 尝试获取群名称
      if (this.getGroupNameFn) {
        try {
          formatted.group_name = await this.getGroupNameFn(ev.group_id);
        } catch {
          // 忽略
        }
      }
    }

    // 引用消息
    if (replyContext?.reply) {
      formatted.reply = {
        id: replyContext.reply.id,
        text: replyContext.referredPlain || '',
        sender_name: replyContext.referred?.sender?.nickname || replyContext.referred?.sender?.card,
        sender_id: replyContext.referred?.user_id || replyContext.referred?.sender?.user_id,
        media: replyContext.media || {
          images: [],
          videos: [],
          files: [],
          records: [],
          forwards: [],
          faces: [],
        },
      };
    }

    // 是否包含原始事件
    if (this.includeRaw) {
      formatted.raw = ev;
    }

    // 生成消息摘要（Markdown格式）
    formatted.summary = await this.generateSummary(formatted);

    return formatted;
  }

  /**
   * 获取当前连接的客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 生成消息摘要（Markdown格式）
   * 包含时间、消息ID、会话ID、发送者、内容、多媒体等信息
   * 格式类似通讯平台，便于人类理解和机器学习
   */
  private async generateSummary(msg: FormattedMessage): Promise<string> {
    const lines: string[] = [];

    // 1. 消息头部：时间 | 消息ID | 会话ID | 类型 | 发送者信息
    // 高优先级展示 message_id 与 会话ID，便于外部检索、去重与精准定位
    // 会话ID规则：群聊 = G:<group_id>，私聊 = U:<sender_id>
    const typeText = msg.type === 'group' ? '群聊' : '私聊';
    const convText = msg.type === 'group'
      ? `会话: G:${msg.group_id || '未知'}`
      : `会话: U:${msg.sender_id}`;
    let headerParts = [`[${msg.time_str}]`, `消息ID: ${msg.message_id}`, convText, typeText];
    
    // 群组信息
    if (msg.type === 'group') {
      if (msg.group_name) {
        headerParts.push(`群名: ${msg.group_name}`);
      }
      headerParts.push(`群号: ${msg.group_id || '未知'}`);
    }
    
    // 发送者信息
    let senderInfo = `${msg.sender_name}`;
    if (msg.sender_card) {
      senderInfo += `(${msg.sender_card})`;
    }
    if (msg.sender_role === 'owner') {
      senderInfo += '[群主]';
    } else if (msg.sender_role === 'admin') {
      senderInfo += '[管理员]';
    }
    senderInfo += `(QQ:${msg.sender_id})`;
    headerParts.push(`发送者: ${senderInfo}`);
    
    lines.push(headerParts.join(' | '));

    const replyLines: string[] = [];
    let consumedTextInMention = false;

    if (msg.type === 'group') {
      if (msg.at_all) {
        lines.push('');
        lines.push('在群内艾特了全体成员');
      } else if (msg.at_users.length > 0) {
        const selfId = msg.self_id;
        const selfAt = typeof selfId === 'number' && msg.at_users.includes(selfId);
        const otherIds = msg.at_users.filter((u) => u !== selfId);
        let selfDisplay = '';
        let otherDetails: string[] = [];
        if (this.invoker) {
          try {
            if (selfAt && msg.group_id && typeof selfId === 'number') {
              try {
                const info: any = await this.invoker.data('get_group_member_info', { group_id: msg.group_id, user_id: selfId });
                const nick = info?.nickname;
                const card = info?.card;
                const role = info?.role;
                let name = nick || String(selfId);
                if (card && card !== nick) name += `(${card})`;
                if (role === 'owner') name += '[群主]'; else if (role === 'admin') name += '[管理员]';
                selfDisplay = `${name}(QQ:${selfId})`;
              } catch {}
            }
            if (otherIds.length > 0 && msg.group_id) {
              const tasks = otherIds.map(async (uid) => {
                try {
                  const info: any = await this.invoker!.data('get_group_member_info', { group_id: msg.group_id!, user_id: uid });
                  const nick = info?.nickname;
                  const card = info?.card;
                  const role = info?.role;
                  let name = nick || String(uid);
                  if (card && card !== nick) name += `(${card})`;
                  if (role === 'owner') name += '[群主]'; else if (role === 'admin') name += '[管理员]';
                  return `${name}(QQ:${uid})`;
                } catch {
                  return String(uid);
                }
              });
              otherDetails = await Promise.all(tasks);
            }
          } catch {}
        }
        if (selfAt) {
          const selfText = selfDisplay || (typeof selfId === 'number' ? `QQ:${selfId}` : '你');
          let line = `在群内艾特了你${selfText}`;
          if (msg.text) {
            line += `，说: ${msg.text}`;
            consumedTextInMention = true;
          }
          if (otherIds.length > 0) {
            const out = otherDetails.length > 0 ? otherDetails.join('、') : otherIds.map((u) => String(u)).join('、');
            line += `，然后又艾特了: ${out}`;
          }
          lines.push('');
          lines.push(line);
        } else {
          const allIds = msg.at_users;
          let atDetails: string[] = [];
          if (this.invoker) {
            try {
              const tasks = allIds.map(async (uid) => {
                try {
                  const info: any = await this.invoker!.data('get_group_member_info', { group_id: msg.group_id!, user_id: uid });
                  const nick = info?.nickname;
                  const card = info?.card;
                  const role = info?.role;
                  let name = nick || String(uid);
                  if (card && card !== nick) name += `(${card})`;
                  if (role === 'owner') name += '[群主]'; else if (role === 'admin') name += '[管理员]';
                  return `${name}(QQ:${uid})`;
                } catch {
                  return String(uid);
                }
              });
              atDetails = await Promise.all(tasks);
            } catch {}
          }
          const out = atDetails.length > 0 ? atDetails.join('、') : allIds.map((u) => String(u)).join('、');
          lines.push('');
          lines.push('在群内艾特了: ' + out);
        }
      }
    }

    // 2. 引用消息（如果有）
    if (msg.reply) {
      let rtimeStr = '';
      let rConv = '';
      let rSenderInfo = '';
      let rSenderId = msg.reply.sender_id;
      try {
        if (this.invoker) {
          const detail: any = await this.invoker.data('get_msg', { message_id: msg.reply.id });
          const rtime = Number(detail?.time || detail?.data?.time);
          if (Number.isFinite(rtime) && rtime > 0) {
            rtimeStr = new Date(rtime * 1000).toLocaleString('zh-CN', {
              year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
            });
          }
          const rtype = detail?.message_type || detail?.data?.message_type;
          const rgid = detail?.group_id || detail?.data?.group_id;
          const ruid = detail?.user_id || detail?.data?.user_id;
          if (!rSenderId) rSenderId = ruid;
          rConv = rtype === 'group' ? `会话: G:${rgid || '未知'}` : `会话: U:${ruid || rSenderId || '未知'}`;
          const rnick = detail?.sender?.nickname || detail?.data?.sender?.nickname;
          const rcard = detail?.sender?.card || detail?.data?.sender?.card;
          const rrole = detail?.sender?.role || detail?.data?.sender?.role;
          let s = rnick || String(rSenderId || '');
          if (rcard) s += `(${rcard})`;
          if (rrole === 'owner') s += '[群主]'; else if (rrole === 'admin') s += '[管理员]';
          if (rSenderId) s += `(QQ:${rSenderId})`;
          rSenderInfo = s;
        }
      } catch {}
      if (!rSenderInfo) {
        let s2 = msg.reply.sender_name || `用户${rSenderId || msg.reply.id}`;
        if (rSenderId) s2 += `(QQ:${rSenderId})`;
        rSenderInfo = s2;
      }
      const rHeaderParts: string[] = [];
      rHeaderParts.push(`引用 消息ID: ${msg.reply.id}`);
      if (rConv) rHeaderParts.push(rConv);
      if (rtimeStr) rHeaderParts.push(`[${rtimeStr}]`);
      rHeaderParts.push(`发送者: ${rSenderInfo}`);
      replyLines.push('');
      replyLines.push(rHeaderParts.join(' | '));
      if (msg.reply.text) {
        replyLines.push(`${rSenderInfo} 说: ${msg.reply.text}`);
      }

      if (msg.reply.media.images.length > 0) {
        replyLines.push(msg.reply.media.images.length === 1 ? `${rSenderInfo} 发送了一张图片:` : `${rSenderInfo} 发送了${msg.reply.media.images.length}张图片:`);
        msg.reply.media.images.forEach((img, i) => {
          const imgPath = img.file || img.url || '未知';
          const filename = img.filename || img.file?.split(/[\\\/]/).pop() || `图片${i + 1}`;
          replyLines.push(`![${filename}](${imgPath})`);
        });
      }

      if (msg.reply.media.records.length > 0) {
        replyLines.push(msg.reply.media.records.length === 1 ? `${rSenderInfo} 发送了一条语音消息:` : `${rSenderInfo} 发送了${msg.reply.media.records.length}条语音消息:`);
        msg.reply.media.records.forEach((rec, i) => {
          const recPath = rec.file || '未知';
          const filename = recPath.split(/[\\\/]/).pop() || `语音${i + 1}`;
          replyLines.push(`[语音: ${filename}](${recPath})`);
        });
      }

      if (msg.reply.media.files.length > 0) {
        replyLines.push(msg.reply.media.files.length === 1 ? `${rSenderInfo} 发送了一个文件:` : `${rSenderInfo} 发送了${msg.reply.media.files.length}个文件:`);
        msg.reply.media.files.forEach((file, i) => {
          const sizeText = file.size ? ` (${this.formatFileSize(file.size)})` : '';
          const filename = file.name || '文件';
          // 如果URL不是本地绝对路径，需要拼接文件名
          let fullUrl = file.url || '';
          if (fullUrl && !fullUrl.match(/^[a-zA-Z]:[\\\/]/) && !fullUrl.startsWith('/')) {
            // 文件URL特殊处理：如果有fname=参数，直接赋值；否则添加&file=参数
            if (fullUrl.includes('fname=')) {
              fullUrl = fullUrl.replace(/fname=([^&]*)/, `fname=${encodeURIComponent(filename)}`);
            } else {
              fullUrl = `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}file=${encodeURIComponent(filename)}`;
            }
          }
          replyLines.push(`[${filename}](${fullUrl})${sizeText}`);
        });
      }

      if (msg.reply.media.videos.length > 0) {
        replyLines.push(msg.reply.media.videos.length === 1 ? `${rSenderInfo} 发送了一个视频:` : `${rSenderInfo} 发送了${msg.reply.media.videos.length}个视频:`);
        msg.reply.media.videos.forEach((vid, i) => {
          const filename = vid.file || `视频${i + 1}`;
          // 如果URL不是本地绝对路径，需要拼接文件名
          let fullUrl = vid.url || '';
          if (fullUrl && !fullUrl.match(/^[a-zA-Z]:[\\\\\/]/) && !fullUrl.startsWith('/')) {
            fullUrl = `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}file=${encodeURIComponent(filename)}`;
          }
          replyLines.push(`[视频: ${filename}](${fullUrl})`);
        });
      }

      if (msg.reply.media.forwards.length > 0) {
        msg.reply.media.forwards.forEach((fwd, i) => {
          replyLines.push(`${rSenderInfo} 转发了${fwd.count || 0}条消息`);
          if (fwd.preview && fwd.preview.length > 0) {
            replyLines.push(`${fwd.preview.slice(0, 2).join(', ')}...`);
          }
        });
      }
    }

    // 3. 消息内容
    const bodyText = consumedTextInMention ? '' : msg.text;
    const hasBody = Boolean(bodyText) || msg.images.length > 0 || msg.videos.length > 0 || msg.records.length > 0 || msg.files.length > 0;
    if (hasBody) {
      lines.push('');
    }
    
    // 文本内容 - 添加“说:”前缀
    if (bodyText) {
      lines.push(`说: ${bodyText}`);
    }

    // 4. 多媒体内容 - 添加描述性前缀
    // 图片（优先使用本地缓存路径）
    if (msg.images.length > 0) {
      if (msg.images.length === 1) {
        lines.push(`发送了一张图片:`);
      } else {
        lines.push(`发送了${msg.images.length}张图片:`);
      }
      msg.images.forEach((img, i) => {
        const filename = img.file || `图片${i + 1}`;
        const localPath = (img as any).path; // 本地缓存绝对路径（由 main.ts 填充）
        const fullUrl = !localPath && img.url ? `${img.url}${img.url.includes('?') ? '&' : '?'}file=${encodeURIComponent(filename)}` : '';
        const target = localPath || fullUrl || '';
        lines.push(`![${filename}](${target})`);
      });
    }

    // 视频
    if (msg.videos.length > 0) {
      if (msg.videos.length === 1) {
        lines.push(`发送了一个视频:`);
      } else {
        lines.push(`发送了${msg.videos.length}个视频:`);
      }
      msg.videos.forEach((vid, i) => {
        const filename = vid.file || `视频${i + 1}`;
        const fullUrl = vid.url ? `${vid.url}${vid.url.includes('?') ? '&' : '?'}file=${encodeURIComponent(filename)}` : '';
        lines.push(`[视频: ${filename}](${fullUrl})`);
      });
    }

    // 语音
    if (msg.records.length > 0) {
      if (msg.records.length === 1) {
        lines.push(`发送了一条语音消息:`);
      } else {
        lines.push(`发送了${msg.records.length}条语音消息:`);
      }
      msg.records.forEach((rec, i) => {
        const filename = rec.file || `语音${i + 1}`;
        let audioUrl = '';
        if (rec.path) {
          audioUrl = rec.path;
        } else if (rec.url) {
          audioUrl = `${rec.url}${rec.url.includes('?') ? '&' : '?'}file=${encodeURIComponent(filename)}`;
        }
        const sizeText = rec.file_size ? ` (${this.formatFileSize(rec.file_size)})` : '';
        lines.push(`[语音: ${filename}](${audioUrl})${sizeText}`);
      });
    }

    // 文件
    if (msg.files.length > 0) {
      if (msg.files.length === 1) {
        lines.push(`发送了一个文件:`);
      } else {
        lines.push(`发送了${msg.files.length}个文件:`);
      }
      msg.files.forEach((file, i) => {
        const filename = file.name || `文件${i + 1}`;
        const sizeText = file.size ? ` (${this.formatFileSize(file.size)})` : '';
        // 如果URL已有fname=参数，替换它；否则添加&file=参数
        let fullUrl = file.url || '';
        if (fullUrl && !fullUrl.match(/^[a-zA-Z]:[\\\/]/) && !fullUrl.startsWith('/')) {
          if (fullUrl.includes('fname=')) {
            fullUrl = fullUrl.replace(/fname=([^&]*)/, `fname=${encodeURIComponent(filename)}`);
          } else {
            fullUrl = `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}file=${encodeURIComponent(filename)}`;
          }
        }
        lines.push(`[${filename}](${fullUrl})${sizeText}`);
      });
    }

    // 5. @提及（非群聊保留末尾展示）
    if (msg.type !== 'group') {
      if (msg.at_all) {
        lines.push('');
        lines.push('艾特了全体成员');
      } else if (msg.at_users.length > 0) {
        let atDetails: string[] = [];
        if (this.invoker) {
          try {
            const tasks = msg.at_users.map(async (uid) => {
              try {
                const info: any = await this.invoker!.data('get_stranger_info', { user_id: uid });
                const name = info?.nickname || String(uid);
                return `${name}(QQ:${uid})`;
              } catch {
                return String(uid);
              }
            });
            atDetails = await Promise.all(tasks);
          } catch {}
        }
        const out = atDetails.length > 0 ? atDetails.join('、') : msg.at_users.map((u) => String(u)).join('、');
        lines.push('');
        lines.push('艾特了: ' + out);
      }
    }

    if (replyLines.length > 0) {
      lines.push('');
      lines.push('—— 引用的消息 ——');
      lines.push(...replyLines);
    }
    return lines.join('\n');
  }

  /**
   * 格式化文件大小
   */
  private formatFileSize(size: string | number): string {
    const bytes = typeof size === 'string' ? parseInt(size) : size;
    if (isNaN(bytes)) return '未知大小';
    
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }
}
