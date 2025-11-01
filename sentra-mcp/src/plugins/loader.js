import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import logger from '../logger/index.js';
import dotenv from 'dotenv';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

function normalizeTool(def) {
  if (!def?.name || typeof def.handler !== 'function') {
    throw new Error('Invalid plugin tool: name and handler required');
  }
  return {
    name: def.name,
    description: def.description || '',
    inputSchema: def.inputSchema || { type: 'object', properties: {}, additionalProperties: false },
    scope: def.scope || 'global',
    tenant: def.tenant || 'default',
    cooldownMs: def.cooldownMs || 0,
    provider: def.provider || 'local',
    timeoutMs: def.timeoutMs || 0,
    pluginEnv: def.pluginEnv || {},
    meta: def.meta || {},
    handler: def.handler,
  };
}

export async function loadPlugins(pluginsDir) {
  // Build candidate directories in priority order
  const candidates = [];
  if (pluginsDir) candidates.push(path.resolve(pluginsDir));
  if (process.env.PLUGINS_DIR) candidates.push(path.resolve(process.env.PLUGINS_DIR));
  try {
    // library root: <sentra-mcp>/plugins (robust when consumed as a dependency)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const libRoot = path.resolve(__dirname, '../..');
    candidates.push(path.join(libRoot, 'plugins'));
  } catch {}
  // project cwd fallback
  candidates.push(path.resolve(process.cwd(), 'plugins'));
  // de-duplicate candidates
  const seen = new Set();
  const uniq = [];
  for (const c of candidates) {
    const abs = path.resolve(c);
    if (!seen.has(abs)) { seen.add(abs); uniq.push(abs); }
  }
  // pick the first existing candidate
  let baseDir = uniq.find((d) => fs.existsSync(d));
  if (!baseDir) {
    try { logger.warn('未找到可用的插件目录', { label: 'PLUGIN', candidates: uniq }); } catch {}
    return [];
  }
  try { logger.info('扫描插件目录', { label: 'PLUGIN', baseDir, candidates: uniq }); } catch {}

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const fileNames = entries.filter((e) => e.isFile() && e.name.endsWith('.js')).map((e) => e.name);

  const tools = [];
  const loadedNames = new Set();

  try { logger.info('扫描插件目录', { label: 'PLUGIN', baseDir, folders: dirNames.length, files: fileNames.length }); } catch {}

  // 1) Load folder-based plugins first
  for (const dir of dirNames) {
    const base = path.join(baseDir, dir);
    const cfgPath = path.join(base, 'config.json');
    const idxPath = path.join(base, 'index.js');
    const envPath = path.join(base, '.env');
    const envAltPath = path.join(base, 'config.env');
    try {
      let cfg = {};
      if (fs.existsSync(cfgPath)) {
        try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch (e) { logger.error(`Invalid JSON in ${dir}/config.json`, { error: String(e) }); }
      }

      // Per-plugin env overrides (parse BEFORE importing handler so we can decide to skip disabled plugins)
      let penv = {};
      try {
        if (fs.existsSync(envPath)) {
          penv = { ...penv, ...dotenv.parse(fs.readFileSync(envPath)) };
        } else if (fs.existsSync(envAltPath)) {
          penv = { ...penv, ...dotenv.parse(fs.readFileSync(envAltPath)) };
        }
      } catch (e) {
        logger.warn(`Failed to parse plugin .env for ${dir}`, { error: String(e) });
      }

      // Evaluate PLUGIN_ENABLED flag. Default: enabled=true when missing.
      let enabled = true;
      try {
        const raw = penv.PLUGIN_ENABLED ?? penv.PLUGIN_ENABLE ?? penv.ENABLED;
        if (raw !== undefined) {
          const s = String(raw).trim().toLowerCase();
          if (s === '0' || s === 'false' || s === 'off' || s === 'no') enabled = false;
          else if (s === '1' || s === 'true' || s === 'on' || s === 'yes') enabled = true;
          // any other value keeps default 'true'
        }
      } catch {}

      if (!enabled) {
        const name = cfg.name || dir;
        try { logger.info('跳过插件（.env 关闭）', { label: 'PLUGIN', name, dir, reason: 'PLUGIN_ENABLED=false' }); } catch {}
        continue; // do not import handler, do not expose in SDK
      }

      // Load handler only for enabled plugins
      let handler;
      if (fs.existsSync(idxPath)) {
        const mod = await import(pathToFileURL(idxPath).href);
        const payload = mod.default ?? mod;
        if (typeof payload === 'function') handler = payload;
        else if (typeof payload?.handler === 'function') handler = payload.handler;
      }
      if (!handler && typeof cfg?.handler === 'function') handler = cfg.handler; // not typical, but allow

      if (!handler) {
        logger.warn(`Plugin folder missing handler: ${dir}`);
        continue;
      }

      // Optional per-plugin timeout: .env overrides config.json
      let timeoutMs = 0;
      const fromCfg = Number(cfg.timeoutMs);
      const fromEnvA = Number(penv.PLUGIN_TIMEOUT_MS);
      const fromEnvB = Number(penv.TOOL_TIMEOUT_MS);
      // Priority: .env.PLUGIN_TIMEOUT_MS > .env.TOOL_TIMEOUT_MS > config.timeoutMs
      if (!Number.isNaN(fromEnvA) && fromEnvA > 0) timeoutMs = fromEnvA;
      else if (!Number.isNaN(fromEnvB) && fromEnvB > 0) timeoutMs = fromEnvB;
      else if (!Number.isNaN(fromCfg) && fromCfg > 0) timeoutMs = fromCfg;

      const def = {
        name: cfg.name || dir,
        description: cfg.description || '',
        inputSchema: cfg.inputSchema || { type: 'object', properties: {}, additionalProperties: false },
        scope: cfg.scope || 'global',
        tenant: cfg.tenant || 'default',
        cooldownMs: cfg.cooldownMs || 0,
        provider: cfg.provider || 'local',
        timeoutMs,
        pluginEnv: penv,
        meta: cfg.meta || {},
        handler,
      };
      const tool = normalizeTool(def);
      tool._validate = ajv.compile(tool.inputSchema);
      tools.push(tool);
      loadedNames.add(tool.name);
      const envKeys = Object.keys(penv || {}).length;
      logger.info(`Loaded plugin folder: ${dir}`, { label: 'PLUGIN', name: tool.name, path: base, timeoutMs, envKeys });
    } catch (e) {
      logger.error(`Failed to load plugin folder: ${dir}`, { label: 'PLUGIN', error: String(e) });
    }
  }

  // 2) Fallback: legacy single-file plugins (*.js)
  for (const file of fileNames) {
    try {
      const full = path.join(baseDir, file);
      const mod = await import(pathToFileURL(full).href);
      const payload = mod.default ?? mod;
      const defs = Array.isArray(payload) ? payload : [payload];
      let count = 0;
      for (const d of defs) {
        const probe = d?.name;
        if (probe && loadedNames.has(probe)) {
          logger.info(`Skip legacy file due to duplicate name`, { label: 'PLUGIN', file, name: probe });
          continue;
        }
        const tool = normalizeTool(d);
        tool._validate = ajv.compile(tool.inputSchema);
        tools.push(tool);
        if (tool.name) loadedNames.add(tool.name);
        count += 1;
      }
      logger.info(`Loaded plugin file: ${file}`, { label: 'PLUGIN', count });
    } catch (e) {
      logger.error(`Failed to load plugin file: ${file}`, { label: 'PLUGIN', error: String(e) });
    }
  }

  try { logger.info('插件加载完成', { label: 'PLUGIN', total: tools.length }); } catch {}
  return tools;
}

export default loadPlugins;
