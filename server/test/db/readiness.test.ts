import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { DbReadinessProbe } from '../../db/readiness.ts';
import { schemaReadinessProbes, verifyDbReadiness } from '../../db/readiness.ts';
import { setupTestDb } from '../helpers/fakeExecutor.ts';

const makeMigrationsDir = (count: number): string => {
  const dir = mkdtempSync(join(tmpdir(), 'praetor-readiness-'));
  for (let i = 0; i < count; i += 1) {
    writeFileSync(join(dir, `${String(i).padStart(4, '0')}_test.sql`), '-- test\n');
  }
  return dir;
};

const removeMigrationsDir = (dir: string) => {
  rmSync(dir, { recursive: true, force: true });
};

describe('verifyDbReadiness', () => {
  test('default schema probes include project_rules', () => {
    expect(schemaReadinessProbes.some((probe) => probe.name === 'project_rules')).toBe(true);
  });

  test('succeeds when migrations are complete and probes pass', async () => {
    const { exec, testDb } = setupTestDb();
    const probe: DbReadinessProbe = {
      name: 'users',
      run: async (db) => db.execute(sql`SELECT * FROM users LIMIT 0`),
    };

    exec.enqueue({ rows: [{ ok: 1 }] });
    exec.enqueue({ rows: [{ appliedCount: '2' }] });
    exec.enqueue({ rows: [] });
    const migrationsDir = makeMigrationsDir(2);

    try {
      const result = await verifyDbReadiness({
        exec: testDb,
        migrationsDir,
        probes: [probe],
      });

      expect(result).toEqual({
        appliedMigrations: 2,
        expectedMigrations: 2,
        probedTables: ['users'],
      });
    } finally {
      removeMigrationsDir(migrationsDir);
    }
  });

  test('fails when the database is missing applied migration rows', async () => {
    const { exec, testDb } = setupTestDb();

    exec.enqueue({ rows: [{ ok: 1 }] });
    exec.enqueue({ rows: [{ appliedCount: '1' }] });
    const migrationsDir = makeMigrationsDir(2);

    try {
      await expect(
        verifyDbReadiness({
          exec: testDb,
          migrationsDir,
          probes: [],
        }),
      ).rejects.toThrow('Database migrations incomplete. Applied 1 of 2 migration files.');
    } finally {
      removeMigrationsDir(migrationsDir);
    }
  });

  test('fails with the probe name when a table probe throws', async () => {
    const { exec, testDb } = setupTestDb();
    const probe: DbReadinessProbe = {
      name: 'users',
      run: async () => {
        throw new Error('relation "users" does not exist');
      },
    };

    exec.enqueue({ rows: [{ ok: 1 }] });
    exec.enqueue({ rows: [{ appliedCount: '1' }] });
    const migrationsDir = makeMigrationsDir(1);

    try {
      await expect(
        verifyDbReadiness({
          exec: testDb,
          migrationsDir,
          probes: [probe],
        }),
      ).rejects.toThrow('Database schema probe failed for users');
    } finally {
      removeMigrationsDir(migrationsDir);
    }
  });
});
