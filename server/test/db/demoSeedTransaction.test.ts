import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realBcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import * as realBootstrapAdmin from '../../db/bootstrapAdmin.ts';
import {
  DEMO_EXPECTED_COUNTS,
  DEMO_PRICING_SEMANTICS_VERSION,
  DEMO_USERS,
} from '../../db/demoSeedManifest.ts';
import * as realDbIndex from '../../db/index.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';

type DemoSeedModule = typeof import('../../db/demoSeed.ts');
type VerificationTable = keyof typeof DEMO_EXPECTED_COUNTS;

const dbIndexSnap = { ...realDbIndex };
const bootstrapAdminSnap = { ...realBootstrapAdmin };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const bcryptSnap = { ...(realBcrypt as Record<string, unknown>) };

const connectMock = mock();
const ensureBootstrapAdminMock = mock();
const syncTopManagerAssignmentsForUserMock = mock();
const releaseMock = mock();
const queryMock = mock();
const bcryptHashMock = mock();

const sqlCalls: string[] = [];
const events: string[] = [];
let mismatchedTable: VerificationTable | null = null;

const client = {
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
  release: releaseMock,
} as unknown as PoolClient;

let demoSeed: DemoSeedModule;
const DEMO_PASSWORD_ENV = 'DEMO_USER_PASSWORD';
const SECURE_DEMO_PASSWORD = 'operator-chosen-demo-password';
const originalDemoPasswordEnv = process.env[DEMO_PASSWORD_ENV];

beforeAll(async () => {
  mock.module('../../db/index.ts', () => ({
    ...dbIndexSnap,
    default: { connect: connectMock },
  }));
  mock.module('../../db/bootstrapAdmin.ts', () => ({
    ...bootstrapAdminSnap,
    ensureBootstrapAdmin: ensureBootstrapAdminMock,
  }));
  mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
    ...userAssignmentsRepoSnap,
    syncTopManagerAssignmentsForUser: syncTopManagerAssignmentsForUserMock,
  }));
  mock.module('bcryptjs', () => ({
    default: { hash: bcryptHashMock },
    hash: bcryptHashMock,
  }));

  demoSeed = await import('../../db/demoSeed.ts');
});

afterAll(() => {
  mock.module('../../db/index.ts', () => dbIndexSnap);
  mock.module('../../db/bootstrapAdmin.ts', () => bootstrapAdminSnap);
  mock.module('../../repositories/userAssignmentsRepo.ts', () => userAssignmentsRepoSnap);
  mock.module('bcryptjs', () => bcryptSnap);
  if (originalDemoPasswordEnv === undefined) {
    delete process.env[DEMO_PASSWORD_ENV];
  } else {
    process.env[DEMO_PASSWORD_ENV] = originalDemoPasswordEnv;
  }
});

beforeEach(() => {
  for (const mockedFn of [
    connectMock,
    ensureBootstrapAdminMock,
    syncTopManagerAssignmentsForUserMock,
    releaseMock,
    queryMock,
    bcryptHashMock,
  ]) {
    mockedFn.mockReset();
  }

  sqlCalls.length = 0;
  events.length = 0;
  mismatchedTable = null;
  process.env[DEMO_PASSWORD_ENV] = SECURE_DEMO_PASSWORD;

  connectMock.mockResolvedValue(client);
  bcryptHashMock.mockResolvedValue('$2a$operator-demo-password-hash');
  ensureBootstrapAdminMock.mockResolvedValue(undefined);
  syncTopManagerAssignmentsForUserMock.mockImplementation(async () => {
    events.push('sync-assignments');
  });
  queryMock.mockImplementation(async (sql: string) => {
    const normalizedSql = sql.trim();
    sqlCalls.push(normalizedSql);

    const verificationMatch = normalizedSql.match(
      /^SELECT COUNT\(\*\)::int AS count FROM ([a-z_]+) /,
    );
    if (verificationMatch) {
      const table = verificationMatch[1] as VerificationTable;
      const expected = DEMO_EXPECTED_COUNTS[table];
      if (expected === undefined) throw new Error(`Unexpected verification table: ${table}`);
      events.push(`verify-${table}`);
      return {
        rowCount: 1,
        rows: [{ count: table === mismatchedTable ? expected - 1 : expected }],
      };
    }

    if (normalizedSql === 'BEGIN' || normalizedSql === 'COMMIT' || normalizedSql === 'ROLLBACK') {
      events.push(normalizedSql.toLowerCase());
    }

    return { rowCount: 1, rows: [] };
  });
});

