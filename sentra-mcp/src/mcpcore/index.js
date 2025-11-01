import logger from '../logger/index.js';
import { loadPlugins } from '../plugins/loader.js';
import MCPExternalManager from '../mcp/client/manager.js';
import { Metrics } from '../metrics/index.js';
import { executeToolWithTimeout } from '../utils/executeTool.js';
import { ok, fail } from '../utils/result.js';
import { getRedis, isRedisReady } from '../redis/client.js';
import { config } from '../config/index.js';
import { Governance } from '../governance/policy.js';
import crypto from 'node:crypto';

function makeAINameLocal(name) {
  return `local__${name}`;
}
function makeAINameExternal(serverId, name) {
  return `ext__${serverId}__${name}`;
}

// Local fallback for cooldown when Redis is unavailable
const __localCooldown = new Map(); // aiName -> epochMs
function __setLocalCooldown(aiName, ms) {
  if (!ms) return;
  const until = Date.now() + Math.max(1, ms);
  __localCooldown.set(aiName, until);
}
function __getLocalRemainMs(aiName) {
  const until = __localCooldown.get(aiName) || 0;
  const remain = until - Date.now();
  return remain > 0 ? remain : 0;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, Math.max(0, ms))); }

export class MCPCore {
  constructor() {
    this.localTools = [];
    this.externalMgr = new MCPExternalManager();
    this.externalTools = []; // { name, description, inputSchema, __provider: external:<id> }
    this.toolIndex = new Map(); // aiName -> descriptor
  }

  async init() {
    // Load local plugins
    this.localTools = await loadPlugins();
    // Connect external servers and fetch their tools
    await this.externalMgr.connectAll();
    this.externalTools = await this.externalMgr.listAllTools();
    this.rebuildIndex();
  }

  rebuildIndex() {
    this.toolIndex.clear();
    // Local
    for (const t of this.localTools) {
      const aiName = makeAINameLocal(t.name);
      this.toolIndex.set(aiName, { ...t, aiName, providerType: 'local' });
    }
    // External
    for (const t of this.externalTools) {
      const p = (t.__provider || '').split(':');
      const serverId = p[1] || 'unknown';
      const aiName = makeAINameExternal(serverId, t.name);
      // Map MCP tool shape to our shape
      const inputSchema = t.inputSchema || t.input_schema || { type: 'object', properties: {} };
      this.toolIndex.set(aiName, {
        aiName,
        name: t.name,
        description: t.description || '',
        inputSchema,
        providerType: 'external',
        serverId,
      });
    }
  }

  getAvailableTools() {
    const out = [];
    for (const item of this.toolIndex.values()) {
      out.push({
        aiName: item.aiName,
        name: item.name,
        provider: item.providerType === 'local' ? 'local' : `external:${item.serverId}`,
        description: item.description || '',
        inputSchema: item.inputSchema || { type: 'object', properties: {} },
        scope: item.scope || 'global',
        tenant: item.tenant || 'default',
        cooldownMs: Number(item.cooldownMs || config.planner.cooldownDefaultMs || 0),
      });
    }
    return out;
  }

