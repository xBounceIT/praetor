import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractTopLevelTuples, unquote } from './seedSqlParsing.ts';

// Regression: GitHub issue #423. Both `INSERT INTO time_entries` blocks in seed.sql resolve
// task_id via `(SELECT t.id FROM tasks t WHERE t.project_id = v.project_id AND t.name = v.task
// ...)`. If no row in any `INSERT INTO tasks` block has a matching (project_id, name) pair, the
// lookup returns NULL and the demo dataset ships incomplete time entries. We cover both blocks
// here: the JOIN-projects block (originally reported in #423) and the first block (which uses
// inline `project_name` in its VALUES alias instead of a join).

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

const collectTaskKeys = (sql: string): Set<string> => {
  const keys = new Set<string>();
  const blockRe =
    /INSERT\s+INTO\s+tasks\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+?)(?=\s*ON\s+CONFLICT|\s*;)/gi;
  let match: RegExpExecArray | null = blockRe.exec(sql);
  while (match !== null) {
    const columns = match[1].split(',').map((s) => s.trim());
    const projIdx = columns.indexOf('project_id');
    const nameIdx = columns.indexOf('name');
    if (projIdx !== -1 && nameIdx !== -1) {
      for (const tuple of extractTopLevelTuples(match[2])) {
        if (tuple.length > Math.max(projIdx, nameIdx)) {
          keys.add(`${unquote(tuple[projIdx])}::${unquote(tuple[nameIdx])}`);
        }
      }
    }
    match = blockRe.exec(sql);
  }
  return keys;
};

type DemoTimeEntry = { id: string; projectId: string; task: string };

const requirePosition = (label: string, idx: number): number => {
  if (idx === -1) throw new Error(`seed.sql: failed to locate ${label}`);
  return idx;
};

// Parse a single `INSERT INTO time_entries ... FROM (VALUES ...) AS v(...)` block starting
// at `insertIdx`. Returns one record per tuple with (id, project_id, task).
const parseTimeEntriesAt = (sql: string, insertIdx: number): DemoTimeEntry[] => {
  const valuesHeader = 'FROM (VALUES';
  const valuesStart = requirePosition('FROM (VALUES header', sql.indexOf(valuesHeader, insertIdx));
  const aliasHeader = ') AS v(';
  const aliasMarker = requirePosition(aliasHeader, sql.indexOf(aliasHeader, valuesStart));
  const aliasColsStart = aliasMarker + aliasHeader.length;
  const aliasClose = requirePosition("')' closing AS v(...)", sql.indexOf(')', aliasColsStart));

  const aliasCols = sql
    .slice(aliasColsStart, aliasClose)
    .split(',')
    .map((s) => s.trim());
  const idIdx = requirePosition("column 'id'", aliasCols.indexOf('id'));
  const projIdx = requirePosition("column 'project_id'", aliasCols.indexOf('project_id'));
  const taskIdx = requirePosition("column 'task'", aliasCols.indexOf('task'));

  const body = sql.slice(valuesStart + valuesHeader.length, aliasMarker);
  return extractTopLevelTuples(body).map((parts) => ({
    id: unquote(parts[idIdx]),
    projectId: unquote(parts[projIdx]),
    task: unquote(parts[taskIdx]),
  }));
};

// Locate the time_entries INSERT block that resolves project_name via
// `JOIN projects p ON p.id = v.project_id` — the block reported in issue #423.
const parseDmJoinTimeEntries = (sql: string): DemoTimeEntry[] => {
  const joinIdx = requirePosition(
    'JOIN-projects time_entries block',
    sql.indexOf('JOIN projects p ON p.id = v.project_id'),
  );
  const insertIdx = requirePosition(
    'INSERT INTO time_entries preceding the JOIN block',
    sql.lastIndexOf('INSERT INTO time_entries', joinIdx),
  );
  return parseTimeEntriesAt(sql, insertIdx);
};

// Locate the time_entries INSERT block whose statement does NOT use `JOIN projects p`.
// In seed.sql this is the first block, which carries `project_name` directly in its VALUES
// alias. The three Market Analysis entries (dm_te_08/13/18) live here.
const parseDmFirstBlockTimeEntries = (sql: string): DemoTimeEntry[] => {
  let cursor = 0;
  while (cursor < sql.length) {
    const insertIdx = sql.indexOf('INSERT INTO time_entries', cursor);
    if (insertIdx === -1) break;
    const stmtEnd = sql.indexOf(';', insertIdx);
    const stmtBody = sql.slice(insertIdx, stmtEnd === -1 ? sql.length : stmtEnd);
    if (!/JOIN\s+projects\s+p\s+ON\s+p\.id\s*=\s*v\.project_id/i.test(stmtBody)) {
      return parseTimeEntriesAt(sql, insertIdx);
    }
    cursor = stmtEnd === -1 ? sql.length : stmtEnd + 1;
  }
  throw new Error('seed.sql: failed to locate the non-JOIN-projects time_entries block');
};

// Both describe blocks validate against the same (project_id, task) key set, so parse it
// once at module load rather than per-block.
const taskKeys = collectTaskKeys(SEED_SQL);

describe('seed.sql demo time entries (issue #423)', () => {
  const entries = parseDmJoinTimeEntries(SEED_SQL);

  test('parses exactly dm_te_21..dm_te_25 from the JOIN-projects block', () => {
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

describe('seed.sql demo time entries (first block, no JOIN projects)', () => {
  const entries = parseDmFirstBlockTimeEntries(SEED_SQL);

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
