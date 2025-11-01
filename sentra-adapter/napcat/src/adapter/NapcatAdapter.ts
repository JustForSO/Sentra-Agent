import EventEmitter from 'eventemitter3';
import { OneBotWSClient } from '../ws/OneBotWSClient';
import { Message, OneBotEvent, OneBotResponse, MessageEvent } from '../types/onebot';
import { toSegments, MessageInput } from '../utils/message';
import { isMeaningfulMessage } from '../events';
import type { LogLevel } from '../logger';
import { assertOk, dataOrThrow } from '../ob11';
import type { AdapterPlugin } from '../plugins/types';

export interface AdapterOptions {
  wsUrl: string;
  accessToken?: string;
  requestTimeoutMs?: number;
  reconnect?: boolean;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  logLevel?: LogLevel;
  autoWaitOpen?: boolean;
  rateMaxConcurrency?: number;
  rateMinIntervalMs?: number;
  // retry helpers
  retryMaxAttempts?: number;
  retryInitialDelayMs?: number;
  retryBackoffFactor?: number;
  retryJitterMs?: number;
  // event de-duplication
  deDupEvents?: boolean;
  deDupTtlMs?: number;
  // whitelist filters
  whitelistGroups?: number[];
  whitelistUsers?: number[];
  logFiltered?: boolean;
}

