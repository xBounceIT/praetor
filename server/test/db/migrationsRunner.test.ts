import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { runDrizzleMigrationsWithClient } from '../../db/migrationsRunner.ts';

type TestMigration = {
  tag: string;
  when: number;
  sql: string;
};

type QueryCall = {
  text: string;
  params: unknown[];
};

type FakeClient = {
  calls: QueryCall[];
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

const hashSql = (sql: string): string => createHash('sha256').update(sql).digest('hex');

const makeMigrationsDir = (migrations: readonly TestMigration[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'praetor-migrations-'));
  mkdirSync(join(dir, 'meta'));

  const journal = {
    version: '7',
    dialect: 'postgresql',
    entries: migrations.map((migration, idx) => ({
      idx,
      version: '7',
      when: migration.when,
      tag: migration.tag,
      breakpoints: true,
    })),
  };

  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal, null, 2));

  for (const migration of migrations) {
    writeFileSync(join(dir, `${migration.tag}.sql`), migration.sql);
  }

  return dir;
};

const removeMigrationsDir = (dir: string) => {
  rmSync(dir, { recursive: true, force: true });
};

const makeClient = (
  appliedHashes: readonly string[] = [],
  options: { failOnSql?: string } = {},
): FakeClient => {
  const calls: QueryCall[] = [];

  return {
    calls,
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params: unknown[] = [],
    ): Promise<QueryResult<T>> {
      calls.push({ text, params });

      if (options.failOnSql !== undefined && text === options.failOnSql) {
        throw new Error(`query failed: ${text}`);
      }

      if (text.includes('SELECT hash') && text.includes('__drizzle_migrations')) {
        return makeQueryResult(appliedHashes.map((hash) => ({ hash }) as unknown as T));
      }

      return makeQueryResult<T>([]);
    },
  };
};

describe('runDrizzleMigrationsWithClient', () => {
  test('applies a missing migration even when its journal timestamp is older than the latest ledger row', async () => {
    const firstSql = 'SELECT 1 AS first;';
    const secondSql = 'SELECT 2 AS second;';
    const secondWhen = 1_000;
    const dir = makeMigrationsDir([
      { tag: '0000_first', when: 2_000, sql: firstSql },
      { tag: '0001_second', when: secondWhen, sql: secondSql },
    ]);
    const firstHash = hashSql(firstSql);
    const secondHash = hashSql(secondSql);
    const client = makeClient([firstHash]);

    try {
      await runDrizzleMigrationsWithClient(client as unknown as PoolClient, {
        migrationsDir: dir,
      });

      expect(client.calls.some((call) => call.text === firstSql)).toBe(false);
      expect(client.calls.some((call) => call.text === secondSql)).toBe(true);
      expect(client.calls.some((call) => call.text === 'BEGIN')).toBe(true);
      expect(client.calls.some((call) => call.text === 'COMMIT')).toBe(true);

      const insertCall = client.calls.find((call) =>
        call.text.includes('INSERT INTO "drizzle"."__drizzle_migrations"'),
      );
      expect(insertCall?.params).toEqual([secondHash, String(secondWhen)]);
    } finally {
      removeMigrationsDir(dir);
    }
  });

  test('does not open a transaction when every migration hash is already recorded', async () => {
    const firstSql = 'SELECT 1 AS first;';
    const secondSql = 'SELECT 2 AS second;';
    const dir = makeMigrationsDir([
      { tag: '0000_first', when: 1_000, sql: firstSql },
      { tag: '0001_second', when: 2_000, sql: secondSql },
    ]);
    const client = makeClient([hashSql(firstSql), hashSql(secondSql)]);

    try {
      await runDrizzleMigrationsWithClient(client as unknown as PoolClient, {
        migrationsDir: dir,
      });

      expect(client.calls.some((call) => call.text === 'BEGIN')).toBe(false);
      expect(client.calls.some((call) => call.text === firstSql)).toBe(false);
      expect(client.calls.some((call) => call.text === secondSql)).toBe(false);
    } finally {
      removeMigrationsDir(dir);
    }
  });

  test('rolls back when a pending migration statement fails', async () => {
    const failingSql = 'SELECT fail;';
    const dir = makeMigrationsDir([{ tag: '0000_failing', when: 1_000, sql: failingSql }]);
    const client = makeClient([], { failOnSql: failingSql });

    try {
      await expect(
        runDrizzleMigrationsWithClient(client as unknown as PoolClient, {
          migrationsDir: dir,
        }),
      ).rejects.toThrow(`query failed: ${failingSql}`);

      expect(client.calls.some((call) => call.text === 'BEGIN')).toBe(true);
      expect(client.calls.some((call) => call.text === 'ROLLBACK')).toBe(true);
      expect(
        client.calls.some((call) =>
          call.text.includes('INSERT INTO "drizzle"."__drizzle_migrations"'),
        ),
      ).toBe(false);
    } finally {
      removeMigrationsDir(dir);
    }
  });

  test('refuses to run when the ledger contains a hash that is not in the current journal', async () => {
    const dir = makeMigrationsDir([{ tag: '0000_first', when: 1_000, sql: 'SELECT 1;' }]);
    const client = makeClient(['not-a-current-migration-hash']);

    try {
      await expect(
        runDrizzleMigrationsWithClient(client as unknown as PoolClient, {
          migrationsDir: dir,
        }),
      ).rejects.toThrow('applied migration hashes that do not match the current migration files');

      expect(client.calls.some((call) => call.text === 'BEGIN')).toBe(false);
    } finally {
      removeMigrationsDir(dir);
    }
  });
});
