import dotenv from 'dotenv';
import type { FastifyRequest } from 'fastify';
import { getRedis, type RedisClient } from './redis.ts';

dotenv.config();

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS' | 'ERROR';

type CacheGetSetResult<T> = {
  status: CacheStatus;
  value: T;
};

const envInt = (key: string, fallback: number) => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const TTL_LIST_SECONDS = envInt('REDIS_TTL_LIST_SECONDS', 120);
export const TTL_SETTINGS_SECONDS = envInt('REDIS_TTL_SETTINGS_SECONDS', 300);
export const TTL_PERMISSIONS_SECONDS = envInt('REDIS_TTL_PERMISSIONS_SECONDS', 300);
export const TTL_AUTH_USER_SECONDS = envInt('REDIS_TTL_AUTH_USER_SECONDS', 10);

const prefix = () => process.env.REDIS_PREFIX || 'praetor';

const versionKey = (ns: string) => `${prefix()}:ver:${ns}`;
const cacheKey = (ns: string, version: number, keySuffix: string) =>
  `${prefix()}:cache:${ns}:v${version}:${keySuffix}`;

const ensureVersionInitialized = async (redis: RedisClient, ns: string) => {
  // NX avoids clobbering existing version, but ensures INCR starts from 1 -> 2.
  await redis.set(versionKey(ns), '1', { NX: true });
};

export const getNamespaceVersion = async (ns: string): Promise<number> => {
  const redis = await getRedis();
  if (!redis) return 1;

  try {
    await ensureVersionInitialized(redis, ns);
    const v = await redis.get(versionKey(ns));
    const n = v ? Number.parseInt(v, 10) : 1;
    return Number.isFinite(n) ? n : 1;
  } catch {
    return 1;
  }
};

export const bumpNamespaceVersion = async (ns: string) => {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await ensureVersionInitialized(redis, ns);
    await redis.incr(versionKey(ns));
  } catch {
    // best-effort
  }
};

export const shouldBypassCache = (request: FastifyRequest) => {
  const cc = request.headers['cache-control'];
  if (typeof cc === 'string' && cc.toLowerCase().includes('no-cache')) return true;

  const query = request.query as Record<string, unknown> | undefined;
  const v = query?.noCache ?? query?.no_cache;
  if (v === 1 || v === '1' || v === true || v === 'true') return true;

  return false;
};

export const setCacheHeader = (reply: { header: (k: string, v: string) => void }, status: CacheStatus) => {
  reply.header('x-praetor-cache', status);
};

export const cacheGetSetJson = async <T>(
  ns: string,
  keySuffix: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
  opts?: { bypass?: boolean },
): Promise<CacheGetSetResult<T>> => {
  if (opts?.bypass) {
    return { status: 'BYPASS', value: await compute() };
  }

  const redis = await getRedis();
  if (!redis) {
    return { status: 'BYPASS', value: await compute() };
  }

  try {
    const ver = await getNamespaceVersion(ns);
    const key = cacheKey(ns, ver, keySuffix);

    const hit = await redis.get(key);
    if (hit !== null) {
      try {
        return { status: 'HIT', value: JSON.parse(hit) as T };
      } catch {
        // Corrupted value; drop and treat as miss.
        await redis.del(key);
      }
    }

    const value = await compute();
    try {
      await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return { status: 'MISS', value };
    } catch {
      return { status: 'ERROR', value };
    }
  } catch {
    return { status: 'ERROR', value: await compute() };
  }
};