describe('demo seed transaction finalization', () => {
  test('refuses to seed in production before reading the password or touching the database', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await expect(demoSeed.runDemoSeedRefresh({ source: 'startup' })).rejects.toThrow(
        /NODE_ENV=production/,
      );
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }

    expect(bcryptHashMock).not.toHaveBeenCalled();
    expect(ensureBootstrapAdminMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  test('refuses to seed without an operator-provided demo password', async () => {
    delete process.env[DEMO_PASSWORD_ENV];

    await expect(demoSeed.runDemoSeedRefresh({ source: 'manual' })).rejects.toThrow(
      'DEMO_USER_PASSWORD must be set to a non-default value.',
    );

    expect(bcryptHashMock).not.toHaveBeenCalled();
    expect(ensureBootstrapAdminMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  test.each([
    'password',
    'change-me-strong-demo-password',
  ])('refuses to seed with the known demo password %s', async (knownPassword) => {
    process.env[DEMO_PASSWORD_ENV] = knownPassword;

    await expect(demoSeed.runDemoSeedRefresh({ source: 'startup' })).rejects.toThrow(
      'DEMO_USER_PASSWORD must be set to a non-default value.',
    );

    expect(bcryptHashMock).not.toHaveBeenCalled();
    expect(ensureBootstrapAdminMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  test('applies one password hash to every demo user and revokes existing credentials', async () => {
    await demoSeed.runDemoSeedRefresh({ source: 'manual' });

    expect(bcryptHashMock).toHaveBeenCalledTimes(1);
    expect(bcryptHashMock).toHaveBeenCalledWith(SECURE_DEMO_PASSWORD, 12);
    const userInsert = queryMock.mock.calls.find(([sql]) =>
      String(sql).trim().startsWith('INSERT INTO users ('),
    );
    expect(userInsert).toBeDefined();
    const params = userInsert?.[1] as unknown[];
    expect(params.filter((value) => value === '$2a$operator-demo-password-hash')).toHaveLength(
      DEMO_USERS.length,
    );
    const insertSql = String(userInsert?.[0]);
    expect(insertSql).toContain('session_version = users.session_version + 1');
    expect(insertSql).toContain('token_version = users.token_version + 1');
  });

  test('rolls back all seed work when dataset verification fails', async () => {
    mismatchedTable = 'users';

    await expect(demoSeed.runDemoSeedRefresh({ source: 'manual' })).rejects.toThrow(
      `users expected ${DEMO_EXPECTED_COUNTS.users} got ${DEMO_EXPECTED_COUNTS.users - 1}`,
    );

    expect(events.indexOf('sync-assignments')).toBeGreaterThan(events.indexOf('begin'));
    expect(events.indexOf('verify-users')).toBeGreaterThan(events.indexOf('sync-assignments'));
    expect(events.indexOf('rollback')).toBeGreaterThan(events.indexOf('verify-users'));
    expect(sqlCalls).not.toContain('COMMIT');
    expect(syncTopManagerAssignmentsForUserMock.mock.calls[0]?.[1]).toBeDefined();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  test('rolls back before verification when assignment synchronization fails', async () => {
    syncTopManagerAssignmentsForUserMock.mockImplementation(async () => {
      events.push('sync-assignments');
      throw new Error('forced assignment synchronization failure');
    });

    await expect(demoSeed.runDemoSeedRefresh({ source: 'manual' })).rejects.toThrow(
      'forced assignment synchronization failure',
    );

    expect(events.indexOf('sync-assignments')).toBeGreaterThan(events.indexOf('begin'));
    expect(events).not.toContain('verify-users');
    expect(events.at(-1)).toBe('rollback');
    expect(sqlCalls).not.toContain('COMMIT');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  test('commits only after assignments and every verification query succeed', async () => {
    const result = await demoSeed.runDemoSeedRefresh({ source: 'manual' });

    expect(events.indexOf('sync-assignments')).toBeGreaterThan(events.indexOf('begin'));
    expect(events.indexOf('verify-users')).toBeGreaterThan(events.indexOf('sync-assignments'));
    expect(events.indexOf('commit')).toBeGreaterThan(events.indexOf('verify-time_entries'));
    expect(events).not.toContain('rollback');
    expect(result.verificationCountsByTable).toEqual(DEMO_EXPECTED_COUNTS);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  test('verifies every commercial item table uses the current pricing contract', async () => {
    await demoSeed.runDemoSeedRefresh({ source: 'manual' });

    const pricingVerificationTables = sqlCalls
      .filter((sql) =>
        sql.includes(`pricing_semantics_version = ${DEMO_PRICING_SEMANTICS_VERSION}`),
      )
      .map((sql) => sql.match(/^SELECT COUNT\(\*\)::int AS count FROM ([a-z_]+) /)?.[1]);

    expect(pricingVerificationTables).toEqual([
      'quote_items',
      'customer_offer_items',
      'sale_items',
      'invoice_items',
      'supplier_quote_items',
      'supplier_sale_items',
      'supplier_invoice_items',
    ]);
  });
});
