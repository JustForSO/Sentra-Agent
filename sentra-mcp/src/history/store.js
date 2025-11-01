import { getRedis } from '../redis/client.js';
import { config } from '../config/index.js';

const prefix = config.redis.contextPrefix;

const k = (runId, ...parts) => [prefix, 'run', runId, ...parts].join(':');

export const HistoryStore = {
  async append(runId, entry) {
    try {
      const r = getRedis();
      await r.rpush(k(runId, 'history'), JSON.stringify({ ts: Date.now(), ...entry }));
    } catch {}
  },
  async list(runId, start = 0, stop = -1) {
    try {
      const r = getRedis();
      const items = await r.lrange(k(runId, 'history'), start, stop);
      return items.map((x) => {
        try { return JSON.parse(x); } catch { return { raw: x }; }
      });
    } catch {
      return [];
    }
  },
  async len(runId) {
    try {
      const r = getRedis();
      return r.llen(k(runId, 'history'));
    } catch {
      return 0;
    }
  },
  async setPlan(runId, plan) {
    try {
      const r = getRedis();
      await r.set(k(runId, 'plan'), JSON.stringify(plan));
    } catch {}
  },
  async getPlan(runId) {
    try {
      const r = getRedis();
      const v = await r.get(k(runId, 'plan'));
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  async setSummary(runId, summary) {
    try {
      const r = getRedis();
      await r.set(k(runId, 'summary'), JSON.stringify({ ts: Date.now(), summary }));
    } catch {}
  },
  async getSummary(runId) {
    try {
      const r = getRedis();
      const v = await r.get(k(runId, 'summary'));
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
};

export default HistoryStore;
