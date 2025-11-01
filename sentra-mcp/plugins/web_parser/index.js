import axios from 'axios';
import logger from '../../src/logger/index.js';

function processUrl(input) {
  try {
    let url = String(input || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    // throws on invalid
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

function resolveBool(v, def = false) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
  return def;
}

function toInt(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }

function resolveConfig(args, pluginEnv = {}, defaultTimeoutMs = 30000) {
  const timeoutFromArgs = Number(args?.timeout);
  const maxBytesFromArgs = Number(args?.maxBytes);
  const envTimeout = Number(pluginEnv.WEB_PARSER_TIMEOUT);
  const envMaxLen = Number(pluginEnv.WEB_PARSER_MAX_CONTENT_LENGTH || pluginEnv.WEB_PARSER_MAX_BYTES);
  const enableJS = args?.use_js !== undefined ? Boolean(args.use_js) : resolveBool(pluginEnv.WEB_PARSER_ENABLE_JAVASCRIPT, true);
  const waitSelector = args?.waitSelector || pluginEnv.WEB_PARSER_WAIT_FOR_SELECTOR || '';
  const ua = pluginEnv.WEB_PARSER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 SentraWebParser/1.0.0';
  const useProxy = resolveBool(pluginEnv.WEB_PARSER_USE_PROXY, false);
  const proxyServer = pluginEnv.WEB_PARSER_PROXY_SERVER || '';
  const viewportWidth = toInt(pluginEnv.WEB_PARSER_VIEWPORT_WIDTH, 1366);
  const viewportHeight = toInt(pluginEnv.WEB_PARSER_VIEWPORT_HEIGHT, 768);
  const maxRetries = Math.max(1, toInt(pluginEnv.WEB_PARSER_MAX_RETRIES, 2));
  const retryDelay = Math.max(500, toInt(pluginEnv.WEB_PARSER_RETRY_DELAY, 2000));

  // Advanced waiting & heuristics (all configurable, no site-specific hardcode)
  const waitStrategy = (args?.waitStrategy || pluginEnv.WEB_PARSER_WAIT_STRATEGY || 'auto').toLowerCase();
  const maxTotalWaitMs = Math.max(1000, toInt(args?.maxTotalWaitMs ?? pluginEnv.WEB_PARSER_MAX_TOTAL_WAIT, 15000));
  const netIdleIdleMs = Math.max(200, toInt(args?.networkIdleMs ?? args?.netIdleMs ?? pluginEnv.WEB_PARSER_NETWORK_IDLE_IDLE_MS, 800));
  const domStableSampleMs = Math.max(100, toInt(args?.domStableSampleMs ?? pluginEnv.WEB_PARSER_DOM_STABLE_SAMPLE_MS, 500));
  const domStableSamples = Math.max(2, toInt(args?.domStableSamples ?? pluginEnv.WEB_PARSER_DOM_STABLE_SAMPLES, 4));
  const scrollSteps = Math.max(0, toInt(args?.scrollSteps ?? pluginEnv.WEB_PARSER_SCROLL_STEPS, 6));
  const scrollStepPx = Math.max(200, toInt(args?.scrollStepPx ?? pluginEnv.WEB_PARSER_SCROLL_STEP_PX, 1200));
  const scrollDelayMs = Math.max(50, toInt(args?.scrollDelayMs ?? pluginEnv.WEB_PARSER_SCROLL_DELAY_MS, 250));
  const loadingPatternsVal = args?.loadingPatterns ?? pluginEnv.WEB_PARSER_LOADING_PATTERNS ?? 'loading,加载中,请稍候,正在加载,请稍后,please wait,正在编译,processing,spinner';
  const loadingPatterns = Array.isArray(loadingPatternsVal) ? loadingPatternsVal : String(loadingPatternsVal).split(',');
  const loadingPatternsNorm = loadingPatterns.map((s) => String(s).trim()).filter(Boolean);
  const minGoodLen = Math.max(50, toInt(args?.minGoodLen ?? pluginEnv.WEB_PARSER_MIN_GOOD_LEN, 200));
  const blockTypesVal = args?.blockTypes ?? pluginEnv.WEB_PARSER_BLOCK_TYPES ?? 'image,font,media';
  const blockTypesList = Array.isArray(blockTypesVal) ? blockTypesVal : String(blockTypesVal).split(',');
  const blockTypes = new Set(blockTypesList.map((s) => String(s).trim()).filter(Boolean));
  const readyExpression = args?.readyExpression || pluginEnv.WEB_PARSER_READY_EXPRESSION || '';
  const blockUrlVal = args?.blockUrlPatterns ?? pluginEnv.WEB_PARSER_BLOCK_URL_PATTERNS ?? '';
  const blockUrlPatterns = (Array.isArray(blockUrlVal) ? blockUrlVal : String(blockUrlVal).split(',')).map((s)=>String(s).trim()).filter(Boolean);

  const timeout = Number.isFinite(timeoutFromArgs) && timeoutFromArgs > 0
    ? timeoutFromArgs
    : (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : defaultTimeoutMs);

  const maxBytes = Number.isFinite(maxBytesFromArgs) && maxBytesFromArgs > 0
    ? maxBytesFromArgs
    : (Number.isFinite(envMaxLen) && envMaxLen > 0 ? envMaxLen : 200000);

  return { timeout, maxBytes, enableJS, waitSelector, ua, useProxy, proxyServer, viewportWidth, viewportHeight, maxRetries, retryDelay,
    waitStrategy, maxTotalWaitMs, netIdleIdleMs, domStableSampleMs, domStableSamples, scrollSteps, scrollStepPx, scrollDelayMs,
    loadingPatterns: loadingPatternsNorm, minGoodLen, blockTypes, readyExpression, blockUrlPatterns };
}

function extractFromHtml(html) {
  try {
    // Strip scripts/styles/comments and tags
    let cleaned = String(html || '')
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    const titleMatch = cleaned.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Prefer main/article blocks
    const mainMatch = cleaned.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
    const scope = mainMatch ? mainMatch[1] : (cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || cleaned);

    const text = scope
      .replace(/<[^>]+>/g, ' ') // drop tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return { title, text, metadata: {} };
  } catch {
    return { title: '', text: '', metadata: {} };
  }
}

async function extractWithReadability(html) {
  try {
    const { JSDOM } = await import('jsdom');
    const { Readability } = await import('@mozilla/readability');
    const dom = new JSDOM(html);
    const article = new Readability(dom.window.document).parse();
    if (article) {
      const title = (article.title || '').trim();
      const text = (article.textContent || '').replace(/\s+/g, ' ').trim();
      return { title, text, metadata: { by: 'readability' } };
    }
  } catch {}
  return null;
}

async function extractSmart(html) {
  const r = await extractWithReadability(html);
  if (r && r.text) return r;
  return extractFromHtml(html);
}

async function tryAxios(url, { timeout, ua, useProxy, proxyServer }) {
  const cfg = {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache'
    },
    timeout,
    maxRedirects: 5,
  };
  if (useProxy && proxyServer) {
    try {
      const u = new URL(proxyServer);
      cfg.proxy = { protocol: u.protocol.replace(':',''), host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) };
    } catch {}
  }
  const res = await axios.get(url, cfg);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const ctype = res.headers['content-type'] || '';
  if (!ctype.includes('text/html')) throw new Error(`Unsupported content-type: ${ctype}`);
  const { title, text, metadata } = await extractSmart(res.data);
  return { method: 'axios', title, text, metadata, headers: res.headers };
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function waitNetworkIdle(page, { idleMs = 800, timeout = 10000 } = {}) {
  let inflight = 0; let last = Date.now();
  const inc = () => { inflight++; last = Date.now(); };
  const dec = () => { inflight = Math.max(0, inflight - 1); last = Date.now(); };
  page.on('request', inc);
  page.on('requestfinished', dec);
  page.on('requestfailed', dec);
  try {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (inflight === 0 && Date.now() - last >= idleMs) return true;
      await sleep(100);
    }
    return false;
  } finally {
    page.off('request', inc);
    page.off('requestfinished', dec);
    page.off('requestfailed', dec);
  }
}

