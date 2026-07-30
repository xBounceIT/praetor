import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseInsertValuesBlocks, parseSelectValuesBlocks } from './seedSqlParsing.ts';

// Regression: GitHub issue #423. Both `INSERT INTO time_entries` blocks in seed.sql resolve
// task_id via `(SELECT t.id FROM tasks t WHERE t.project_id = v.project_id AND t.name = v.task
// ...)`. If no row in any `INSERT INTO tasks` block has a matching (project_id, name) pair, the
// lookup returns NULL and the demo dataset ships incomplete time entries. We cover both blocks
// here. Both now derive client/project labels through joins, so select blocks are identified by
// their stable order instead of by an implementation difference between them.

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

const collectTaskKeys = (sql: string): Set<string> =>
  new Set(parseInsertValuesBlocks(sql, 'tasks').map((row) => `${row.project_id}::${row.name}`));

type DemoTimeEntry = { id: string; projectId: string; task: string };

const parseDemoTimeEntryBlock = (sql: string, index: number): DemoTimeEntry[] => {
  const block = parseSelectValuesBlocks(sql, 'time_entries')[index];
  if (!block) throw new Error(`seed.sql: failed to locate time_entries block ${index + 1}`);
  return block.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    task: row.task,
  }));
};

// Both describe blocks validate against the same (project_id, task) key set, so parse it
// once at module load rather than per-block.
const taskKeys = collectTaskKeys(SEED_SQL);

describe('seed.sql demo time entries (issue #423)', () => {
  const entries = parseDemoTimeEntryBlock(SEED_SQL, 1);

  test('parses exactly dm_te_21..dm_te_25 from the second block', () => {
    expect(entries.map((entry) => entry.id).sort()).toEqual([
      'dm_te_21',
      'dm_te_22',
      'dm_te_23',
      'dm_te_24',
      'dm_te_25',
    ]);
  });

  test.each(entries)('time entry $id resolves task_id (project=$projectId, task="$task")', ({
    projectId,
    task,
  }) => {
    expect(taskKeys.has(`${projectId}::${task}`)).toBe(true);
  });
});

describe('seed.sql demo time entries (first block)', () => {
  const entries = parseDemoTimeEntryBlock(SEED_SQL, 0);

  test('parses exactly dm_te_01..dm_te_20 from the first block', () => {
    expect(entries.map((entry) => entry.id).sort()).toEqual([
      'dm_te_01',
      'dm_te_02',
      'dm_te_03',
      'dm_te_04',
      'dm_te_05',
      'dm_te_06',
      'dm_te_07',
      'dm_te_08',
      'dm_te_09',
      'dm_te_10',
      'dm_te_11',
      'dm_te_12',
      'dm_te_13',
      'dm_te_14',
      'dm_te_15',
      'dm_te_16',
      'dm_te_17',
      'dm_te_18',
      'dm_te_19',
      'dm_te_20',
    ]);
  });

  test.each(entries)('time entry $id resolves task_id (project=$projectId, task="$task")', ({
    projectId,
    task,
  }) => {
    expect(taskKeys.has(`${projectId}::${task}`)).toBe(true);
  });
});
