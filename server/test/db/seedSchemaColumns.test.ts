import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import { projects } from '../../db/schema/projects.ts';
import { users } from '../../db/schema/users.ts';
import { parseInsertValuesBlocks } from './seedSqlParsing.ts';

// Drift guard between server/db/seed.sql and the projects schema. The demo seed refresh
// (db/demoSeed.ts) applies seed.sql verbatim at startup, so any column the seed names that no
// longer exists on the projects table aborts the whole refresh and the server boot. PR #742
// dropped projects.color and updated demoSeed.ts but not seed.sql, crashing startup with
// `column "color" of relation "projects" does not exist`. This test ties every projects column
// referenced in seed.sql back to the live Drizzle schema so the two cannot silently drift again.

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

const schemaColumns = new Set(
  Object.values(getTableColumns(projects)).map((column) => column.name),
);

// parseInsertValuesBlocks keys each parsed row by its column name, so the union of keys across
// every `INSERT INTO projects (...)` block (the compatibility defaults and the dm_* demo
// dataset) is exactly the set of projects columns the seed references. The ON CONFLICT
// `col = EXCLUDED.col` targets need no separate check: EXCLUDED.col is only valid when col is
// already in the insert column list, which this set covers.
const seededRows = parseInsertValuesBlocks(SEED_SQL, 'projects');
const referencedColumns = new Set(seededRows.flatMap((row) => Object.keys(row)));
const seededUserRows = parseInsertValuesBlocks(SEED_SQL, 'users');
const userSchemaColumns = new Set(
  Object.values(getTableColumns(users)).map((column) => column.name),
);

describe('seed.sql projects inserts stay in sync with the projects schema', () => {
  test('parses the projects INSERT rows from seed.sql', () => {
    // Guards against a vacuous pass if the seed format changes and parsing yields nothing.
    expect(seededRows.length).toBeGreaterThanOrEqual(2);
  });

  test('every referenced column exists on the projects table', () => {
    const unknown = [...referencedColumns].filter((column) => !schemaColumns.has(column));
    expect(unknown).toEqual([]);
  });
});

describe('seed.sql user inserts stay in sync with the users schema', () => {
  test('seeds fresh users with an unclaimed first-login marker', () => {
    expect(seededUserRows.length).toBeGreaterThan(0);
    expect(seededUserRows.every((row) => row.first_login_at === 'NULL')).toBe(true);
  });

  test('every referenced user column exists on the users table', () => {
    const referencedUserColumns = new Set(seededUserRows.flatMap((row) => Object.keys(row)));
    const unknown = [...referencedUserColumns].filter((column) => !userSchemaColumns.has(column));
    expect(unknown).toEqual([]);
  });
});
