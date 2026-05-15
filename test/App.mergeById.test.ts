import { describe, expect, test } from 'bun:test';
import type { TimeEntry } from '../types';

/**
 * Mirrors the `mergeById` helper inside `App.tsx`'s `timesheets` case 1:1.
 * The helper is locally scoped (declared inside a switch branch), so this
 * file pins the contract that App.tsx depends on:
 *
 *   - preserve `prev`'s order (continuation pages are older than `prev`, so
 *     newer rows must stay on top — prepending the new page would reverse
 *     chunk order for users with > 500 entries)
 *   - server wins on id collisions (in-place replacement)
 *   - entries unique to `page` are appended to the end
 */
const mergeById = (prev: TimeEntry[], page: TimeEntry[]): TimeEntry[] => {
  const incoming = new Map(page.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const merged: TimeEntry[] = [];
  for (const entry of prev) {
    const replacement = incoming.get(entry.id);
    if (replacement) {
      merged.push(replacement);
      seen.add(entry.id);
    } else {
      merged.push(entry);
    }
  }
  for (const entry of page) {
    if (!seen.has(entry.id)) merged.push(entry);
  }
  return merged;
};

const makeEntry = (id: string, createdAt: number, notes = id): TimeEntry => ({
  id,
  userId: 'u1',
  date: '2026-05-13',
  clientId: 'c1',
  clientName: 'Client',
  projectId: 'p1',
  projectName: 'Project',
  task: 'task',
  notes,
  duration: 60,
  createdAt,
  version: 1,
});

describe('App.tsx timesheets mergeById', () => {
  test('initial page with empty prev returns the page in its original order', () => {
    const a = makeEntry('a', 3);
    const b = makeEntry('b', 2);
    const c = makeEntry('c', 1);
    expect(mergeById([], [a, b, c])).toEqual([a, b, c]);
  });

  test('preserves prev order; new server rows are appended (continuation page case)', () => {
    // prev = newest already-loaded entries; page = OLDER entries from the
    // next cursor. The page must appear AFTER prev, never before.
    const newest = makeEntry('newest', 10);
    const newer = makeEntry('newer', 9);
    const older1 = makeEntry('older1', 5);
    const older2 = makeEntry('older2', 4);

    const merged = mergeById([newest, newer], [older1, older2]);

    expect(merged.map((e) => e.id)).toEqual(['newest', 'newer', 'older1', 'older2']);
  });

  test('preserves an optimistic insert at the top when the initial page resolves', () => {
    // M21 scenario: user creates D (optimistic, newest) while the first page
    // is in flight. When [A, B, C] lands, D must survive AT THE TOP.
    const optimistic = makeEntry('optimistic-d', 100);
    const a = makeEntry('a', 30);
    const b = makeEntry('b', 20);
    const c = makeEntry('c', 10);

    const merged = mergeById([optimistic], [a, b, c]);

    expect(merged.map((e) => e.id)).toEqual(['optimistic-d', 'a', 'b', 'c']);
  });

  test('server wins on id collisions but the row stays in prev position', () => {
    const localA = makeEntry('a', 1, 'local-version');
    const serverA = makeEntry('a', 1, 'server-version');
    const b = makeEntry('b', 0);

    const merged = mergeById([localA, b], [serverA]);

    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
    expect(merged[0]?.notes).toBe('server-version');
  });

  test('no duplicates when prev and page share an id', () => {
    const a = makeEntry('a', 2);
    const b = makeEntry('b', 1);
    const merged = mergeById([a, b], [a]);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
