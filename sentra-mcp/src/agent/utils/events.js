/**
 * 事件发射工具
 * 用于运行时事件的发送和时间戳管理
 */

import { RunEvents } from '../../bus/runEvents.js';

function now() { return Date.now(); }

/**
 * 向进程内总线发射一个 run 级别的事件（包含时间戳）
 */
export function emitRunEvent(runId, entry) {
  try {
    RunEvents.emit(runId, { runId, ts: now(), ...entry });
  } catch (e) {
    // 静默失败，不中断主流程
  }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
export const normKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
