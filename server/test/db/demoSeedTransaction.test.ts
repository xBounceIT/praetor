import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realBootstrapAdmin from '../../db/bootstrapAdmin.ts';
import { COMPATIBILITY_DEFAULTS, DEMO_EXPECTED_COUNTS } from '../../db/demoSeedManifest.ts';
import * as realDbIndex from '../../db/index.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';

type RunDemoSeedRefresh = typeof import('../../db/demoSeed.ts').runDemoSeedRefresh;

type CountStub = {
  match: (sql: string, params: readonly unknown[]) => boolean;
  count: number;
};

type FakeClientOptions = {
  countStubs?: CountStub[];
};

type FakeQueryResult = { rows: unknown[]; rowCount: number };

const dbIndexSnap = { ...realDbIndex };
const bootstrapAdminSnap = { ...realBootstrapAdmin };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };

const poolConnectMock = mock();
const ensureBootstrapAdminMock = mock();
const syncTopManagerAssignmentsForUserMock = mock();

let runDemoSeedRefresh: RunDemoSeedRefresh;

beforeAll(async () => {
  mock.module('../../db/index.ts', () => ({
    ...dbIndexSnap,
    default: { connect: poolConnectMock },
  }));
  mock.module('../../db/bootstrapAdmin.ts', () => ({
    ...bootstrapAdminSnap,
    ensureBootstrapAdmin: ensureBootstrapAdminMock,
  }));
  mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
    ...userAssignmentsRepoSnap,
    syncTopManagerAssignmentsForUser: syncTopManagerAssignmentsForUserMock,
  }));

  ({ runDemoSeedRefresh } = await import('../../db/demoSeed.ts'));
});

afterAll(() => {
  mock.module('../../db/index.ts', () => dbIndexSnap);
  mock.module('../../db/bootstrapAdmin.ts', () => bootstrapAdminSnap);
  mock.module('../../repositories/userAssignmentsRepo.ts', () => userAssignmentsRepoSnap);
});

