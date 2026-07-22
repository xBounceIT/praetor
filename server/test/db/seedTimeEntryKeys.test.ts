import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dateOffsetDays, parseSelectValuesBlocks } from './seedSqlParsing.ts';

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

describe('seed.sql time-entry uniqueness', () => {
  test('keeps every demo user/date/project/task key unique', () => {
    const entries = parseSelectValuesBlocks(SEED_SQL, 'time_entries').flatMap(
      (block) => block.rows,
    );
    expect(entries.length).toBeGreaterThan(0);

    const idsByKey = new Map<string, string[]>();
    for (const entry of entries) {
      const dateOffset = dateOffsetDays(entry.entry_date);
      expect(dateOffset).not.toBeNull();
      const key = `${entry.user_id}|${dateOffset}|${entry.project_id}|${entry.task}`;
      const ids = idsByKey.get(key) ?? [];
      ids.push(entry.id);
      idsByKey.set(key, ids);
    }

    const duplicateKeys = Array.from(idsByKey, ([key, ids]) => ({ key, ids })).filter(
      ({ ids }) => ids.length > 1,
    );
    expect(duplicateKeys).toEqual([]);
  });
});
