import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import logger from '../../src/logger/index.js';
import { abs as toAbs } from '../../src/utils/path.js';

function resolvePath(p) {
  if (!p || typeof p !== 'string') throw new Error('path is required');
  return toAbs(p);
}

function normAll(p) {
  const abs = toAbs(p);
  return {
    path: abs,
    path_markdown: toMarkdownPath(abs),
  };
}

function toMarkdownPath(abs) {
  const label = path.basename(abs);
  return `![${label}](${abs})`;
}

async function readFile(abs, encoding = 'utf-8') {
  if (encoding === 'base64') {
    const buf = await fs.readFile(abs);
    return { encoding: 'base64', data: buf.toString('base64'), size: buf.length };
  }
  const txt = await fs.readFile(abs, { encoding });
  return { encoding, data: txt, size: Buffer.byteLength(txt, encoding) };
}

// write_file 已拆分为独立插件，请使用 plugins/write_file

async function appendFile(abs, content, { encoding = 'utf-8' } = {}) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const data = typeof content === 'string' ? content + '' : JSON.stringify(content);
  await fs.appendFile(abs, data, { encoding });
  return { path: abs };
}

async function deletePath(abs, recursive = false) {
  await fs.rm(abs, { recursive, force: true });
  return { deleted: true, path: abs };
}

async function ensureDir(abs) {
  await fs.mkdir(abs, { recursive: true });
  return { ensured: true, path: abs };
}

async function listDir(abs) {
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const p = path.join(abs, e.name);
    const st = await fs.stat(p).catch(() => null);
    out.push({
      name: e.name,
      path: p,
      path_markdown: toMarkdownPath(p),
      isDir: e.isDirectory(),
      size: st?.size ?? 0,
      mtimeMs: st?.mtimeMs ?? 0,
    });
  }
  return { path: abs, entries: out };
}

async function statPath(abs) {
  const st = await fs.stat(abs);
  return {
    path: abs,
    isDir: st.isDirectory(),
    isFile: st.isFile(),
    size: st.size,
    mtimeMs: st.mtimeMs,
    ctimeMs: st.ctimeMs,
    atimeMs: st.atimeMs,
  };
}

async function movePath(srcAbs, destAbs, overwrite = true) {
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  if (!overwrite && fssync.existsSync(destAbs)) throw new Error('dest exists and overwrite=false');
  await fs.rename(srcAbs, destAbs).catch(async (e) => {
    if (e.code === 'EXDEV') {
      // cross-device: copy then delete
      await fs.copyFile(srcAbs, destAbs);
      await fs.rm(srcAbs, { force: true, recursive: true });
    } else throw e;
  });
  return { from: srcAbs, to: destAbs };
}

async function copyPath(srcAbs, destAbs, overwrite = true) {
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  if (!overwrite && fssync.existsSync(destAbs)) throw new Error('dest exists and overwrite=false');
  if (fssync.cp) {
    await fs.cp(srcAbs, destAbs, { recursive: true, force: overwrite });
  } else {
    const st = await fs.stat(srcAbs);
    if (st.isDirectory()) throw new Error('recursive copy not supported on this Node');
    await fs.copyFile(srcAbs, destAbs);
  }
  return { from: srcAbs, to: destAbs };
}

export default async function handler(args = {}) {
  const action = args.action;
  if (!action) return { success: false, code: 'INVALID', error: 'action is required' };

  try {
    switch (action) {
      case 'read_file': {
        const abs = resolvePath(args.path);
        const res = await readFile(abs, args.encoding || 'utf-8');
        return { success: true, data: { action, ...normAll(abs), ...res } };
      }
      
      case 'append_file': {
        const abs = resolvePath(args.path);
        await appendFile(abs, args.content, { encoding: args.encoding || 'utf-8' });
        return { success: true, data: { action, ...normAll(abs) } };
      }
      case 'delete_path': {
        const abs = resolvePath(args.path);
        const res = await deletePath(abs, !!args.recursive);
        return { success: true, data: { action, ...normAll(abs), deleted: !!res?.deleted } };
      }
      case 'ensure_dir': {
        const abs = resolvePath(args.path);
        const res = await ensureDir(abs);
        return { success: true, data: { action, ...normAll(abs), ensured: !!res?.ensured } };
      }
      case 'list_dir': {
        const abs = resolvePath(args.path);
        const res = await listDir(abs);
        return { success: true, data: { action, ...normAll(abs), entries: res.entries } };
      }
      case 'stat': {
        const abs = resolvePath(args.path);
        const res = await statPath(abs);
        const { path: _drop, ...stat } = res || {};
        return { success: true, data: { action, ...normAll(abs), ...stat } };
      }
      case 'move': {
        const src = resolvePath(args.path);
        const dest = resolvePath(args.dest);
        await movePath(src, dest, args.overwrite !== false);
        return { success: true, data: { action, ...normAll(dest) } };
      }
      case 'copy': {
        const src = resolvePath(args.path);
        const dest = resolvePath(args.dest);
        await copyPath(src, dest, args.overwrite !== false);
        return { success: true, data: { action, ...normAll(dest) } };
      }
      case 'normalize_path': {
        const abs = resolvePath(args.path);
        return { success: true, data: { action, ...normAll(abs) } };
      }
      default:
        return { success: false, code: 'UNSUPPORTED', error: `unsupported action: ${action}` };
    }
  } catch (e) {
    logger.error('fs_ops error', { label: 'PLUGIN', action, error: String(e?.message || e) });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