  buildOpenAITools() {
    return this.getAvailableTools().map((t) => ({
      type: 'function',
      function: {
        name: t.aiName,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  // Richer detail for SDK export/listing
  getAvailableToolsDetailed() {
    const out = [];
    for (const item of this.toolIndex.values()) {
      const base = {
        aiName: item.aiName,
        name: item.name,
        description: item.description || '',
        inputSchema: item.inputSchema || { type: 'object', properties: {} },
        scope: item.scope || 'global',
        tenant: item.tenant || 'default',
        cooldownMs: Number(item.cooldownMs || 0),
        timeoutMs: Number(item.timeoutMs || 0),
        providerType: item.providerType,
        meta: item.meta || {},
      };
      if (item.providerType === 'local') {
        out.push({ ...base, provider: 'local' });
      } else if (item.providerType === 'external') {
        out.push({ ...base, provider: `external:${item.serverId}`, serverId: item.serverId });
      } else {
        out.push({ ...base, provider: 'unknown' });
      }
    }
    return out;
  }

  async enforceCooldown(aiName, cooldownMs) {
    if (!cooldownMs) return;
    try {
      if (!isRedisReady()) {
        // Redis 未就绪：使用本地回退冷却
        const remain = __getLocalRemainMs(aiName);
        if (remain > 0) {
          const err = Object.assign(new Error(`Cooldown active for ${aiName}, retry in ${Math.ceil(remain / 1000)}s`), { code: 'COOLDOWN_ACTIVE', ttl: Math.ceil(remain / 1000), remainMs: remain, fallback: 'local' });
          throw err;
        }
        __setLocalCooldown(aiName, cooldownMs);
        logger.warn?.('Redis not ready — using local fallback cooldown', { aiName, cooldownMs });
        return;
      }
      const r = getRedis();
      const key = `${config.redis.metricsPrefix}:cooldown:${aiName}`;
      // 原子：SET NX PX，成功表示获取到“冷却锁”，失败表示已有锁（处于冷却期）
      const setRes = await r.set(key, '1', 'PX', Math.max(1, Math.floor(cooldownMs)), 'NX');
      if (setRes !== 'OK') {
        // 已在冷却中，查询剩余毫秒
        const pttl = await r.pttl(key);
        const remainMs = Number.isFinite(pttl) && pttl > 0 ? pttl : 0;
        const remainSec = Math.ceil(remainMs / 1000);
        const err = Object.assign(new Error(`Cooldown active for ${aiName}, retry in ${remainSec}s`), { code: 'COOLDOWN_ACTIVE', ttl: remainSec, remainMs });
        throw err;
      }
    } catch (e) {
      // 若为正常的冷却命中，向上传递，让上层按业务处理；
      // 仅在 Redis 访问异常时跳过冷却但告警。
      if (e && e.code === 'COOLDOWN_ACTIVE') {
        throw e;
      }
      // Fallback to local in-process cooldown to avoid thrashing when Redis is down
      const remain = __getLocalRemainMs(aiName);
      if (remain > 0) {
        const err = Object.assign(new Error(`Cooldown active for ${aiName}, retry in ${Math.ceil(remain / 1000)}s`), { code: 'COOLDOWN_ACTIVE', ttl: Math.ceil(remain / 1000), remainMs: remain, fallback: 'local' });
        throw err;
      }
      __setLocalCooldown(aiName, cooldownMs);
      logger.warn?.('Cooldown enforcement skipped (Redis issue) — using local fallback', { aiName, cooldownMs, error: String(e) });
    }
  }

  // --- Tool result cache helpers ---
  static _stableStringify(value) {
    const seen = new WeakSet();
    const stringify = (v) => {
      if (v === null || typeof v !== 'object') return JSON.stringify(v);
      if (seen.has(v)) return '"[Circular]"';
      seen.add(v);
      if (Array.isArray(v)) return '[' + v.map((it) => stringify(it)).join(',') + ']';
      const keys = Object.keys(v).sort();
      const parts = [];
      for (const k of keys) parts.push(JSON.stringify(k) + ':' + stringify(v[k]));
      return '{' + parts.join(',') + '}';
    };
    return stringify(value);
  }

  static _hashArgs(aiName, args) {
    const base = `${aiName}::` + MCPCore._stableStringify(args || {});
    return crypto.createHash('sha1').update(base).digest('hex');
  }

  static _shouldUseCache(aiName) {
    const cfg = config.planner?.toolCache || {};
    if (!cfg.enable) return false;
    const deny = Array.isArray(cfg.denylist) && cfg.denylist.length ? new Set(cfg.denylist) : null;
    if (deny && deny.has(aiName)) return false;
    const allow = Array.isArray(cfg.allowlist) ? cfg.allowlist : [];
    // empty allowlist => allow all
    if (!allow.length) return true;
    return allow.includes(aiName);
  }

  static _cacheKey(aiName, hash) {
    const pfx = String(config.redis?.metricsPrefix || 'sentra:mcp:metrics');
    return `${pfx}:cache:tool:${aiName}:${hash}`;
  }

  async callByAIName(aiName, args, options = {}) {
    const t = this.toolIndex.get(aiName);
    if (!t) return fail(new Error(`Tool not found: ${aiName}`), 'NOT_FOUND');

    const start = Date.now();
    try { await Metrics.incrCall(t.name, t.providerType); } catch (e) { logger.warn?.('metrics.incrCall failed', { e: String(e) }); }

    // Cache: attempt to serve from Redis based on aiName+args hash (only after governance check passes)
    const cacheEnabled = MCPCore._shouldUseCache(aiName) && isRedisReady();
    const ttlSec = Math.max(1, Number(config.planner?.toolCache?.ttlSeconds || 600));
    let cacheKey = null;

    const maxCooldownRetries = Math.max(0, Number(config.planner?.cooldownFunctionRetry ?? 0));
    let attempt = 0;
    while (true) {
      try {
        // Governance check
        const auth = Governance.isAllowed(t, options);
        if (!auth.allowed) {
          try { await Metrics.incrFailure(t.name, t.providerType, 'FORBIDDEN'); } catch {}
          try { await Metrics.addLatency(t.name, Date.now() - start, t.providerType); } catch {}
          return fail(new Error(auth.reason || 'Forbidden'), 'FORBIDDEN');
        }

        // Check cache after governance passes
        if (cacheEnabled) {
          try {
            const h = MCPCore._hashArgs(aiName, args);
            cacheKey = MCPCore._cacheKey(aiName, h);
            const r = getRedis();
            const cached = await r.get(cacheKey);
            if (cached) {
              let obj; try { obj = JSON.parse(cached); } catch { obj = null; }
              if (obj && obj.success === true) {
                logger.info('命中工具结果缓存', { label: 'MCP', aiName, provider: t.providerType, cacheKey });
                return obj; // shape already ok()
              }
            }
          } catch (e) {
            logger.warn?.('读取工具缓存失败（忽略）', { label: 'MCP', aiName, error: String(e) });
          }
        }

        if (t.providerType === 'local') {
          if (t._validate && !t._validate(args || {})) {
            const e = new Error('Validation failed');
            e.details = t._validate.errors;
            throw e;
          }
          await this.enforceCooldown(aiName, t.cooldownMs);
          const selectedTimeout = Number(t.timeoutMs) > 0 ? Number(t.timeoutMs) : config.planner.toolTimeoutMs;
          const opt = { ...options, pluginEnv: t.pluginEnv || {}, timeoutMs: selectedTimeout };
          const res = await executeToolWithTimeout(() => t.handler(args || {}, opt), selectedTimeout);
          try { await Metrics.incrSuccess(t.name, 'local'); } catch {}
          try { await Metrics.addLatency(t.name, Date.now() - start, 'local'); } catch {}
          const out = ok(res?.data ?? res, 'OK', { provider: 'local' });
          // Write cache on success
          if (cacheEnabled && out?.success === true && cacheKey) {
            try {
              const r = getRedis();
              await r.setex(cacheKey, ttlSec, JSON.stringify(out));
              logger.debug?.('写入工具结果缓存', { label: 'MCP', aiName, cacheKey, ttlSec });
            } catch (e) {
              logger.warn?.('写入工具缓存失败（忽略）', { label: 'MCP', aiName, error: String(e) });
            }
          }
          return out;
        }
        if (t.providerType === 'external') {
          await this.enforceCooldown(aiName, t.cooldownMs);
          // 外部工具：移除 schedule 字段（不传递给下游服务器）
          const { schedule, ...forwardArgs } = args || {};
          const res = await executeToolWithTimeout(() => this.externalMgr.callTool(t.serverId, t.name, forwardArgs), config.planner.toolTimeoutMs);
          try { await Metrics.incrSuccess(t.name, `external:${t.serverId}`); } catch {}
          try { await Metrics.addLatency(t.name, Date.now() - start, `external:${t.serverId}`); } catch {}
          // Wrap external result
          const out = ok(res?.content ?? res?.result ?? res, 'OK', { provider: `external:${t.serverId}` });
          if (cacheEnabled && out?.success === true && cacheKey) {
            try {
              const r = getRedis();
              await r.setex(cacheKey, ttlSec, JSON.stringify(out));
              logger.debug?.('写入工具结果缓存', { label: 'MCP', aiName, cacheKey, ttlSec });
            } catch (e) {
              logger.warn?.('写入工具缓存失败（忽略）', { label: 'MCP', aiName, error: String(e) });
            }
          }
          return out;
        }
        throw new Error(`Unknown providerType for ${aiName}`);
      } catch (e) {
        if (e && e.code === 'COOLDOWN_ACTIVE' && attempt < maxCooldownRetries) {
          attempt += 1;
          const remainMs = Number(e.remainMs || (e.ttl ? e.ttl * 1000 : (t.cooldownMs || 1000)));
          const jitter = Math.floor(100 + Math.random() * 200);
          const waitMs = Math.max(200, remainMs + jitter);
          logger.info('因冷却命中，等待后重试', { label: 'RETRY', aiName, waitMs, remainMs, attempt });
          await sleep(waitMs);
          continue; // retry once
        }
        const code = e.code || (String(e?.message || '').toLowerCase().includes('timeout') ? 'TIMEOUT' : 'ERR');
        try { await Metrics.incrFailure(t.name, t.providerType, code); } catch {}
        try { await Metrics.addLatency(t.name, Date.now() - start, t.providerType); } catch {}
        const extra = { provider: t.providerType };
        if (code === 'COOLDOWN_ACTIVE') {
          extra.remainMs = Number(e.remainMs || (e.ttl ? e.ttl * 1000 : (t.cooldownMs || 0)));
          extra.ttl = Number(e.ttl || (extra.remainMs ? Math.ceil(extra.remainMs / 1000) : 0));
        }
        return fail(e, code, extra);
      }
    }
  }

  // Simple heuristic ranking of tools for a given objective string
  rankTools(objective, limit = 5) {
    const q = (objective || '').toLowerCase();
    const arr = this.getAvailableTools().map((t) => {
      const nameScore = t.name.toLowerCase().includes(q) ? 3 : 0;
      const descScore = (t.description || '').toLowerCase().split(/\W+/).reduce((acc, w) => acc + (q.includes(w) ? 1 : 0), 0);
      return { t, score: nameScore + descScore };
    });
    return arr.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.t);
  }
}

export default MCPCore;
