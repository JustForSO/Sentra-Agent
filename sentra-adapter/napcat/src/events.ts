import type { MessageEvent, OneBotEvent } from './types/onebot';
import chalk from 'chalk';

export function isMessageEvent(ev: OneBotEvent): ev is MessageEvent {
  return ev.post_type === 'message';
}

export function isPrivateMessage(ev: OneBotEvent): ev is MessageEvent & { message_type: 'private' } {
  return isMessageEvent(ev) && ev.message_type === 'private';
}

export function isGroupMessage(ev: OneBotEvent): ev is MessageEvent & { message_type: 'group' } {
  return isMessageEvent(ev) && ev.message_type === 'group';
}

export function getPlainText(ev: MessageEvent): string {
  return ev.message
    .filter((seg) => seg.type === 'text')
    .map((seg) => String(seg.data?.text ?? ''))
    .join('');
}

/**
 * 从消息段重新生成 raw_message，避免 [object Object] 问题
 */
export function regenerateRawMessage(ev: MessageEvent): string {
  const parts: string[] = [];
  for (const seg of ev.message) {
    if (!seg || !seg.type) continue;
    
    if (seg.type === 'text') {
      parts.push(String(seg.data?.text ?? ''));
    } else {
      // 生成 CQ 码格式
      const params: string[] = [];
      if (seg.data) {
        for (const [key, value] of Object.entries(seg.data)) {
          // 正确序列化对象和数组
          let valueStr: string;
          if (typeof value === 'object' && value !== null) {
            valueStr = JSON.stringify(value);
          } else {
            valueStr = String(value ?? '');
          }
          params.push(`${key}=${valueStr}`);
        }
      }
      const cqCode = params.length > 0 
        ? `[CQ:${seg.type},${params.join(',')}]`
        : `[CQ:${seg.type}]`;
      parts.push(cqCode);
    }
  }
  return parts.join('');
}

export function isMeaningfulMessage(ev: MessageEvent): boolean {
  if (!Array.isArray(ev.message) || ev.message.length === 0) return false;
  let hasReply = false;
  for (const seg of ev.message) {
    if (!seg || !seg.type) continue;
    if (seg.type === 'reply') { hasReply = true; continue; }
    if (seg.type === 'text') {
      const t = String(seg.data?.text ?? '').trim();
      if (t.length > 0) return true;
      continue;
    }
    return true;
  }
  return hasReply;
}

// ---- Debug helpers ----
export function summarizeMessageSegments(ev: MessageEvent) {
  const counts: Record<string, number> = {};
  for (const seg of ev.message) {
    counts[seg.type] = (counts[seg.type] || 0) + 1;
  }
  return {
    total: ev.message.length,
    counts,
  };
}

export function summarizeMessageEvent(ev: MessageEvent) {
  const seg = summarizeMessageSegments(ev);
  // 使用重新生成的 raw_message，避免 [object Object] 问题
  const rawMsg = regenerateRawMessage(ev);
  return {
    post_type: 'message',
    message_type: ev.message_type,
    message_id: (ev as any).message_id,
    time: (ev as any).time,
    self_id: (ev as any).self_id,
    group_id: (ev as any).group_id,
    user_id: (ev as any).user_id,
    sender: (ev as any).sender,
    raw_message: rawMsg,
    plain_text: getPlainText(ev),
    segments: seg,
  };
}

export function summarizeEvent(ev: OneBotEvent) {
  if (isMessageEvent(ev)) return summarizeMessageEvent(ev);
  // fallback: shallow summary for non-message events
  return {
    post_type: (ev as any).post_type,
    detail_type: (ev as any).notice_type || (ev as any).request_type || (ev as any).meta_event_type,
    self_id: (ev as any).self_id,
    time: (ev as any).time,
  };
}

export function formatMessageSummary(ev: MessageEvent): string {
  const s = summarizeMessageEvent(ev);
  const senderName = (s.sender && (s.sender.card || s.sender.nickname)) || '';
  const rows: string[] = [];
  rows.push('[message]');
  rows.push(`- type: ${s.message_type}`);
  rows.push(`- message_id: ${s.message_id}`);
  if (s.message_type === 'group') rows.push(`- group_id: ${s.group_id}`);
  rows.push(`- user_id: ${s.user_id}${senderName ? ` (${senderName})` : ''}`);
  rows.push(`- self_id: ${s.self_id}`);
  rows.push(`- segments: total=${s.segments.total} counts=${JSON.stringify(s.segments.counts)}`);
  if (s.plain_text) rows.push(`- plain_text: ${s.plain_text}`);
  if (s.raw_message) rows.push(`- raw_message: ${s.raw_message}`);
  return rows.join('\n');
}

function formatCounts(counts: Record<string, number>): string {
  const parts = Object.keys(counts)
    .sort()
    .map((k) => `${k}:${counts[k]}`);
  return parts.join(',');
}

function sanitizeInline(text: string, max = 80): string {
  // 常规清理
  const cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/\u0000/g, '')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&amp;/g, '&');
  
  // 如果 max为0或负数，不截断
  if (max <= 0 || cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + '…';
}

