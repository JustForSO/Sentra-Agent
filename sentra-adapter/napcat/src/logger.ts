import chalk from 'chalk';
import util from 'util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

function fmt(args: any[]): string {
  return args
    .map((a) =>
      typeof a === 'string'
        ? a
        : util.inspect(a, { colors: false, depth: null, maxArrayLength: 50 }),
    )
    .join(' ');
}

function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const SSS = pad(d.getMilliseconds(), 3);
  const tz = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = tz >= 0 ? '+' : '-';
  const absm = Math.abs(tz);
  const tzh = pad(Math.floor(absm / 60));
  const tzm = pad(absm % 60);
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${SSS} ${sign}${tzh}:${tzm}`;
}

export function createLogger(level: LogLevel = 'info'): Logger {
  const threshold = levelWeight[level] ?? levelWeight.info;
  const jsonLog = (process.env.JSON_LOG || '').toLowerCase() === 'true';

  const write = (lvl: keyof Logger, colorTag: string, args: any[]) => {
    if (jsonLog) {
      // Try to serialize arguments conservatively
      const safe = args.map((a) => {
        try {
          return typeof a === 'string' ? a : JSON.parse(JSON.stringify(a));
        } catch {
          return typeof a === 'string' ? a : util.inspect(a, { colors: false, depth: null, maxArrayLength: 50 });
        }
      });
      const payload = { level: lvl, time: localTimestamp(), entries: safe };
      const line = JSON.stringify(payload);
      if (lvl === 'error') console.error(line);
      else if (lvl === 'warn') console.warn(line);
      else console.log(line);
      return;
    }
    const line = colorTag + fmt(args);
    if (lvl === 'error') console.error(line);
    else if (lvl === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    debug: (...args: any[]) => {
      if (threshold <= levelWeight.debug) {
        write('debug', chalk.gray(`[debug] ${localTimestamp()} `), args);
      }
    },
    info: (...args: any[]) => {
      if (threshold <= levelWeight.info) {
        write('info', chalk.cyan(`[info ] ${localTimestamp()} `), args);
      }
    },
    warn: (...args: any[]) => {
      if (threshold <= levelWeight.warn) {
        write('warn', chalk.yellow(`[warn ] ${localTimestamp()} `), args);
      }
    },
    error: (...args: any[]) => {
      if (threshold <= levelWeight.error) {
        write('error', chalk.red(`[error] ${localTimestamp()} `), args);
      }
    },
  };
}
