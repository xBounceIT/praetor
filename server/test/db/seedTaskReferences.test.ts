import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression: the FIRST `INSERT INTO time_entries` block in seed.sql resolves task_id via
// `(SELECT t.id FROM tasks t WHERE t.project_id = v.project_id AND t.name = v.task ...)`.
// If no row in any `INSERT INTO tasks` block has a matching (project_id, name) pair, the
// lookup returns NULL and the demo dataset ships time entries without a task_id. We assert
// here that every (project_id, task) referenced by that first block resolves to a real task
// row in seed.sql. The block is identified as the time_entries INSERT whose FROM (VALUES …)
// clause does NOT have a `JOIN projects p` qualifier (the JOIN-projects block is the one
// already covered by issue #423).

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

const splitTopLevelCommas = (input: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
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
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
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
  let depth = 0;
  let inString = false;
  let start = -1;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (inString) {
      if (c === "'") {
        if (body[i + 1] === "'") {
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
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        tuples.push(splitTopLevelCommas(body.slice(start, i)));
        start = -1;
      }
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

const parseDmFirstBlockTimeEntries = (sql: string): DemoTimeEntry[] => {
  let cursor = 0;
  while (cursor < sql.length) {
    const insertIdx = sql.indexOf('INSERT INTO time_entries', cursor);
    if (insertIdx === -1) break;

    const valuesHeader = 'FROM (VALUES';
    const valuesStart = sql.indexOf(valuesHeader, insertIdx);
    if (valuesStart === -1) break;

    const aliasMarker = sql.indexOf(') AS v(', valuesStart);
    if (aliasMarker === -1) break;

    const aliasOpen = sql.indexOf('(', aliasMarker + 1);
    const aliasClose = sql.indexOf(')', aliasOpen);

    const stmtEnd = sql.indexOf(';', aliasClose);
    const stmtTail = sql.slice(aliasClose, stmtEnd === -1 ? sql.length : stmtEnd);
    const isJoinBlock = /JOIN\s+projects\s+p\s+ON\s+p\.id\s*=\s*v\.project_id/i.test(stmtTail);

    if (!isJoinBlock) {
      const aliasCols = sql
        .slice(aliasOpen + 1, aliasClose)
        .split(',')
        .map((s) => s.trim());

      const idIdx = aliasCols.indexOf('id');
      const projIdx = aliasCols.indexOf('project_id');
      const taskIdx = aliasCols.indexOf('task');
      if (idIdx === -1 || projIdx === -1 || taskIdx === -1) {
        throw new Error(
          `time_entries VALUES alias missing required columns: ${aliasCols.join(', ')}`,
        );
      }

      const body = sql.slice(valuesStart + valuesHeader.length, aliasMarker);
      return extractTopLevelTuples(body).map((parts) => ({
        id: unquote(parts[idIdx]),
        projectId: unquote(parts[projIdx]),
        task: unquote(parts[taskIdx]),
      }));
    }

    cursor = aliasClose + 1;
  }
  throw new Error('No non-JOIN-projects time_entries block found in seed.sql');
};

describe('seed.sql demo time entries (first block)', () => {
  const taskKeys = collectTaskKeys(SEED_SQL);
  const entries = parseDmFirstBlockTimeEntries(SEED_SQL);

  test('parser locates the 20 first-block demo entries (dm_te_01..20)', () => {
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

  for (const entry of entries) {
    test(`time entry ${entry.id} task lookup resolves (project=${entry.projectId}, task="${entry.task}")`, () => {
      expect(taskKeys.has(`${entry.projectId}::${entry.task}`)).toBe(true);
    });
  }
});
