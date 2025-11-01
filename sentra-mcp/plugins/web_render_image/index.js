// 将 HTML/URL/文件渲染为图片的插件实现
// 基于 Puppeteer 最佳实践，支持智能等待、自定义样式注入、元素截图等功能
import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../src/logger/index.js';
import { abs as toAbs, toPosix, toFileUrl } from '../../src/utils/path.js';

// 智能等待策略：根据页面类型自动选择合适的等待条件
async function smartWait(page, strategy = 'auto') {
  const strat = String(strategy || 'auto').toLowerCase();
  
  if (strat === 'load') {
    // 仅等待 load 事件，适合静态页面
    return;
  } else if (strat === 'networkidle') {
    // 等待网络空闲，适合有异步请求的页面
    try {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 });
    } catch (e) {
      logger.debug?.('web_render_image:networkidle timeout, continuing', { error: String(e?.message || e) });
    }
  } else {
    // auto: 智能等待 - 先等 DOM ready，再等网络趋于稳定
    try {
      await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
    } catch {}
    try {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 3000 });
    } catch {}
  }
}

// 构建完整 HTML（处理片段、添加基础结构）
function buildFullHtml(htmlFragment) {
  const trimmed = String(htmlFragment || '').trim();
  if (!trimmed) return '';
  
  // 如果已经是完整 HTML，直接返回
  if (/<!doctype\s+html>/i.test(trimmed) && /<\/html>/i.test(trimmed)) {
    return trimmed;
  }
  
  // 片段补全为完整页面
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Render</title>
</head>
<body>
${trimmed}
</body>
</html>`;
}

export default async function handler(args = {}, options = {}) {
  let browser = null;
  let page = null;
  
  try {
    const penv = options?.pluginEnv || {};

    // === 1. 解析输入参数 ===
    const htmlRaw = String(args.html || '').trim();
    let url = String(args.url || '').trim();
    const file = String(args.file || '').trim();
    const css = String(args.css || '').trim();
    const js = String(args.js || '').trim();
    const selector = String(args.selector || '').trim();
    const fullPage = args.fullPage !== false; // 默认整页截图
    const wait_for = String(args.wait_for || 'auto').toLowerCase();

    // 至少提供一种输入
    if (!htmlRaw && !url && !file) {
      return { success: false, code: 'INVALID', error: '必须提供 html、url 或 file 之一' };
    }

    // === 2. 准备输出目录和文件名 ===
    const artifactsDir = toAbs('artifacts');
    await fs.mkdir(artifactsDir, { recursive: true });
    
    const timestamp = Date.now();
    const fileName = `render_${timestamp}.png`;
    const outPath = path.join(artifactsDir, fileName);

    // === 3. 启动 Puppeteer（最新最佳实践）===
    let puppeteer;
    try {
      ({ default: puppeteer } = await import('puppeteer'));
    } catch (e) {
      return { success: false, code: 'NO_PUPPETEER', error: 'puppeteer 未安装或加载失败' };
    }

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ];
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: launchArgs,
      timeout: 30000,
      ignoreHTTPSErrors: true,
    });
    
    page = await browser.newPage();
    
    // 自适应视口：默认 1366x768（适合大多数场景）
    await page.setViewport({
      width: 1366,
      height: 768,
      deviceScaleFactor: 2, // 2倍像素比，提升截图清晰度
    });

    // === 4. 加载页面内容 ===
    if (htmlRaw) {
      // 渲染 HTML 字符串
      const fullHtml = buildFullHtml(htmlRaw);
      const waitUntil = wait_for === 'load' ? 'load' : 'networkidle2';
      await page.setContent(fullHtml, {
        waitUntil,
        timeout: 30000,
      });
    } else if (url) {
      // 访问 URL
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const waitUntil = wait_for === 'load' ? 'load' : 'networkidle2';
      await page.goto(url, {
        waitUntil,
        timeout: 30000,
      });
    } else {
      // 加载本地文件
      const absFile = toAbs(file);
      const exists = await fs.stat(absFile).then(() => true).catch(() => false);
      if (!exists) {
        return { success: false, code: 'FILE_NOT_FOUND', error: `文件不存在: ${absFile}` };
      }
      const fileUrl = toFileUrl(absFile);
      const waitUntil = wait_for === 'load' ? 'load' : 'networkidle2';
      await page.goto(fileUrl, {
        waitUntil,
        timeout: 30000,
      });
    }

    // === 5. 注入自定义样式和脚本 ===
    if (css) {
      try {
        await page.addStyleTag({ content: css });
      } catch (e) {
        logger.warn?.('web_render_image: CSS 注入失败', { error: String(e?.message || e) });
      }
    }
    
    if (js) {
      try {
        await page.addScriptTag({ content: js });
      } catch (e) {
        logger.warn?.('web_render_image: JS 注入失败', { error: String(e?.message || e) });
      }
    }

    // === 6. 智能等待页面渲染完成 ===
    await smartWait(page, wait_for);

    // === 7. 截图 ===
    if (selector) {
      // 截取指定元素
      const element = await page.$(selector);
      if (!element) {
        return { success: false, code: 'SELECTOR_NOT_FOUND', error: `选择器未匹配到元素: ${selector}` };
      }
      await element.screenshot({
        path: outPath,
        type: 'png',
      });
    } else {
      // 整页或视口截图
      await page.screenshot({
        path: outPath,
        type: 'png',
        fullPage,
      });
    }

    // === 8. 返回结果 ===
    const stat = await fs.stat(outPath);
    const absPosix = toPosix(outPath);
    const md = `![${path.basename(outPath)}](${absPosix})`;

    return {
      success: true,
      data: {
        action: 'web_render_image',
        path: outPath,
        path_markdown: md,
        size_bytes: stat.size,
        format: 'png',
        viewport: { width: 1366, height: 768, scale: 2 },
        source: htmlRaw ? 'html' : (url ? 'url' : 'file'),
      },
    };
  } catch (e) {
    logger.error?.('web_render_image: 渲染失败', { label: 'PLUGIN', error: String(e?.message || e), stack: e?.stack });
    return {
      success: false,
      code: 'RENDER_ERROR',
      error: String(e?.message || e),
    };
  } finally {
    // 确保资源清理（最佳实践）
    try {
      if (page) await page.close();
    } catch (e) {
      logger.debug?.('web_render_image: page.close() 失败', { error: String(e?.message || e) });
    }
    try {
      if (browser) await browser.close();
    } catch (e) {
      logger.debug?.('web_render_image: browser.close() 失败', { error: String(e?.message || e) });
    }
  }
}
