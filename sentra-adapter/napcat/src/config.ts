import type { LogLevel } from './logger';

// 注意：.env 文件应该在应用启动时通过 'dotenv/config' 加载
// 这里不再重复加载，避免路径问题

export interface AdapterConfig {
  wsUrl: string;
  accessToken?: string;
  reconnect: boolean;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  requestTimeoutMs: number;
  logLevel: LogLevel;
  autoWaitOpen: boolean;
  // rate limit
  rateMaxConcurrency: number;
  rateMinIntervalMs: number;
  // retry (for helper methods, not auto-enabled for all calls)
  retryMaxAttempts: number;
  retryInitialDelayMs: number;
  retryBackoffFactor: number;
  retryJitterMs: number;
  // event deduplication
  deDupEvents: boolean;
  deDupTtlMs: number;
  // logging controls
  eventSummary: 'always' | 'debug' | 'never';
  jsonLog: boolean;
  // whitelist filters
  whitelistGroups: number[];
  whitelistUsers: number[];
  logFiltered: boolean;
  // reverse WS
  reversePort: number;
  reversePath: string;
  // message stream
  enableStream: boolean;
  streamPort: number;
  streamIncludeRaw: boolean;
  connectMode: 'forward' | 'reverse';
}

export function loadConfig(): AdapterConfig {
  return {
    wsUrl: process.env.NAPCAT_WS_URL || 'ws://127.0.0.1:6700',
    accessToken: process.env.NAPCAT_ACCESS_TOKEN || undefined,
    reconnect: (process.env.RECONNECT !== 'false'),
    reconnectMinMs: toInt(process.env.RECONNECT_MIN_MS, 1000),
    reconnectMaxMs: toInt(process.env.RECONNECT_MAX_MS, 15000),
    requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 15000),
    logLevel: ((process.env.LOG_LEVEL as LogLevel) || 'info'),
    autoWaitOpen: envBool(process.env.AUTO_WAIT_OPEN, true),
    rateMaxConcurrency: toInt(process.env.RATE_MAX_CONCURRENCY, 5),
    rateMinIntervalMs: toInt(process.env.RATE_MIN_INTERVAL_MS, 200),
    retryMaxAttempts: toInt(process.env.RETRY_MAX_ATTEMPTS, 3),
    retryInitialDelayMs: toInt(process.env.RETRY_INITIAL_DELAY_MS, 500),
    retryBackoffFactor: toFloat(process.env.RETRY_BACKOFF_FACTOR, 2),
    retryJitterMs: toInt(process.env.RETRY_JITTER_MS, 200),
    deDupEvents: envBool(process.env.DEDUP_EVENTS, true),
    deDupTtlMs: toInt(process.env.DEDUP_TTL_MS, 120000),
    eventSummary: (process.env.EVENT_SUMMARY as any) === 'always'
      ? 'always'
      : (process.env.EVENT_SUMMARY as any) === 'never'
      ? 'never'
      : 'debug',
    jsonLog: envBool(process.env.JSON_LOG, false),
    whitelistGroups: parseNumberArray(process.env.WHITELIST_GROUPS),
    whitelistUsers: parseNumberArray(process.env.WHITELIST_USERS),
    logFiltered: envBool(process.env.LOG_FILTERED, false),
    reversePort: toInt(process.env.REVERSE_PORT, 6701),
    reversePath: process.env.REVERSE_PATH || '/onebot',
    enableStream: envBool(process.env.ENABLE_STREAM, false),
    streamPort: toInt(process.env.STREAM_PORT, 6702),
    streamIncludeRaw: envBool(process.env.STREAM_INCLUDE_RAW, false),
    connectMode: ((process.env.NAPCAT_MODE || process.env.MODE || 'forward').toLowerCase() === 'reverse') ? 'reverse' : 'forward',
  };
}

function parseNumberArray(v: string | undefined): number[] {
  if (!v || !v.trim()) return [];
  return v.split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => parseInt(s, 10))
    .filter(n => Number.isFinite(n));
}

function toInt(v: string | undefined, def: number): number {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : def;
}

function toFloat(v: string | undefined, def: number): number {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : def;
}

function envBool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  const s = v.toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return def;
}