async function waitDomStable(page, { sampleMs = 500, stableSamples = 4, timeout = 10000 } = {}) {
  const start = Date.now();
  let last = null; let stable = 0;
  while (Date.now() - start < timeout) {
    const cur = await page.evaluate(() => {
      const body = document.body;
      const len = body ? (body.innerText || '').length : 0;
      const nodes = document.querySelectorAll('*').length;
      return { len, nodes };
    });
    if (last && cur.len === last.len && cur.nodes === last.nodes) {
      stable += 1;
      if (stable >= stableSamples) return true;
    } else {
      stable = 0;
    }
    last = cur;
    await sleep(sampleMs);
  }
  return false;
}

async function scrollToBottom(page, { steps = 6, stepPx = 1200, delayMs = 250 } = {}) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((y) => window.scrollBy(0, y), stepPx);
    await sleep(delayMs);
  }
}

function hasLoadingPhrases(text, patterns = []) {
  const s = String(text || '').toLowerCase();
  return patterns.some((p) => p && s.includes(String(p).toLowerCase()));
}

async function tryPuppeteer(url, cfg) {
  const { timeout, ua, waitSelector, viewportWidth, viewportHeight, useProxy, proxyServer, maxRetries, retryDelay,
    waitStrategy, maxTotalWaitMs, netIdleIdleMs, domStableSampleMs, domStableSamples, scrollSteps, scrollStepPx, scrollDelayMs,
    loadingPatterns, minGoodLen, blockTypes, readyExpression, blockUrlPatterns } = cfg;
  let puppeteer;
  try {
    ({ default: puppeteer } = await import('puppeteer'));
  } catch {
    throw new Error('puppeteer not installed');
  }

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor,BlinkGenPropertyTrees',
    '--disable-extensions-http-throttling',
    '--disable-component-extensions-with-background-pages',
    `--window-size=${viewportWidth},${viewportHeight}`,
  ];
  if (useProxy && proxyServer) launchArgs.push(`--proxy-server=${proxyServer}`);

  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let browser;
    try {
      logger.debug?.('web_parser:puppeteer', { attempt, url });
      const launchOpts = { headless: 'new', timeout: Math.min(timeout, 60000), ignoreHTTPSErrors: true, args: launchArgs };
      // Windows tweaks
      if (process.platform === 'win32') {
        launchOpts.args.push('--disable-gpu-sandbox');
      }
      // Linux tweaks
      if (process.platform === 'linux') {
        launchOpts.args.push('--no-zygote','--single-process');
      }
      browser = await puppeteer.launch(launchOpts);
      const page = await browser.newPage();
      await page.setViewport({ width: viewportWidth, height: viewportHeight });
      await page.setUserAgent(ua);
      await page.setDefaultNavigationTimeout(timeout);
      await page.setDefaultTimeout(timeout);

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const rt = req.resourceType();
        const u = req.url();
        const blockedByType = blockTypes.has(rt);
        const blockedByPattern = blockUrlPatterns.some((s) => s && u.includes(s));
        if (blockedByType || blockedByPattern || /analytics|tracking|ads/i.test(u)) req.abort();
        else req.continue();
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      try { await page.waitForFunction(() => document.readyState === 'complete', { timeout: Math.min(timeout, 10000) }); } catch {}

      const start = Date.now();
      const remain = () => Math.max(0, maxTotalWaitMs - (Date.now() - start));

      // Auto wait strategy: network idle -> scroll -> DOM stable -> optional selector
      if (waitStrategy === 'auto' || waitStrategy === 'network_idle') {
        if (remain() > 0) await waitNetworkIdle(page, { idleMs: netIdleIdleMs, timeout: Math.min(10000, remain()) });
      }
      if ((waitStrategy === 'auto' || waitStrategy === 'scroll') && remain() > 0) {
        await scrollToBottom(page, { steps: scrollSteps, stepPx: scrollStepPx, delayMs: scrollDelayMs });
      }
      if (waitStrategy === 'auto' || waitStrategy === 'dom_stable') {
        if (remain() > 0) await waitDomStable(page, { sampleMs: domStableSampleMs, stableSamples: domStableSamples, timeout: Math.min(10000, remain()) });
      }
      if (waitSelector && remain() > 0) {
        try { await page.waitForSelector(waitSelector, { timeout: Math.min(8000, remain()) }); } catch {}
      }
      if (readyExpression && remain() > 0) {
        try { await page.waitForFunction(readyExpression, { timeout: Math.min(8000, remain()) }); } catch {}
      }

      const html = await page.content();
      let { title, text, metadata } = await extractSmart(html);
      // If low-quality content, try one more scroll and stability wait within remaining time
      if ((text.length < minGoodLen || hasLoadingPhrases(text, loadingPatterns)) && remain() > 0) {
        await scrollToBottom(page, { steps: Math.ceil(scrollSteps / 2), stepPx: scrollStepPx, delayMs: scrollDelayMs });
        if (remain() > 0) await waitDomStable(page, { sampleMs: domStableSampleMs, stableSamples: domStableSamples, timeout: Math.min(8000, remain()) });
        const html2 = await page.content();
        const ex2 = await extractSmart(html2);
        if (ex2 && (ex2.text || '').length >= text.length) ({ title, text, metadata } = ex2);
      }
      return { method: 'puppeteer', title, text, metadata };
    } catch (e) {
      lastErr = e;
      logger.warn?.('web_parser:puppeteer attempt failed', { attempt, error: String(e?.message || e) });
      if (attempt < maxRetries) await sleep(retryDelay * attempt);
    } finally {
      try { await browser?.close(); } catch {}
    }
  }
  throw lastErr || new Error('puppeteer failed');
}

