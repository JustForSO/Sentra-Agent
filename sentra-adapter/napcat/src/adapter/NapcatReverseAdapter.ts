import EventEmitter from 'eventemitter3';
import { OneBotReverseServer, ReverseOptions } from '../ws/OneBotReverseServer';
import { Message, OneBotEvent, OneBotResponse, MessageEvent } from '../types/onebot';
import { MessageInput, toSegments } from '../utils/message';
import { assertOk, dataOrThrow } from '../ob11';

export interface ReverseAdapterOptions extends ReverseOptions {
  whitelistGroups?: number[];
  whitelistUsers?: number[];
  logFiltered?: boolean;
}

export class NapcatReverseAdapter extends EventEmitter<{
  listening: [];
  connected: [];
  disconnected: [code: number, reason: string];
  error: [err: Error];
  event: [ev: OneBotEvent];
  message: [ev: OneBotEvent];
  notice: [ev: OneBotEvent];
  request: [ev: OneBotEvent];
  meta_event: [ev: OneBotEvent];
}> {
  private server: OneBotReverseServer;
  private selfId?: number;
  private whitelistGroups: Set<number>;
  private whitelistUsers: Set<number>;
  private logFiltered: boolean;

  constructor(options: ReverseAdapterOptions) {
    super();
    this.server = new OneBotReverseServer(options);
    this.whitelistGroups = new Set(options.whitelistGroups ?? []);
    this.whitelistUsers = new Set(options.whitelistUsers ?? []);
    this.logFiltered = options.logFiltered ?? false;

    this.server.on('listening', () => this.emit('listening'));
    this.server.on('client_connected', async () => {
      this.emit('connected');
      try {
        const info = await this.callData<{ user_id: number }>('get_login_info');
        this.selfId = info?.user_id;
      } catch {}
    });
    this.server.on('client_disconnected', (c, r) => this.emit('disconnected', c, r));
    this.server.on('error', (e) => this.emit('error', e));
    this.server.on('event', (ev) => {
      if (this.filterWhitelist(ev)) return;
      this.emit('event', ev);
      if ((ev as any).post_type) this.emit((ev as any).post_type, ev);
    });
  }

  start() {
    this.server.start();
  }

  stop() {
    this.server.stop();
  }

  call<T = any>(action: string, params?: any): Promise<OneBotResponse<T>> {
    return this.server.call<T>(action, params);
  }

  async callOk<T = any>(action: string, params?: any): Promise<OneBotResponse<T>> {
    const res = await this.call<T>(action, params);
    return assertOk(res);
  }

  async callData<T = any>(action: string, params?: any): Promise<T> {
    const res = await this.call<T>(action, params);
    return dataOrThrow(res);
  }

  // send helpers
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

  async sendGroupForwardMessage(group_id: number, messages: any[]) {
    return this.call('send_group_forward_msg', { group_id, messages });
  }

  async sendPrivateForwardMessage(user_id: number, messages: any[]) {
    return this.call('send_private_forward_msg', { user_id, messages });
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
          console.debug(`[Filtered] Group ${groupId} not in whitelist (user: ${userId})`);
        }
        return true; // drop
      }
    }

    // Check user whitelist
    if (messageType === 'private' && this.whitelistUsers.size > 0) {
      if (!userId || !this.whitelistUsers.has(userId)) {
        if (this.logFiltered) {
          console.debug(`[Filtered] User ${userId} not in whitelist`);
        }
        return true; // drop
      }
    }

    return false; // allow
  }
}
