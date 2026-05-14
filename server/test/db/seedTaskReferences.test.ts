import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression: GitHub issue #423. The second `INSERT INTO time_entries` block in seed.sql
// resolves task_id via `(SELECT t.id FROM tasks t WHERE t.project_id = v.project_id AND
// t.name = v.task ...)`. If no row in any `INSERT INTO tasks` block has a matching
// (project_id, name) pair, the lookup returns NULL and the demo dataset ships incomplete
// time entries. We assert here that every (project_id, task) referenced by that block
// resolves to a real task row in seed.sql.

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

type TopLevelEvent = { type: 'comma' | 'open' | 'close'; index: number };

// Walk a SQL fragment yielding top-level commas and the outer `(...)` boundaries while
// respecting `'…''…'` strings and nested parens. The two parsers below build on this so
// the string/paren state machine lives in one place.
function* walkSqlTopLevel(input: string): Generator<TopLevelEvent> {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (inString) {
      if (c === "'") {
        if (input[i + 1] === "'") {
          i += 1;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (c === "'") {
      inString = true;
      continue;
    }
    if (c === '(') {
      if (depth === 0) yield { type: 'open', index: i };
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0) yield { type: 'close', index: i };
    } else if (c === ',' && depth === 0) {
      yield { type: 'comma', index: i };
    }
  }
}

const splitTopLevelCommas = (input: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  for (const evt of walkSqlTopLevel(input)) {
    if (evt.type !== 'comma') continue;
    parts.push(input.slice(start, evt.index));
    start = evt.index + 1;
  }
  parts.push(input.slice(start));
  return parts.map((s) => s.trim());
};

const unquote = (value: string): string => {
  const trimmed = value.trim();
  const m = trimmed.match(/^'((?:''|[^'])*)'$/);
  return m ? m[1].replace(/''/g, "'") : trimmed;
};

const extractTopLevelTuples = (body: string): string[][] => {
  const tuples: string[][] = [];
  let start = -1;
  for (const evt of walkSqlTopLevel(body)) {
    if (evt.type === 'open') {
      start = evt.index + 1;
    } else if (evt.type === 'close' && start !== -1) {
      tuples.push(splitTopLevelCommas(body.slice(start, evt.index)));
      start = -1;
    }
  }
  return tuples;
};

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

// Locate the time_entries INSERT block that resolves project_name via
// `JOIN projects p ON p.id = v.project_id` — the block reported in issue #423 — and
// return one record per tuple with (id, project_id, task).
const parseDmJoinTimeEntries = (sql: string): DemoTimeEntry[] => {
  const joinIdx = requirePosition(
    'JOIN-projects time_entries block',
    sql.indexOf('JOIN projects p ON p.id = v.project_id'),
  );
  const insertIdx = requirePosition(
    'INSERT INTO time_entries preceding the JOIN block',
    sql.lastIndexOf('INSERT INTO time_entries', joinIdx),
  );
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

describe('seed.sql demo time entries (issue #423)', () => {
  const taskKeys = collectTaskKeys(SEED_SQL);
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
