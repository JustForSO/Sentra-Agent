import WebSocket, { RawData } from 'ws';
import EventEmitter from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { OneBotEvent, OneBotResponse } from '../types/onebot';
import { createLogger, LogLevel, Logger } from '../logger';
import { RateLimiter } from './RateLimiter';

export interface WSClientOptions {
  accessToken?: string;
  reconnect?: boolean;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  requestTimeoutMs?: number;
  logLevel?: LogLevel;
  autoWaitOpen?: boolean; // if true, call() waits for open when socket is not yet open
  rateMaxConcurrency?: number;
  rateMinIntervalMs?: number;
}

type Pending = {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  timeout: NodeJS.Timeout;
  action: string;
  release?: () => void;
};

interface WSClientResolvedOptions {
  accessToken?: string;
  reconnect: boolean;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  requestTimeoutMs: number;
  logLevel: LogLevel;
  autoWaitOpen: boolean;
  rateMaxConcurrency: number;
  rateMinIntervalMs: number;
}

export class OneBotWSClient extends EventEmitter<{
  open: [];
  close: [code: number, reason: string];
  error: [err: Error];
  event: [ev: OneBotEvent];
}> {
  private url: string;
  private opts: WSClientResolvedOptions;
  private ws?: WebSocket;
  private manualClose = false;
  private pending = new Map<string | number, Pending>();
  private reconnectTimer?: NodeJS.Timeout;
  private logger: Logger;
  private limiter: RateLimiter;

  constructor(url: string, options: WSClientOptions = {}) {
    super();
    this.url = this.buildUrlWithToken(url, options.accessToken);
    this.opts = {
      accessToken: options.accessToken,
      reconnect: options.reconnect ?? true,
      reconnectMinMs: options.reconnectMinMs ?? 1000,
      reconnectMaxMs: options.reconnectMaxMs ?? 15000,
      requestTimeoutMs: options.requestTimeoutMs ?? 15000,
      logLevel: options.logLevel ?? 'info',
      autoWaitOpen: options.autoWaitOpen ?? true,
      rateMaxConcurrency: options.rateMaxConcurrency ?? 5,
      rateMinIntervalMs: options.rateMinIntervalMs ?? 200,
    };
    this.logger = createLogger(this.opts.logLevel);
    this.limiter = new RateLimiter({
      maxConcurrency: this.opts.rateMaxConcurrency,
      minIntervalMs: this.opts.rateMinIntervalMs,
    });
  }

  async connect(): Promise<void> {
    this.manualClose = false;
    await this.openSocket();
  }

  isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  waitOpen(timeoutMs = this.opts.requestTimeoutMs): Promise<void> {
    if (this.isOpen()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let done = false;
      const onOpen = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.off('open', onOpen);
        resolve();
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.off('open', onOpen);
        reject(new Error('waitOpen timeout'));
      }, timeoutMs);
      this.on('open', onOpen);
    });
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve) => {
      const headers: Record<string, string> = {};
      if (this.opts.accessToken) {
        headers['Authorization'] = `Bearer ${this.opts.accessToken}`;
      }
      const ws = new WebSocket(this.url, { headers });
      this.ws = ws;

      ws.on('open', () => {
        this.logger.info({ url: this.url }, 'WS open');
        this.emit('open');
        resolve();
      });

      ws.on('message', (data: RawData) => this.handleMessage(data.toString()));

      ws.on('close', (code: number, buf: Buffer) => {
        const reason = buf?.toString() || '';
        this.logger.warn({ code, reason }, 'WS close');
        this.emit('close', code, reason);
        this.cleanupPending(new Error(`WebSocket closed: ${code} ${reason}`));
        if (!this.manualClose && this.opts.reconnect) {
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err: Error) => {
        this.logger.error({ err }, 'WS error');
        this.emit('error', err);
      });

      // periodic ping
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 30000);
      ws.once('close', () => clearInterval(pingInterval));
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.floor(
      this.opts.reconnectMinMs +
        Math.random() * (this.opts.reconnectMaxMs - this.opts.reconnectMinMs),
    );
    this.logger.info({ delay }, 'schedule reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket().catch((e) => {
        this.logger.error({ e }, 'reconnect failed, reschedule');
        this.scheduleReconnect();
      });
    }, delay);
  }

  private buildUrlWithToken(url: string, token?: string): string {
    if (!token) return url;
    try {
      const u = new URL(url);
      if (!u.searchParams.has('access_token')) {
        u.searchParams.set('access_token', token);
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  private handleMessage(text: string) {
    try {
      const obj = JSON.parse(text);
      if (obj.echo !== undefined) {
        const pending = this.pending.get(obj.echo);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(obj.echo);
          pending.resolve(obj as OneBotResponse);
          if (pending.release) {
            pending.release();
            pending.release = undefined;
          }
        }
        return;
      }
      if (obj.post_type) {
        this.emit('event', obj as OneBotEvent);
        return;
      }
      this.logger.debug({ obj }, 'unrecognized message');
    } catch (e) {
      this.logger.error({ e, text }, 'failed to parse WS message');
    }
  }

  async call<T = any>(action: string, params: any = {}, timeoutMs?: number): Promise<OneBotResponse<T>> {
    let ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (this.opts.autoWaitOpen) {
        await this.waitOpen(timeoutMs ?? this.opts.requestTimeoutMs);
        ws = this.ws;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not open');
      }
    }
    const echo = uuidv4();
    const frame = { action, params, echo };
    const payload = JSON.stringify(frame);
    this.logger.debug({ action, params, echo }, 'send action');

    await this.limiter.acquire();
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.limiter.release();
      }
    };

    return new Promise<OneBotResponse<T>>((resolve, reject) => {
      const to = setTimeout(() => {
        const p = this.pending.get(echo);
        if (p) {
          this.pending.delete(echo);
          if (p.release) p.release();
        }
        release();
        reject(new Error(`Timeout waiting response for action "${action}"`));
      }, timeoutMs ?? this.opts.requestTimeoutMs);

      this.pending.set(echo, { resolve, reject, timeout: to, action, release });
      ws!.send(payload, (err?: Error) => {
        if (err) {
          clearTimeout(to);
          this.pending.delete(echo);
          release();
          reject(err);
        }
      });
    }).catch((e) => {
      release();
      throw e;
    });
  }

  async close(code?: number, reason?: string) {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const ws = this.ws;
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(code, reason);
    }
  }

  private cleanupPending(err: Error) {
    for (const [echo, p] of this.pending) {
      clearTimeout(p.timeout);
      p.reject(err);
      this.pending.delete(echo);
      if (p.release) {
        p.release();
        p.release = undefined;
      }
    }
  }
}
