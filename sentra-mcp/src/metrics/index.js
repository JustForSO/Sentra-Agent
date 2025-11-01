import { getRedis } from '../redis/client.js';
import { config } from '../config/index.js';

const prefix = config.redis.metricsPrefix;

function key(...parts) {
  return [prefix, ...parts].join(':');
}

export const Metrics = {
  async incrCall(tool, provider = 'local') {
    const r = getRedis();
    await r.hincrby(key('calls', provider), tool, 1);
  },
  async incrSuccess(tool, provider = 'local') {
    const r = getRedis();
    await r.hincrby(key('success', provider), tool, 1);
  },
  async incrFailure(tool, provider = 'local', code = 'ERR') {
    const r = getRedis();
    await r.hincrby(key('failure', provider), tool, 1);
    await r.hincrby(key('failure_code', provider, code), tool, 1);
  },
  async addLatency(tool, ms, provider = 'local') {
    const r = getRedis();
    await r.hincrbyfloat(key('latency_sum', provider), tool, ms);
    await r.hincrby(key('latency_count', provider), tool, 1);
  },
  async getSummary(tool, provider = 'local') {
    const r = getRedis();
    const [calls, success, failure, sum, count] = await r
      .multi()
      .hget(key('calls', provider), tool)
      .hget(key('success', provider), tool)
      .hget(key('failure', provider), tool)
      .hget(key('latency_sum', provider), tool)
      .hget(key('latency_count', provider), tool)
      .exec();
    const c = Number(calls?.[1] || 0);
    const s = Number(success?.[1] || 0);
    const f = Number(failure?.[1] || 0);
    const total = Number(sum?.[1] || 0);
    const cnt = Number(count?.[1] || 0);
    return {
      calls: c,
      success: s,
      failure: f,
      successRate: c ? s / c : 0,
      avgLatencyMs: cnt ? total / cnt : 0,
    };
  },
};

export default Metrics;
