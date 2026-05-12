import { describe, expect, test } from 'bun:test';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { hasDrizzleMigrationLedger, prepareDatabaseForStartup } from '../../db/startup.ts';

type FakeClient = {
  calls: string[];
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>;
};

const makeQueryResult = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
  rows,
  rowCount: rows.length,
  command: '',
  oid: 0,
  fields: [],
});

const makeClient = (ledgerExists: boolean): FakeClient => {
  const calls: string[] = [];

  return {
    calls,
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params: unknown[] = [],
    ): Promise<QueryResult<T>> {
      calls.push(`${text} ${JSON.stringify(params)}`);

      if (text.includes('to_regclass')) {
        return makeQueryResult([{ exists: ledgerExists } as unknown as T]);
      }

      return makeQueryResult<T>([]);
    },
  };
};

describe('hasDrizzleMigrationLedger', () => {
  test('checks for the Drizzle ledger table by regclass', async () => {
    const client = makeClient(true);

    await expect(hasDrizzleMigrationLedger(client)).resolves.toBe(true);

    expect(client.calls).toEqual([
      'SELECT to_regclass($1) IS NOT NULL AS "exists" ["drizzle.__drizzle_migrations"]',
    ]);
  });
});

describe('prepareDatabaseForStartup', () => {
  test('skips historical schema bootstrap when the Drizzle ledger exists', async () => {
    const events: string[] = [];
    const client = makeClient(true);

    const result = await prepareDatabaseForStartup({
      withLock: async (callback) => {
        events.push('lock');
        try {
          return await callback(client as unknown as PoolClient);
        } finally {
          events.push('unlock');
        }
      },
      readSchemaSql: () => {
        events.push('read-schema');
        return 'schema sql';
      },
      runMigrations: async () => {
        events.push('migrate');
      },
      verifyReadiness: async () => {
        events.push('readiness');
        return { appliedMigrations: 1, expectedMigrations: 1, probedTables: ['users'] };
      },
      logger: {
        info: (message: string) => events.push(`log:${message}`),
      },
    });

    expect(result).toEqual({
      appliedMigrations: 1,
      expectedMigrations: 1,
      probedTables: ['users'],
    });
    expect(events).toEqual([
      'lock',
      'log:Historical schema bootstrap skipped; Drizzle migration ledger exists',
      'migrate',
      'log:Drizzle migrations applied or already up to date',
      'readiness',
      'unlock',
    ]);
    expect(client.calls).toEqual([
      'SELECT to_regclass($1) IS NOT NULL AS "exists" ["drizzle.__drizzle_migrations"]',
    ]);
  });

  test('applies historical schema before migrations when the Drizzle ledger is missing', async () => {
    const events: string[] = [];
    const client = makeClient(false);

    await prepareDatabaseForStartup({
      withLock: async (callback) => {
        events.push('lock');
        try {
          return await callback(client as unknown as PoolClient);
        } finally {
          events.push('unlock');
        }
      },
      readSchemaSql: () => {
        events.push('read-schema');
        return 'CREATE TABLE historical();';
      },
      runMigrations: async () => {
        events.push('migrate');
      },
      verifyReadiness: async () => {
        events.push('readiness');
        return { appliedMigrations: 1, expectedMigrations: 1, probedTables: [] };
      },
      logger: {
        info: (message: string) => events.push(`log:${message}`),
      },
    });

    expect(events).toEqual([
      'lock',
      'read-schema',
      'log:Historical schema bootstrap applied',
      'migrate',
      'log:Drizzle migrations applied or already up to date',
      'readiness',
      'unlock',
    ]);
    expect(client.calls).toEqual([
      'SELECT to_regclass($1) IS NOT NULL AS "exists" ["drizzle.__drizzle_migrations"]',
      'CREATE TABLE historical(); []',
    ]);
  });

  test('keeps bootstrap and migrations inside the advisory lock boundary', async () => {
    const events: string[] = [];
    const client = makeClient(false);

    await prepareDatabaseForStartup({
      withLock: async (callback) => {
        events.push('lock');
        const result = await callback(client as unknown as PoolClient);
        events.push('unlock');
        return result;
      },
      readSchemaSql: () => {
        events.push('read-schema');
        return 'schema sql';
      },
      runMigrations: async () => {
        events.push('migrate');
      },
      verifyReadiness: async () => {
        events.push('readiness');
        return { appliedMigrations: 1, expectedMigrations: 1, probedTables: [] };
      },
      logger: { info: () => undefined },
    });

    expect(events).toEqual(['lock', 'read-schema', 'migrate', 'readiness', 'unlock']);
  });

  test('releases the lock when startup preparation fails', async () => {
    const events: string[] = [];
    const client = makeClient(true);

    await expect(
      prepareDatabaseForStartup({
        withLock: async (callback) => {
          events.push('lock');
          try {
            return await callback(client as unknown as PoolClient);
          } finally {
            events.push('unlock');
          }
        },
        runMigrations: async () => {
          events.push('migrate');
          throw new Error('migration failed');
        },
        verifyReadiness: async () => {
          events.push('readiness');
          return { appliedMigrations: 1, expectedMigrations: 1, probedTables: [] };
        },
        logger: { info: () => undefined },
      }),
    ).rejects.toThrow('migration failed');

    expect(events).toEqual(['lock', 'migrate', 'unlock']);
  });
});
