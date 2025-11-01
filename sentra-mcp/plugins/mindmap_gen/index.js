import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../src/logger/index.js';
import { config } from '../../src/config/index.js';
import { chatCompletion } from '../../src/openai/client.js';
import { toPosix, abs as toAbs } from '../../src/utils/path.js';

const STYLES = new Set(['default','colorful','dark','minimal','anime','cyberpunk','nature','business','code','academic','creative','retro']);

function ensureStyle(style) { return STYLES.has(style) ? style : 'default'; }

function generateSystemPrompt() {
  return (
    '你是一个专业的思维导图生成助手。请仅输出用于 Markmap 渲染的 Markdown 文本（不要任何解释或代码块标记）。\n' +
    '规则：\n' +
    '1) 只输出 Markdown 代码，不要解释或 ``` 代码块\n' +
    '2) 使用 # 作为主节点，## 作为一级子节点，### 作为二级子节点（最多 5 级）\n' +
    '3) 结构清晰，中文友好，可包含 emoji\n' +
    '4) 不要包含 HTML 标签或非 Markdown 内容\n'
  );
}

function htmlTemplate(markdown, { width, height, styleCSS }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.jsdelivr.net/npm/d3@6"></script>
  <script src="https://cdn.jsdelivr.net/npm/markmap-lib@0.18.10"></script>
  <script src="https://cdn.jsdelivr.net/npm/markmap-view@0.18.10"></script>
  <style>${styleCSS}</style>
</head>
<body>
  <svg id="markmap" width="${width}" height="${height}"></svg>
  <script>
    const { Transformer } = markmap;
    const { Markmap } = markmap;
    const transformer = new Transformer();
    const { root } = transformer.transform(${JSON.stringify(markdown)});
    const svg = document.getElementById('markmap');
    const mm = Markmap.create(svg, null, root);
    setTimeout(()=>{ try { mm.fit(); } catch {} window.__MARKMAP_READY__ = true; }, 200);
  </script>
</body>
</html>`;
}

function defaultStyleCSS(style) {
  switch (ensureStyle(style)) {
    case 'dark':
      return `body,html{margin:0;height:100%;overflow:hidden;background:#1a1a1a}#markmap{width:100%;height:100%}.markmap-node{color:#fff;font-family:Segoe UI,Microsoft YaHei,Arial,sans-serif}`;
    case 'minimal':
      return `body,html{margin:0;height:100%;overflow:hidden;background:#f8f9fa}#markmap{width:100%;height:100%}.markmap-node{font-weight:300;font-family:Segoe UI,Microsoft YaHei,Arial,sans-serif}`;
    case 'colorful':
      return `body,html{margin:0;height:100%;overflow:hidden;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}#markmap{width:100%;height:100%}.markmap-node{font-weight:bold;font-family:Segoe UI,Microsoft YaHei,Arial,sans-serif}`;
    default:
      return `body,html{margin:0;height:100%;overflow:hidden;background:#fff}#markmap{width:100%;height:100%}.markmap-node{font-family:Segoe UI,Microsoft YaHei,Arial,sans-serif}`;
  }
}

function validateMarkdown(md) {
  if (!md || typeof md !== 'string') return false;
  const lines = md.split('\n').map((l)=>l.trim()).filter(Boolean);
  if (!lines.some((l)=>l.startsWith('#'))) return false;
  if (lines.some((l)=>l.includes('```'))) return false;
  if (!lines.some((l)=>l.startsWith('# '))) return false;
  return true;
}

async function ensureDirForFile(filePath) {
  const outAbs = toAbs(filePath);
  const dir = path.dirname(outAbs);
  await fs.mkdir(dir, { recursive: true });
  return outAbs;
}

