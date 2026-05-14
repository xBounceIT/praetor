import { describe, expect, test } from 'bun:test';
import { type DbConnectionConfig, getDbConnectionConfig, getDbSslConfig } from '../../db/config.ts';
import drizzleConfig from '../../drizzle.config.ts';

// The drizzle.config.ts is evaluated at import time, so its `dbCredentials`
// reflect whatever process.env was at that moment. Comparing against another
// call to `getDbConnectionConfig()` only proves they agree when env vars are
// stable across the test run — which is the normal case under `bun run test`.
// The intent is to prevent regression to the old hard-coded "tempo" defaults
// that diverged from the runtime defaults of "praetor".

type DrizzleCredentials = DbConnectionConfig & { ssl: ReturnType<typeof getDbSslConfig> };
const credentials = (drizzleConfig as { dbCredentials: DrizzleCredentials }).dbCredentials;

describe('drizzle.config.ts', () => {
  test('uses the runtime DB connection defaults (no longer "tempo")', () => {
    const runtime = getDbConnectionConfig();
    expect(credentials.host).toBe(runtime.host);
    expect(credentials.port).toBe(runtime.port);
    expect(credentials.database).toBe(runtime.database);
    expect(credentials.user).toBe(runtime.user);
    expect(credentials.password).toBe(runtime.password);
  });

  test('database/user/password defaults are never "tempo"', () => {
    expect(credentials.database).not.toBe('tempo');
    expect(credentials.user).not.toBe('tempo');
    expect(credentials.password).not.toBe('tempo');
  });

  test('honors the same DB_SSL setting as the runtime pool', () => {
    expect(credentials.ssl).toEqual(getDbSslConfig());
  });
});
