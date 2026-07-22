import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbPoolConfig, getDbConnectionConfig, getDbSslConfig } from '../../db/config.ts';

const DB_ENV_KEYS = [
  'NODE_ENV',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'DB_SSL',
  'DB_SSL_CA',
  'DB_SSL_CA_FILE',
  'PG_POOL_MAX',
  'PG_POOL_IDLE_TIMEOUT_MS',
  'PG_POOL_CONN_TIMEOUT_MS',
] as const;

let envSnapshot: Partial<Record<(typeof DB_ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  envSnapshot = {};
  for (const key of DB_ENV_KEYS) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  for (const key of DB_ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('getDbConnectionConfig', () => {
  test('uses local defaults in the explicit test runtime', () => {
    expect(getDbConnectionConfig()).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'praetor',
      user: 'praetor',
      password: 'praetor',
    });
  });

  test('requires DB_PASSWORD in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getDbConnectionConfig()).toThrow('DB_PASSWORD is required');
  });

  test('uses an explicit DB_PASSWORD in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_PASSWORD = 'production-secret';
    expect(getDbConnectionConfig().password).toBe('production-secret');
  });

  test('requires DB_PASSWORD when the runtime mode is unspecified', () => {
    delete process.env.NODE_ENV;
    expect(() => getDbConnectionConfig()).toThrow('DB_PASSWORD is required');
  });

  test('keeps the local fallback in the explicit development runtime', () => {
    process.env.NODE_ENV = 'development';
    expect(getDbConnectionConfig().password).toBe('praetor');
  });

  test('reads overrides from env vars', () => {
    process.env.DB_HOST = 'db.example.com';
    process.env.DB_PORT = '6543';
    process.env.DB_NAME = 'erp';
    process.env.DB_USER = 'erp_user';
    process.env.DB_PASSWORD = 's3cret';
    expect(getDbConnectionConfig()).toEqual({
      host: 'db.example.com',
      port: 6543,
      database: 'erp',
      user: 'erp_user',
      password: 's3cret',
    });
  });

  test('falls back to default port when DB_PORT is non-numeric or out of range', () => {
    process.env.DB_PORT = 'not-a-number';
    expect(getDbConnectionConfig().port).toBe(5432);
    process.env.DB_PORT = '0';
    expect(getDbConnectionConfig().port).toBe(5432);
    process.env.DB_PORT = '70000';
    expect(getDbConnectionConfig().port).toBe(5432);
  });
});

describe('getDbSslConfig', () => {
  test('is disabled (false) by default to preserve the bundled docker-compose stack', () => {
    expect(getDbSslConfig()).toBe(false);
  });

  test('DB_SSL=false / disable yields false', () => {
    process.env.DB_SSL = 'false';
    expect(getDbSslConfig()).toBe(false);
    process.env.DB_SSL = 'disable';
    expect(getDbSslConfig()).toBe(false);
  });

  test('DB_SSL=true / require yields { rejectUnauthorized: false } (encrypt without CA validation)', () => {
    process.env.DB_SSL = 'true';
    expect(getDbSslConfig()).toEqual({ rejectUnauthorized: false });
    process.env.DB_SSL = 'require';
    expect(getDbSslConfig()).toEqual({ rejectUnauthorized: false });
  });

  test('DB_SSL=verify-full enforces CA and hostname validation', () => {
    process.env.DB_SSL = 'verify-full';
    const ssl = getDbSslConfig();
    expect(ssl).toEqual({ rejectUnauthorized: true });
    expect(ssl).not.toHaveProperty('checkServerIdentity');
  });

  test('DB_SSL=verify-ca enforces CA but skips hostname validation (libpq parity)', () => {
    process.env.DB_SSL = 'verify-ca';
    const ssl = getDbSslConfig() as {
      rejectUnauthorized: boolean;
      checkServerIdentity?: () => undefined;
    };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(typeof ssl.checkServerIdentity).toBe('function');
    expect(ssl.checkServerIdentity?.()).toBeUndefined();
  });

  test('DB_SSL_CA inline PEM is included in the ssl config', () => {
    process.env.DB_SSL = 'verify-full';
    process.env.DB_SSL_CA = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----';
    expect(getDbSslConfig()).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----',
    });
  });

  test('DB_SSL_CA_FILE is read from disk and included in the ssl config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'praetor-ssl-ca-'));
    const file = join(dir, 'ca.pem');
    const pem = '-----BEGIN CERTIFICATE-----\nFROMFILE\n-----END CERTIFICATE-----\n';
    writeFileSync(file, pem);
    try {
      process.env.DB_SSL = 'verify-full';
      process.env.DB_SSL_CA_FILE = file;
      expect(getDbSslConfig()).toEqual({ rejectUnauthorized: true, ca: pem });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('inline DB_SSL_CA wins over DB_SSL_CA_FILE when both are set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'praetor-ssl-ca-'));
    const file = join(dir, 'ca.pem');
    writeFileSync(file, 'FILE_CA');
    try {
      process.env.DB_SSL = 'verify-full';
      process.env.DB_SSL_CA = 'INLINE_CA';
      process.env.DB_SSL_CA_FILE = file;
      expect(getDbSslConfig()).toEqual({ rejectUnauthorized: true, ca: 'INLINE_CA' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('unknown DB_SSL value falls back to false', () => {
    process.env.DB_SSL = 'wibble';
    expect(getDbSslConfig()).toBe(false);
  });
});

describe('createDbPoolConfig', () => {
  test('includes ssl in the pool config (defaults to false)', () => {
    const pool = createDbPoolConfig();
    expect(pool.ssl).toBe(false);
    expect(pool.database).toBe('praetor');
  });

  test('propagates DB_SSL through to pool.ssl', () => {
    process.env.DB_SSL = 'require';
    const pool = createDbPoolConfig();
    expect(pool.ssl).toEqual({ rejectUnauthorized: false });
  });

  test('overrides win over both env vars and computed ssl', () => {
    process.env.DB_SSL = 'require';
    const pool = createDbPoolConfig({ ssl: true });
    expect(pool.ssl).toBe(true);
  });
});
