/**
 * 消息处理工具
 * 用于规范化、合并、压缩对话消息
 */

/**
 * 合并连续相同角色的消息，确保 content 为字符串
 */
export function compactMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages) {
    if (!m || !m.role) continue;
    const role = String(m.role);
    let content = typeof m.content === 'string' ? m.content : (() => {
      try { return JSON.stringify(m.content ?? ''); } catch { return String(m.content ?? ''); }
    })();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = [last.content, content].filter(Boolean).join('\n');
    } else {
      out.push({ role, content });
    }
  }
  return out;
}

/**
 * 规范化外部 OpenAI 风格的消息数组（最小化检查，保留顺序）
 */
export function normalizeConversation(messages) {
  if (!Array.isArray(messages)) return [];
  const allowed = new Set(['system', 'user', 'assistant']);
  const mapped = [];
  for (const m of messages) {
    const role = m?.role;
    let content = typeof m?.content === 'string' ? m.content : (() => {
      try { return JSON.stringify(m?.content ?? ''); } catch { return String(m?.content ?? ''); }
    })();
    if (allowed.has(role) && content && typeof content === 'string') mapped.push({ role, content });
  }
  return compactMessages(mapped);
}
