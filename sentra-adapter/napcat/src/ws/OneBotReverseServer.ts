import { WebSocketServer, WebSocket, RawData } from 'ws';
import EventEmitter from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { OneBotEvent, OneBotResponse } from '../types/onebot';
import { createLogger, LogLevel, Logger } from '../logger';

export interface ReverseOptions {
  port: number;
  path?: string;
  accessToken?: string; // expected token from client (NapCat)
  logLevel?: LogLevel;
  requestTimeoutMs?: number;
}

type Pending = {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  timeout: NodeJS.Timeout;
  action: string;
};

export class OneBotReverseServer extends EventEmitter<{
  listening: [];
  client_connected: [ws: WebSocket];
  client_disconnected: [code: number, reason: string];
  error: [err: Error];
  event: [ev: OneBotEvent];
}> {
  private wss!: WebSocketServer;
  private ws?: WebSocket;
  private readonly opts: Required<ReverseOptions>;
  private readonly logger: Logger;
  private readonly pending = new Map<string | number, Pending>();

  constructor(options: ReverseOptions) {
    super();
    this.opts = {
      port: options.port,
      path: options.path ?? '/onebot',
      accessToken: options.accessToken ?? '',
      logLevel: options.logLevel ?? 'info',
      requestTimeoutMs: options.requestTimeoutMs ?? 15000,
    };
    this.logger = createLogger(this.opts.logLevel);
  }

  start() {
    // 显式指定监听0.0.0.0，确保IPv4和IPv6都可用
    this.wss = new WebSocketServer({ 
      port: this.opts.port, 
      path: this.opts.path,
      host: '0.0.0.0'  // 监听所有IPv4接口
    });
    this.wss.on('listening', () => {
      const addr = this.wss.address();
      const actualHost = (addr && typeof addr === 'object') ? addr.address : '0.0.0.0';
      const actualPort = (addr && typeof addr === 'object') ? addr.port : this.opts.port;
      this.logger.info('Reverse WS listening on', `ws://${actualHost}:${actualPort}${this.opts.path}`);
      this.emit('listening');
    });
    this.wss.on('connection', (ws, req) => {
      // Verify token from query or Authorization header
      try {
        if (this.opts.accessToken) {
          const url = new URL(req.url || '', `ws://${req.headers.host}`);
          const qTok = url.searchParams.get('access_token');
          const auth = req.headers['authorization'];
          const bearer = Array.isArray(auth) ? auth[0] : auth;
          const ok = qTok === this.opts.accessToken || (bearer?.startsWith('Bearer ') && bearer.slice(7) === this.opts.accessToken);
          if (!ok) {
            this.logger.warn('Reverse WS unauthorized connection, closing');
            ws.close(4001, 'unauthorized');
            return;
          }
        }
      } catch (e) {
        this.logger.warn('Token check error, closing');
        ws.close(4001, 'unauthorized');
        return;
      }

      // keep the last connection
      this.ws = ws;
      this.emit('client_connected', ws);
      this.logger.info('Reverse WS client connected');

      ws.on('message', (data: RawData) => this.handleMessage(data.toString()));
      ws.on('close', (code, buf) => {
        const reason = buf?.toString() || '';
        this.logger.warn({ code, reason }, 'Reverse WS client disconnected');
        this.emit('client_disconnected', code, reason);
        if (this.ws === ws) this.ws = undefined;
        this.cleanupPending(new Error(`reverse socket closed: ${code} ${reason}`));
      });
      ws.on('error', (err) => {
        this.logger.error({ err }, 'Reverse WS error');
        this.emit('error', err as any);
      });
    });

    this.wss.on('error', (err) => {
      this.logger.error({ err }, 'Reverse WS server error');
      this.emit('error', err as any);
    });
  }

  stop() {
    try {
      this.wss?.close();
    } catch {}
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.ws.close(1001, 'server closing');
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
        }
        return;
      }
      if (obj.post_type) {
        this.emit('event', obj as OneBotEvent);
        return;
      }
      this.logger.debug({ obj }, 'reverse: unrecognized message');
    } catch (e) {
      this.logger.error({ e, text }, 'reverse: failed to parse WS message');
    }
  }

  async call<T = any>(action: string, params: any = {}, timeoutMs?: number): Promise<OneBotResponse<T>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('No reverse WS client connected');
    }
    const echo = uuidv4();
    const frame = { action, params, echo };
    const payload = JSON.stringify(frame);

    return new Promise<OneBotResponse<T>>((resolve, reject) => {
      const to = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`Timeout waiting response for action "${action}"`));
      }, timeoutMs ?? this.opts.requestTimeoutMs);

      this.pending.set(echo, { resolve, reject, timeout: to, action });
      ws.send(payload, (err) => {
        if (err) {
          clearTimeout(to);
          this.pending.delete(echo);
          reject(err as any);
        }
      });
    });
  }

  private cleanupPending(err: Error) {
    for (const [echo, p] of this.pending) {
      clearTimeout(p.timeout);
      p.reject(err);
      this.pending.delete(echo);
    }
  }
}