export class NapcatAdapter extends EventEmitter<{
  open: [];
  close: [code: number, reason: string];
  error: [err: Error];
  event: [ev: OneBotEvent];
  message: [ev: OneBotEvent];
  notice: [ev: OneBotEvent];
  request: [ev: OneBotEvent];
  meta_event: [ev: OneBotEvent];
}> {
  private client: OneBotWSClient;
  private deDupEnabled: boolean;
  private deDupTtlMs: number;
  private seenMsgInfo = new Map<number, { ts: number; meaningful: boolean }>();
  private selfId?: number;
  private plugins: Set<AdapterPlugin> = new Set();
  private whitelistGroups: Set<number>;
  private whitelistUsers: Set<number>;
  private logFiltered: boolean;

  constructor(options: AdapterOptions) {
    super();
    this.client = new OneBotWSClient(options.wsUrl, {
      accessToken: options.accessToken,
      requestTimeoutMs: options.requestTimeoutMs,
      reconnect: options.reconnect,
      reconnectMinMs: options.reconnectMinMs,
      reconnectMaxMs: options.reconnectMaxMs,
      logLevel: options.logLevel,
      autoWaitOpen: options.autoWaitOpen,
      rateMaxConcurrency: options.rateMaxConcurrency,
      rateMinIntervalMs: options.rateMinIntervalMs,
    });
    this.deDupEnabled = options.deDupEvents ?? true;
    this.deDupTtlMs = options.deDupTtlMs ?? 120_000;
    this.whitelistGroups = new Set(options.whitelistGroups ?? []);
    this.whitelistUsers = new Set(options.whitelistUsers ?? []);
    this.logFiltered = options.logFiltered ?? false;

    this.client.on('open', async () => {
      this.emit('open');
      try {
        const info = await this.callData<{ user_id: number }>('get_login_info');
        this.selfId = info?.user_id;
      } catch {
        // ignore
      }
    });
    this.client.on('close', (c, r) => this.emit('close', c, r));
    this.client.on('error', (e) => this.emit('error', e));
    this.client.on('event', (ev) => {
      if (this.filterDuplicate(ev)) return;
      if (this.filterWhitelist(ev)) return;
      this.emit('event', ev);
      if ((ev as any).post_type) this.emit((ev as any).post_type, ev);
    });
  }

  connect(): Promise<void> {
    return this.client.connect();
  }

  close(): Promise<void> {
    return this.client.close() as any;
  }

  call<T = any>(action: string, params?: any): Promise<OneBotResponse<T>> {
    return this.client.call<T>(action, params);
  }

  async callOk<T = any>(action: string, params?: any): Promise<OneBotResponse<T>> {
    const res = await this.call<T>(action, params);
    return assertOk(res);
  }

  async callData<T = any>(action: string, params?: any): Promise<T> {
    const res = await this.call<T>(action, params);
    return dataOrThrow(res);
  }

  async callRetry<T = any>(action: string, params?: any, overrides?: {
    maxAttempts?: number; initialDelayMs?: number; backoffFactor?: number; jitterMs?: number;
  }): Promise<OneBotResponse<T>> {
    const maxAttempts = overrides?.maxAttempts ?? 3;
    const backoff = overrides?.backoffFactor ?? 2;
    const jitterMs = overrides?.jitterMs ?? 200;
    let delay = overrides?.initialDelayMs ?? 500;
    let lastErr: any;
    for (let n = 1; n <= maxAttempts; n++) {
      try {
        const res = await this.call<T>(action, params);
        return assertOk(res);
      } catch (e) {
        lastErr = e;
        if (n === maxAttempts) break;
        const j = Math.floor(Math.random() * jitterMs);
        await sleep(delay + j);
        delay = Math.floor(delay * backoff);
      }
    }
    throw lastErr;
  }

  async callDataRetry<T = any>(action: string, params?: any, overrides?: {
    maxAttempts?: number; initialDelayMs?: number; backoffFactor?: number; jitterMs?: number;
  }): Promise<T> {
    const res = await this.callRetry<T>(action, params, overrides);
    return res.data as T;
  }

  // ---- Generic send ----
  async sendMessage(
    message_type: 'private' | 'group',
    id: number,
    message: MessageInput,
  ) {
    const msg = toSegments(message);
    if (message_type === 'private') {
      return this.call('send_msg', { message_type, user_id: id, message: msg });
    }
    return this.call('send_msg', { message_type, group_id: id, message: msg });
  }

  async sendPrivateMessage(user_id: number, message: MessageInput) {
    const msg = toSegments(message);
    return this.call('send_private_msg', { user_id, message: msg });
  }

  async sendGroupMessage(group_id: number, message: MessageInput) {
    const msg = toSegments(message);
    return this.call('send_group_msg', { group_id, message: msg });
  }

  async sendPrivateReply(user_id: number, reply_to_message_id: number, message: MessageInput) {
    const msg = [ { type: 'reply', data: { id: reply_to_message_id } }, ...toSegments(message) ] as Message;
    return this.call('send_private_msg', { user_id, message: msg });
  }

  async sendGroupReply(group_id: number, reply_to_message_id: number, message: MessageInput) {
    const msg = [ { type: 'reply', data: { id: reply_to_message_id } }, ...toSegments(message) ] as Message;
    return this.call('send_group_msg', { group_id, message: msg });
  }

  async recallMessage(message_id: number) {
    return this.call('delete_msg', { message_id });
  }

  async getMsg(message_id: number) {
    return this.call('get_msg', { message_id });
  }

  async getForwardMsg(id: string) {
    return this.call('get_forward_msg', { id });
  }

  async getGroupList() {
    return this.call('get_group_list');
  }

  async getGroupMemberList(group_id: number) {
    return this.call('get_group_member_list', { group_id });
  }

  async getLoginInfo() {
    return this.call('get_login_info');
  }

  // ---- Extended common actions ----
  async getFriendList() {
    return this.call('get_friend_list');
  }

  async getGroupInfo(group_id: number, no_cache?: boolean) {
    return this.call('get_group_info', { group_id, no_cache });
  }

  async getGroupMemberInfo(group_id: number, user_id: number, no_cache?: boolean) {
    return this.call('get_group_member_info', { group_id, user_id, no_cache });
  }

  async getStrangerInfo(user_id: number, no_cache?: boolean) {
    return this.call('get_stranger_info', { user_id, no_cache });
  }

  async setGroupWholeBan(group_id: number, enable = true) {
    return this.call('set_group_whole_ban', { group_id, enable });
  }

  async setGroupBan(group_id: number, user_id: number, duration: number) {
    return this.call('set_group_ban', { group_id, user_id, duration });
  }

  async setGroupKick(group_id: number, user_id: number, reject_add_request?: boolean) {
    return this.call('set_group_kick', { group_id, user_id, reject_add_request });
  }

  async setGroupCard(group_id: number, user_id: number, card?: string) {
    return this.call('set_group_card', { group_id, user_id, card });
  }

  async setGroupName(group_id: number, group_name: string) {
    return this.call('set_group_name', { group_id, group_name });
  }

  async sendLike(user_id: number, times = 1) {
    return this.call('send_like', { user_id, times });
  }

  async setGroupAddRequest(flag: string, sub_type: 'add' | 'invite', approve: boolean, reason?: string) {
    return this.call('set_group_add_request', { flag, sub_type, approve, reason });
  }

  async setFriendAddRequest(flag: string, approve: boolean, remark?: string) {
    return this.call('set_friend_add_request', { flag, approve, remark });
  }

  // ---- Forward messages ----
  async sendGroupForwardMessage(group_id: number, messages: any[]) {
    return this.call('send_group_forward_msg', { group_id, messages });
  }

  async sendPrivateForwardMessage(user_id: number, messages: any[]) {
    return this.call('send_private_forward_msg', { user_id, messages });
  }

  // ---- Files & Media ----
  async uploadGroupFile(group_id: number, file: string, name?: string, folder?: string) {
    return this.call('upload_group_file', { group_id, file, name, folder });
  }

  async uploadPrivateFile(user_id: number, file: string, name?: string) {
    return this.call('upload_private_file', { user_id, file, name });
  }

  async getGroupRootFiles(group_id: number) {
    return this.call('get_group_root_files', { group_id });
  }

  async getGroupFilesByFolder(group_id: number, folder_id: string) {
    return this.call('get_group_files_by_folder', { group_id, folder_id });
  }

  async getGroupFileUrl(group_id: number, file_id: string, busid: number) {
    return this.call('get_group_file_url', { group_id, file_id, busid });
  }

  async deleteGroupFile(group_id: number, file_id: string, busid: number) {
    return this.call('delete_group_file', { group_id, file_id, busid });
  }

  async deleteGroupFolder(group_id: number, folder_id: string) {
    return this.call('delete_group_folder', { group_id, folder_id });
  }

  async createGroupFileFolder(group_id: number, name: string, parent_id?: string) {
    return this.call('create_group_file_folder', { group_id, name, parent_id });
  }

  async getImage(file: string) {
    return this.call('get_image', { file });
  }

  async ocrImage(image: string) {
    return this.call('ocr_image', { image });
  }

  // ---- Other utilities ----
  async getStatus() {
    return this.call('get_status');
  }

  async getVersionInfo() {
    return this.call('get_version_info');
  }

  async setGroupLeave(group_id: number, is_dismiss?: boolean) {
    return this.call('set_group_leave', { group_id, is_dismiss });
  }

  async setEssenceMsg(message_id: number) {
    return this.call('set_essence_msg', { message_id });
  }

  async deleteEssenceMsg(message_id: number) {
    return this.call('delete_essence_msg', { message_id });
  }

  // ---- Event helpers ----
  onGroupMessage(handler: (ev: MessageEvent & { message_type: 'group' }) => void): () => void {
    const fn = (ev: OneBotEvent) => {
      if ((ev as any).post_type === 'message' && (ev as any).message_type === 'group') {
        handler(ev as any);
      }
    };
    this.on('message', fn);
    return () => this.off('message', fn);
  }

  onPrivateMessage(handler: (ev: MessageEvent & { message_type: 'private' }) => void): () => void {
    const fn = (ev: OneBotEvent) => {
      if ((ev as any).post_type === 'message' && (ev as any).message_type === 'private') {
        handler(ev as any);
      }
    };
    this.on('message', fn);
    return () => this.off('message', fn);
  }

  onMention(handler: (ev: MessageEvent) => void): () => void {
    const fn = (ev: OneBotEvent) => {
      if ((ev as any).post_type === 'message' && this.isAtMe(ev as any)) {
        handler(ev as any);
      }
    };
    this.on('message', fn);
    return () => this.off('message', fn);
  }

  isAtMe(ev: MessageEvent): boolean {
    const sid = String(this.selfId ?? '');
    for (const seg of ev.message) {
      if (seg.type === 'at') {
        const qq = String(seg.data?.qq ?? '');
        if (qq === 'all' || (sid && qq === sid)) return true;
      }
    }
    return false;
  }

  async sendReply(ev: MessageEvent, message: MessageInput) {
    if (ev.message_type === 'group' && ev.group_id) {
      return this.sendGroupReply(ev.group_id, ev.message_id, message);
    }
    if (ev.message_type === 'private' && ev.user_id) {
      return this.sendPrivateReply(ev.user_id, ev.message_id, message);
    }
    throw new Error('Unsupported message event for reply');
  }

  async sendTo(ev: MessageEvent, message: MessageInput) {
    if (ev.message_type === 'group' && ev.group_id) {
      return this.sendGroupMessage(ev.group_id, message);
    }
    if (ev.message_type === 'private' && ev.user_id) {
      return this.sendPrivateMessage(ev.user_id, message);
    }
    throw new Error('Unsupported message event for send');
  }

  // ---- Plugins ----
  use(plugin: AdapterPlugin): () => void {
    plugin.setup(this);
    this.plugins.add(plugin);
    return () => this.unuse(plugin);
  }

  unuse(plugin: AdapterPlugin) {
    if (this.plugins.has(plugin)) {
      try { plugin.dispose?.(); } finally { this.plugins.delete(plugin); }
    }
  }

  disposePlugins() {
    for (const p of Array.from(this.plugins)) {
      try { p.dispose?.(); } finally { this.plugins.delete(p); }
    }
  }

  async destroy(code?: number, reason?: string) {
    this.disposePlugins();
    await this.close();
  }

  private filterDuplicate(ev: OneBotEvent): boolean {
    if (!this.deDupEnabled) return false;
    if ((ev as any).post_type !== 'message') return false;
    const id = (ev as any).message_id as number | undefined;
    if (!id) return false;
    const meaningful = isMeaningfulMessage(ev as any as MessageEvent);
    const now = Date.now();
    const entry = this.seenMsgInfo.get(id);
    if (entry && now - entry.ts < this.deDupTtlMs) {
      if (entry.meaningful) {
        return true;
      }
      if (!entry.meaningful && meaningful) {
        this.seenMsgInfo.set(id, { ts: now, meaningful: true });
        return false;
      }
      return true;
    }
    this.seenMsgInfo.set(id, { ts: now, meaningful });
    if (this.seenMsgInfo.size > 1000) {
      for (const [mid, info] of this.seenMsgInfo) {
        if (now - info.ts >= this.deDupTtlMs) this.seenMsgInfo.delete(mid);
      }
    }
    return false;
  }

  private filterWhitelist(ev: OneBotEvent): boolean {
    // Only filter message events
    if ((ev as any).post_type !== 'message') return false;
    
    const msgEv = ev as any;
    const messageType = msgEv.message_type;
    const groupId = msgEv.group_id as number | undefined;
    const userId = msgEv.user_id as number | undefined;

    // Check group whitelist
    if (messageType === 'group' && this.whitelistGroups.size > 0) {
      if (!groupId || !this.whitelistGroups.has(groupId)) {
        if (this.logFiltered) {
          this.client['logger']?.debug(
            { group_id: groupId, user_id: userId },
            'Filtered: group not in whitelist'
          );
        }
        return true; // drop
      }
    }

    // Check user whitelist
    if (messageType === 'private' && this.whitelistUsers.size > 0) {
      if (!userId || !this.whitelistUsers.has(userId)) {
        if (this.logFiltered) {
          this.client['logger']?.debug(
            { user_id: userId },
            'Filtered: user not in whitelist'
          );
        }
        return true; // drop
      }
    }

    return false; // allow
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
