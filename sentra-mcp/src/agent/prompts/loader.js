import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 中文：加载 prompts 目录下的 JSON 提示文件
export async function loadPrompt(name) {
  const filePath = path.resolve(__dirname, `${name}.json`);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

// 中文：简单的模板渲染，将 {{key}} 替换为 vars[key]
export function renderTemplate(str, vars = {}) {
  return String(str ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : '';
  });
}

export function composeSystem(base, overlay) {
  const b = String(base ?? '');
  const o = overlay ? String(overlay) : '';
  return o ? `${o}\n\n${b}` : b;
}
