import Redis from 'ioredis';
import { config } from '../config/index.js';
import logger from '../logger/index.js';

let redis;

export function getRedis() {
  if (!redis) {
    redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      db: config.redis.db,
      password: config.redis.password,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
    });

    redis.on('error', (err) => logger.error('Redis error', { label: 'REDIS', err: String(err) }));
    redis.on('connect', () => logger.info('Redis connected', { label: 'REDIS', host: config.redis.host, port: config.redis.port, db: config.redis.db }));

    logger.info('Redis connecting', { label: 'REDIS', host: config.redis.host, port: config.redis.port, db: config.redis.db });
    redis.connect().catch((e) => logger.error('Redis connect failed', { label: 'REDIS', e: String(e) }));
  }
  return redis;
}

export function isRedisReady() {
  try {
    const r = getRedis();
    return r?.status === 'ready';
  } catch {
    return false;
  }
}

export default getRedis;
