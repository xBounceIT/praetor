import dotenv from 'dotenv';
import { createClient } from 'redis';

dotenv.config();

export type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let clientPromise: Promise<RedisClient | null> | null = null;
let lastErrorLogAt = 0;

const logRedisError = (label: string, err: unknown) => {
  const now = Date.now();
  // Avoid spamming logs if Redis is down/unreachable.
  if (now - lastErrorLogAt < 30_000) return;
  lastErrorLogAt = now;
  console.error(label, err);
};

const isRedisEnabled = () => {
  const enabled = process.env.REDIS_ENABLED?.toLowerCase();
  if (enabled === 'false' || enabled === '0') return false;
  return !!process.env.REDIS_URL;
};

export const getRedis = async (): Promise<RedisClient | null> => {
  if (!isRedisEnabled()) return null;
  if (client) return client;

  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const url = process.env.REDIS_URL;
        if (!url) return null;
        const c = createClient({ url });

        c.on('error', (err) => {
          logRedisError('Redis error:', err);
        });

        await c.connect();
        client = c;
        return c;
      } catch (err) {
        logRedisError('Redis connection failed:', err);
        client = null;
        clientPromise = null;
        return null;
      }
    })();
  }

  return clientPromise;
};

export const closeRedis = async () => {
  const c = client;
  client = null;
  clientPromise = null;

  if (!c) return;
  try {
    await c.quit();
  } catch (err) {
    // Best-effort shutdown. If quit fails (e.g. broken connection), ignore.
    logRedisError('Redis quit failed:', err);
    try {
      await c.disconnect();
    } catch {
      // ignore
    }
  }
};
