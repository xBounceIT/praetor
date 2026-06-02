import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import { projects } from '../../db/schema/projects.ts';

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

// Each `INSERT INTO projects ( ... ) ... ;` statement in seed.sql (the compatibility defaults and
// the dm_* demo dataset). A projects column list has no quotes or nested parens, and these
// statements carry no `;` inside their literals, so slicing to the next `;` bounds the block.
const projectInsertBlocks = Array.from(
  SEED_SQL.matchAll(/INSERT\s+INTO\s+projects\s*\(/gi),
  (match) => {
    const start = match.index ?? 0;
    const semicolon = SEED_SQL.indexOf(';', start);
    return SEED_SQL.slice(start, semicolon === -1 ? undefined : semicolon);
  },
);

// Column names from the `(...)` list immediately after `INSERT INTO projects`.
const columnListOf = (block: string) => {
  const open = block.indexOf('(');
  const close = block.indexOf(')', open);
  return block
    .slice(open + 1, close)
    .split(',')
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
};

// Target columns of an `ON CONFLICT ... DO UPDATE SET col = EXCLUDED.col` clause.
const upsertTargetsOf = (block: string) =>
  Array.from(block.matchAll(/(\w+)\s*=\s*EXCLUDED\./g), (match) => match[1]);

describe('seed.sql projects inserts stay in sync with the projects schema', () => {
  test('parses both projects INSERT statements', () => {
    expect(projectInsertBlocks.length).toBeGreaterThanOrEqual(2);
  });

  test('every referenced column exists on the projects table', () => {
    const referenced = projectInsertBlocks.flatMap((block) => [
      ...columnListOf(block),
      ...upsertTargetsOf(block),
    ]);
    const unknown = [...new Set(referenced)].filter((column) => !schemaColumns.has(column));
    expect(unknown).toEqual([]);
  });
});
