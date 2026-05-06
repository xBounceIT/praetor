import type { PoolConfig } from 'pg';

const envInt = (key: string, fallback: number) => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const getDbConnectionConfig = (): Pick<
  PoolConfig,
  'host' | 'port' | 'database' | 'user' | 'password'
> => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tempo',
  user: process.env.DB_USER || 'tempo',
  password: process.env.DB_PASSWORD || 'tempo',
});

export const createDbPoolConfig = (overrides: PoolConfig = {}): PoolConfig => ({
  ...getDbConnectionConfig(),
  max: envInt('PG_POOL_MAX', 10),
  idleTimeoutMillis: envInt('PG_POOL_IDLE_TIMEOUT_MS', 300_000),
  connectionTimeoutMillis: envInt('PG_POOL_CONN_TIMEOUT_MS', 2_000),
  ...overrides,
});

export const getDbConnectionLabel = () => {
  const { host, port, database } = getDbConnectionConfig();
  return `${host}:${port}/${database}`;
};