async function renderImage({ markdown, outputFile, width, height, style, waitTime }) {
  let puppeteer;
  try { ({ default: puppeteer } = await import('puppeteer')); } catch { throw new Error('puppeteer not installed'); }
  const styleCSS = defaultStyleCSS(style);
  const html = htmlTemplate(markdown, { width, height, styleCSS });
  const outPngAbs = await ensureDirForFile(outputFile);
  const tempHtml = path.join(path.dirname(outPngAbs), `mindmap-${Date.now()}.html`);
  await fs.writeFile(tempHtml, html, 'utf-8');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.goto('file://' + toPosix(tempHtml), { waitUntil: 'networkidle0', timeout: 30000 });
    // Prefer readiness flag from the page; fallback to a small Node-side delay
    const maxWait = Math.max(1000, Number(waitTime) || 8000);
    await page.waitForFunction('window.__MARKMAP_READY__ === true', { timeout: Math.min(30000, maxWait) }).catch(() => {});
    await new Promise((r) => setTimeout(r, Math.min(10000, maxWait)));
    await page.screenshot({ path: outPngAbs, type: 'png', clip: { x: 0, y: 0, width, height } });
  } finally {
    try { await browser.close(); } catch {}
    try { await fs.unlink(tempHtml); } catch {}
  }
  const absPath = outPngAbs;
  return { abs: absPath };
}

export default async function handler(args = {}, options = {}) {
  const prompt = String(args.prompt || '').trim();
  if (!prompt) return { success: false, code: 'INVALID', error: 'prompt is required' };

  const penv = options?.pluginEnv || {};
  const width = Math.max(400, Number(args.width ?? penv.MINDMAP_WIDTH ?? 2400));
  const height = Math.max(300, Number(args.height ?? penv.MINDMAP_HEIGHT ?? 1600));
  const style = ensureStyle(String((args.style ?? penv.MINDMAP_DEFAULT_STYLE ?? 'default')));
  const waitTime = Math.max(1000, Number(args.waitTime ?? penv.MINDMAP_WAIT_TIME ?? 8000));
  const baseDir = 'artifacts';
  const rawName = String(args.filename || '').trim();
  if (!rawName) return { success: false, code: 'INVALID', error: 'filename is required (filename only, no directories)' };
  if (/[\\\/]/.test(rawName)) return { success: false, code: 'INVALID', error: 'filename must not contain path separators' };
  let outputFile = path.join(baseDir, rawName);
  if (!outputFile.toLowerCase().endsWith('.png')) outputFile += '.png';
  const render = args.render !== false;

  // 1) Ask LLM to produce markdown only
  const messages = [
    { role: 'system', content: generateSystemPrompt() },
    { role: 'user', content: `请根据以下描述生成思维导图：${prompt}` }
  ];
  const resp = await chatCompletion({
    messages,
    temperature: 0.2,
    apiKey: penv.MINDMAP_API_KEY || process.env.MINDMAP_API_KEY || config.llm.apiKey,
    baseURL: penv.MINDMAP_BASE_URL || process.env.MINDMAP_BASE_URL || config.llm.baseURL || 'https://yuanplus.cloud/v1',
    model: penv.MINDMAP_MODEL || process.env.MINDMAP_MODEL || config.llm.model,
    omitMaxTokens: true
  });
  const content = resp.choices?.[0]?.message?.content?.trim() || '';
  if (!validateMarkdown(content)) throw new Error('生成的Markdown内容无效');

  // 2) Optionally render PNG with Puppeteer
  let image = null;
  if (render) {
    try {
      image = await renderImage({ markdown: content, outputFile, width, height, style, waitTime });
    } catch (e) {
      logger.warn?.('mindmap_gen:render_failed', { label: 'PLUGIN', error: String(e?.message || e) });
    }
  }

  const data = {
    prompt,
    markdown_content: content,
    path: image?.abs || null,
    path_markdown: image?.abs ? `![${path.basename(image.abs)}](${image.abs})` : null,
    width,
    height,
    style,
    generation_info: {
      model: resp.model,
      created: resp.created,
      baseURL: (penv.MINDMAP_BASE_URL || process.env.MINDMAP_BASE_URL || config.llm.baseURL || 'https://yuanplus.cloud/v1')
    }
  };
  return { success: true, data };
}
