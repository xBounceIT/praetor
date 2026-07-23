import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';
import { createChildLogger } from '../utils/logger.ts';
import {
  INSECURE_DEFAULT_DB_PASSWORDS,
  readRequiredNonDefaultEnv,
} from '../utils/runtimeConfig.ts';

const logger = createChildLogger({ module: 'db/config' });

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

const getDbPassword = (): string => {
  const runtime = process.env.NODE_ENV?.trim().toLowerCase();
  if (runtime === 'development' || runtime === 'test') {
    const password = process.env.DB_PASSWORD?.trim();
    if (!password) throw new Error('DB_PASSWORD is required.');
    return password;
  }

  return readRequiredNonDefaultEnv('DB_PASSWORD', INSECURE_DEFAULT_DB_PASSWORDS, {
    missing: 'DB_PASSWORD is required.',
  });
};

export interface DbConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export const getDbConnectionConfig = (): DbConnectionConfig => ({
  host: process.env.DB_HOST || 'localhost',
  port: envInt('DB_PORT', DEFAULT_DB_PORT, { min: 1, max: 65_535 }),
  database: process.env.DB_NAME || 'praetor',
  user: process.env.DB_USER || 'praetor',
  password: getDbPassword(),
});

const invalidSslWarnings = new Set<string>();
const warnInvalidSsl = (value: string) => {
  if (invalidSslWarnings.has(value)) return;
  invalidSslWarnings.add(value);
  logger.warn(
    { value },
    'Ignoring unknown DB_SSL value. Expected one of: disable, false, true, require, verify-ca, verify-full.',
  );
};

const readSslCa = (): string | undefined => {
  const inline = process.env.DB_SSL_CA?.trim();
  if (inline) return inline;
  const file = process.env.DB_SSL_CA_FILE?.trim();
  if (!file) return undefined;
  return readFileSync(file, 'utf8');
};

// `node-postgres` does not honor PGSSLMODE — only libpq does — so SSL must be
// configured here in code. Defaults to off to preserve the bundled docker-compose
// stack (Postgres image has no TLS). Enable via DB_SSL=require|verify-ca|verify-full.
// Every enabled mode validates the certificate; verify-ca alone skips the hostname check.
export const getDbSslConfig = (): PoolConfig['ssl'] => {
  const raw = process.env.DB_SSL?.trim().toLowerCase();
  if (!raw || raw === 'false' || raw === 'disable') return false;
  if (raw === 'true' || raw === 'require' || raw === 'verify-full' || raw === 'verify-ca') {
    const ca = readSslCa();
    return {
      rejectUnauthorized: true,
      ...(ca && { ca }),
      ...(raw === 'verify-ca' && { checkServerIdentity: () => undefined }),
    };
  }
  warnInvalidSsl(raw);
  return false;
};

export const createDbPoolConfig = (overrides: PoolConfig = {}): PoolConfig => ({
  ...getDbConnectionConfig(),
  ssl: getDbSslConfig(),
  max: envInt('PG_POOL_MAX', 10, { min: 1 }),
  idleTimeoutMillis: envInt('PG_POOL_IDLE_TIMEOUT_MS', 300_000, { min: 0 }),
  connectionTimeoutMillis: envInt('PG_POOL_CONN_TIMEOUT_MS', 2_000, { min: 0 }),
  ...overrides,
});

export const getDbConnectionLabel = () => {
  const { host, port, database } = getDbConnectionConfig();
  return `${host}:${port}/${database}`;
};
