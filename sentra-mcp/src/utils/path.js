import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function toPosix(p) {
  try { return String(p || '').replace(/\\/g, '/'); } catch { return String(p || ''); }
}

export function toFileUrl(p) {
  try { return pathToFileURL(p).href; } catch { return null; }
}

export function abs(p) {
  if (!p || typeof p !== 'string') return process.cwd();
  return path.resolve(process.cwd(), p);
}

export function relToCwd(p) {
  try { return toPosix(path.relative(process.cwd(), p)); } catch { return null; }
}