const createFakeClient = (options: FakeClientOptions = {}) => {
  const queries: Array<{ sql: string; params: readonly unknown[] }> = [];
  const released: { value: boolean } = { value: false };

  const matchCount = (sql: string, params: readonly unknown[]): number | null => {
    for (const stub of options.countStubs ?? []) {
      if (stub.match(sql, params)) return stub.count;
    }
    return null;
  };

  const client = {
    query: mock(
      async (textOrConfig: unknown, params?: readonly unknown[]): Promise<FakeQueryResult> => {
        const sql = typeof textOrConfig === 'string' ? textOrConfig : String(textOrConfig);
        queries.push({ sql, params: params ?? [] });

        const overrideCount = matchCount(sql, params ?? []);
        if (overrideCount !== null) {
          return { rows: [{ count: overrideCount }], rowCount: overrideCount };
        }

        if (/^\s*SELECT\s+id\s+FROM\s+users/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/COUNT\(\*\)/i.test(sql)) {
          // Default: pretend every verification step finds exactly the expected number of
          // rows so unfocused steps don't muddy the failure under inspection.
          const tableMatch = sql.match(/FROM\s+([a-z_]+)/i);
          const tableName = tableMatch ? tableMatch[1] : '';
          const expected = (DEMO_EXPECTED_COUNTS as Record<string, number | undefined>)[tableName];
          return { rows: [{ count: expected ?? 0 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    ),
    release: mock(() => {
      released.value = true;
    }),
  };

  return { client, queries, released };
};

beforeEach(() => {
  poolConnectMock.mockReset();
  ensureBootstrapAdminMock.mockReset();
  syncTopManagerAssignmentsForUserMock.mockReset();
  ensureBootstrapAdminMock.mockResolvedValue('u1');
  syncTopManagerAssignmentsForUserMock.mockResolvedValue(undefined);
});

const seedSqlNames = (queries: Array<{ sql: string }>) => queries.map(({ sql }) => sql.trim());

describe('runDemoSeedRefresh', () => {
  test('rolls back when verification reports a mismatch and never issues COMMIT', async () => {
    const { client } = createFakeClient({
      countStubs: [
        {
          // Force the very first verification step (users) to under-report and trip a mismatch.
          match: (sql) =>
            /FROM\s+users\s+WHERE\s+id\s*=\s*ANY/i.test(sql) && /COUNT\(\*\)/i.test(sql),
          count: 0,
        },
      ],
    });
    poolConnectMock.mockResolvedValue(client);

    await expect(runDemoSeedRefresh({ source: 'manual' })).rejects.toThrow(
      /Demo seed verification failed/,
    );

    const sqlSeen = seedSqlNames(client.query.mock.calls.map(([sql]) => ({ sql: String(sql) })));
    expect(sqlSeen).toContain('BEGIN');
    expect(sqlSeen).toContain('ROLLBACK');
    expect(sqlSeen).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    // Post-commit sync must not happen when verification failed.
    expect(syncTopManagerAssignmentsForUserMock).not.toHaveBeenCalled();
  });

  test('verification SELECT statements run on the same client (inside the transaction)', async () => {
    const { client } = createFakeClient({
      countStubs: [
        {
          match: (sql) =>
            /FROM\s+users\s+WHERE\s+id\s*=\s*ANY/i.test(sql) && /COUNT\(\*\)/i.test(sql),
          count: 0,
        },
      ],
    });
    poolConnectMock.mockResolvedValue(client);

    await expect(runDemoSeedRefresh({ source: 'manual' })).rejects.toThrow();

    const calls = client.query.mock.calls.map(([sql]) => String(sql));
    const beginIdx = calls.findIndex((sql) => /^\s*BEGIN/.test(sql));
    const rollbackIdx = calls.findIndex(
      (sql) => /^\s*ROLLBACK\b/.test(sql) && !/SAVEPOINT/.test(sql),
    );
    const firstCountIdx = calls.findIndex((sql) => /COUNT\(\*\)/i.test(sql));

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(rollbackIdx).toBeGreaterThan(beginIdx);
    expect(firstCountIdx).toBeGreaterThan(beginIdx);
    expect(firstCountIdx).toBeLessThan(rollbackIdx);
  });

  test('cleanupDemoNamespace also clears compatibility default IDs', async () => {
    const { client } = createFakeClient({
      countStubs: [
        // Trip verification so we don't have to drive the full happy path,
        // we just need to inspect cleanup SQL/params seen prior to verification.
        {
          match: (sql) =>
            /FROM\s+users\s+WHERE\s+id\s*=\s*ANY/i.test(sql) && /COUNT\(\*\)/i.test(sql),
          count: 0,
        },
      ],
    });
    poolConnectMock.mockResolvedValue(client);

    await expect(runDemoSeedRefresh({ source: 'manual' })).rejects.toThrow();

    const flatParams = (params: readonly unknown[]): unknown[] =>
      params.flatMap((p) => (Array.isArray(p) ? p : [p]));

    const cleanupCalls = client.query.mock.calls.filter(([sql]) =>
      /^\s*DELETE\s+FROM/i.test(String(sql)),
    );

    const tasksCleanup = cleanupCalls.filter(([sql]) =>
      /^\s*DELETE\s+FROM\s+tasks\b/i.test(String(sql)),
    );
    const projectsCleanup = cleanupCalls.filter(([sql]) =>
      /^\s*DELETE\s+FROM\s+projects\b/i.test(String(sql)),
    );
    const clientsCleanup = cleanupCalls.filter(([sql]) =>
      /^\s*DELETE\s+FROM\s+clients\b/i.test(String(sql)),
    );

    const taskParams = tasksCleanup.flatMap(([, params]) => flatParams(params ?? []));
    const projectParams = projectsCleanup.flatMap(([, params]) => flatParams(params ?? []));
    const clientParams = clientsCleanup.flatMap(([, params]) => flatParams(params ?? []));

    for (const id of COMPATIBILITY_DEFAULTS.tasks) {
      expect(taskParams).toContain(id);
    }
    for (const id of COMPATIBILITY_DEFAULTS.projects) {
      expect(projectParams).toContain(id);
    }
    for (const id of COMPATIBILITY_DEFAULTS.clients) {
      expect(clientParams).toContain(id);
    }
  });

  test('commits only when verification passes and runs post-commit sync', async () => {
    const { client } = createFakeClient();
    poolConnectMock.mockResolvedValue(client);

    const result = await runDemoSeedRefresh({ source: 'manual' });

    expect(result.demoSeedingEnabled).toBe(true);
    expect(result.source).toBe('manual');

    const calls = client.query.mock.calls.map(([sql]) => String(sql));
    const beginIdx = calls.findIndex((sql) => /^\s*BEGIN/.test(sql));
    const commitIdx = calls.findIndex((sql) => /^\s*COMMIT/.test(sql));
    const firstCountIdx = calls.findIndex((sql) => /COUNT\(\*\)/i.test(sql));

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThan(beginIdx);
    expect(firstCountIdx).toBeGreaterThan(beginIdx);
    // Verification must execute BEFORE commit.
    expect(firstCountIdx).toBeLessThan(commitIdx);
    expect(
      calls.filter((sql) => /^\s*ROLLBACK\b/.test(sql) && !/SAVEPOINT/.test(sql)),
    ).toHaveLength(0);
    // Top-manager sync runs only after commit succeeds.
    expect(syncTopManagerAssignmentsForUserMock).toHaveBeenCalled();
  });
});
