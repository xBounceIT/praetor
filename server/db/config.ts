import type { PoolConfig } from 'pg';

const envInt = (
  key: string,
  fallback: number,
  { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {},
) => {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

const DEFAULT_DB_PORT = 5432;

export const getDbConnectionConfig = (): Pick<
  PoolConfig,
  'host' | 'port' | 'database' | 'user' | 'password'
> => ({
  host: process.env.DB_HOST || 'localhost',
  port: envInt('DB_PORT', DEFAULT_DB_PORT, { min: 1, max: 65_535 }),
  database: process.env.DB_NAME || 'praetor',
  user: process.env.DB_USER || 'praetor',
  password: process.env.DB_PASSWORD || 'praetor',
});

export const createDbPoolConfig = (overrides: PoolConfig = {}): PoolConfig => ({
  ...getDbConnectionConfig(),
  max: envInt('PG_POOL_MAX', 10, { min: 1 }),
  idleTimeoutMillis: envInt('PG_POOL_IDLE_TIMEOUT_MS', 300_000, { min: 0 }),
  connectionTimeoutMillis: envInt('PG_POOL_CONN_TIMEOUT_MS', 2_000, { min: 0 }),
  ...overrides,
});

export const getDbConnectionLabel = () => {
  const { host, port, database } = getDbConnectionConfig();
  return `${host}:${port}/${database}`;
};
