import { config } from '../config/index.js';

// 中文：通用字符串裁剪，避免日志与上下文过长
export function clip(v, max = (config.flags?.verbosePreviewMax || 400)) {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + `\n...[截断 ${s.length - max} 字符]` : s;
  } catch {
    const s = String(v);
    return s.length > max ? s.slice(0, max) + `\n...[截断 ${s.length - max} 字符]` : s;
  }
}

export default { clip };