export default async function webParserHandler(args, options = {}) {
  const url = processUrl(args?.url);
  if (!url) return { success: false, code: 'INVALID_URL', error: 'URL格式无效' };

  const penv = options.pluginEnv || {};
  const timeoutDefault = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000;
  const cfg = resolveConfig(args, penv, timeoutDefault);

  // Try puppeteer first if enabled; if result质量不佳则尝试axios并择优
  let result = null;
  let errorPuppeteer = null;
  let pRes = null;
  if (cfg.enableJS) {
    try { pRes = await tryPuppeteer(url, cfg); } catch (e) { errorPuppeteer = e; }
  }
  let aRes = null;
  if (pRes && (pRes.text || '').length >= cfg.minGoodLen) {
    result = pRes;
  } else {
    try { aRes = await tryAxios(url, cfg); } catch (e) { aRes = null; }
    if (pRes && aRes) {
      result = (pRes.text || '').length >= (aRes.text || '').length ? pRes : aRes;
    } else {
      result = pRes || aRes; // 可能为 null，交由下方错误处理
    }
  }
  if (!result) throw new Error(errorPuppeteer ? `puppeteer失败且axios也失败: ${String(errorPuppeteer)}` : '无法获取页面');

  // Truncate text by maxBytes (char-based)
  let text = result.text || '';
  if (text.length > cfg.maxBytes) {
    text = text.slice(0, cfg.maxBytes) + `\n...[截断 ${text.length - cfg.maxBytes} 字符]`;
  }

  const data = {
    url,
    method: result.method,
    title: result.title,
    text,
    metadata: result.metadata,
    puppeteerError: errorPuppeteer ? String(errorPuppeteer.message || errorPuppeteer) : undefined,
  };

  return { success: true, data };
}