export function formatMessageCompact(
  ev: MessageEvent,
  opts: { plainMax?: number; withColor?: boolean } = {},
): string {
  const s = summarizeMessageEvent(ev);
  const withColor = opts.withColor !== false;
  const plain = s.plain_text || s.raw_message || '';
  
  // 从环境变量读取文本长度限制，0表示不限制
  const envMaxLength = process.env.MESSAGE_TEXT_MAX_LENGTH;
  const defaultMax = opts.plainMax ?? 80;
  const maxLength = envMaxLength !== undefined ? Number(envMaxLength) : defaultMax;
  
  const plainCropped = sanitizeInline(plain, maxLength);

  const color = (x: string, fn: (s: string) => string) => (withColor ? fn(x) : x);
  const head = color(
    `[message:${s.message_type}]`,
    s.message_type === 'group' ? chalk.magentaBright : chalk.blueBright,
  );
  const kv = (k: string, v: string, c = chalk.yellowBright) =>
    `${color(k, chalk.gray)}=${color(v, c)}`;

  const ids: string[] = [];
  if (s.message_type === 'group') {
    ids.push(kv('gid', String(s.group_id ?? '')));
  }
  const uname = s.sender && (s.sender.card || s.sender.nickname);
  ids.push(kv('uid', String(s.user_id ?? '')) + (uname ? `(${color(String(uname), chalk.cyanBright)})` : ''));
  ids.push(kv('mid', String(s.message_id ?? '')));

  const countsStr = formatCounts(s.segments.counts);
  const segs = `${color('segs', chalk.gray)}{${color(countsStr || 'none', chalk.gray)}}`;
  const text = `${color('text', chalk.gray)}="${color(plainCropped, chalk.white)}"`;

  let quoteParts: string[] = [];
  const replySeg = ev.message.find((seg) => seg.type === 'reply');
  if (replySeg) {
    const qid = replySeg.data?.id;
    let qtext = '';
    if (replySeg.data?.text) {
      qtext = String(replySeg.data.text);
    } else if (Array.isArray(replySeg.data?.message)) {
      const ts = (replySeg.data.message as any[])
        .filter((x) => x && x.type === 'text')
        .map((x) => String(x.data?.text ?? ''))
        .join('');
      qtext = ts;
    }
    const qcropped = sanitizeInline(qtext, 60);
    if (qid !== undefined) quoteParts.push(kv('qid', String(qid)));
    if (qcropped) quoteParts.push(`${color('quote', chalk.gray)}="${color(qcropped, chalk.white)}"`);
  }

  return [head, ...ids, segs, text, ...quoteParts].join(' ');
}

export function formatNoticeCompact(ev: any, opts: { withColor?: boolean } = {}): string {
  const withColor = opts.withColor !== false;
  const color = (x: string, fn: (s: string) => string) => (withColor ? fn(x) : x);
  const head = color(`[notice:${String(ev.notice_type || '')}]`, chalk.greenBright);
  const kv = (k: string, v: string, c = chalk.yellowBright) => `${color(k, chalk.gray)}=${color(v, c)}`;
  const fields: string[] = [];
  if (ev.group_id) fields.push(kv('gid', String(ev.group_id)));
  if (ev.user_id) fields.push(kv('uid', String(ev.user_id)));
  if (ev.operator_id) fields.push(kv('op', String(ev.operator_id)));
  if (ev.target_id) fields.push(kv('tid', String(ev.target_id)));
  if (ev.sub_type) fields.push(kv('sub', String(ev.sub_type)));
  return [head, ...fields].join(' ');
}

export function formatRequestCompact(ev: any, opts: { withColor?: boolean } = {}): string {
  const withColor = opts.withColor !== false;
  const color = (x: string, fn: (s: string) => string) => (withColor ? fn(x) : x);
  const head = color(`[request:${String(ev.request_type || '')}]`, chalk.yellowBright);
  const kv = (k: string, v: string, c = chalk.yellowBright) => `${color(k, chalk.gray)}=${color(v, c)}`;
  const fields: string[] = [];
  if (ev.user_id) fields.push(kv('uid', String(ev.user_id)));
  if (ev.group_id) fields.push(kv('gid', String(ev.group_id)));
  if (ev.sub_type) fields.push(kv('sub', String(ev.sub_type)));
  if (ev.comment) fields.push(kv('cm', sanitizeInline(String(ev.comment), 60), chalk.white));
  if (ev.flag) fields.push(kv('flag', String(ev.flag)));
  return [head, ...fields].join(' ');
}

export function formatMetaCompact(ev: any, opts: { withColor?: boolean } = {}): string {
  const withColor = opts.withColor !== false;
  const color = (x: string, fn: (s: string) => string) => (withColor ? fn(x) : x);
  const head = color(`[meta:${String(ev.meta_event_type || '')}]`, chalk.gray);
  const kv = (k: string, v: string, c = chalk.yellowBright) => `${color(k, chalk.gray)}=${color(v, c)}`;
  const fields: string[] = [];
  if (ev.status) fields.push(kv('status', typeof ev.status === 'string' ? ev.status : 'ok', chalk.green));
  if (ev.interval) fields.push(kv('int', String(ev.interval)));
  return [head, ...fields].join(' ');
}

export function formatEventCompact(ev: OneBotEvent, opts: { plainMax?: number; withColor?: boolean } = {}) {
  if (isMessageEvent(ev)) return formatMessageCompact(ev, opts);
  if ((ev as any).post_type === 'notice') return formatNoticeCompact(ev as any, opts);
  if ((ev as any).post_type === 'request') return formatRequestCompact(ev as any, opts);
  if ((ev as any).post_type === 'meta_event') return formatMetaCompact(ev as any, opts);
  return '[event]';
}
