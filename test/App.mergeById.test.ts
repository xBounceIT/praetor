import { describe, expect, test } from 'bun:test';
import { decodeEntriesCursor } from '../services/api/entries';
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
 *   - prev entries that fall inside the page's (createdAt, id) coverage
 *     window but aren't in the response are dropped — those were deleted on
 *     the server (issue #519)
 *   - returns `prev` by reference on structural no-ops so `setEntries` can
 *     short-circuit via `Object.is` and skip the re-render (issue #591)
 */
const mergeById = (
  prev: TimeEntry[],
  pageEntries: TimeEntry[],
  inputCursor: string | null,
  nextCursor: string | null,
): TimeEntry[] => {
  const incoming = new Map(pageEntries.map((entry) => [entry.id, entry]));
  const upperBound = decodeEntriesCursor(inputCursor);
  const newestInPage = pageEntries[0] ?? null;
  const oldestInPage = pageEntries[pageEntries.length - 1] ?? null;
  const hasMorePages = nextCursor !== null;
  const isWithinPageWindow = (entry: TimeEntry): boolean => {
    if (!newestInPage || !oldestInPage) return false;
    if (upperBound) {
      if (entry.createdAt >= upperBound.createdAt) return false;
    } else if (entry.createdAt >= newestInPage.createdAt) {
      return false;
    }
    if (hasMorePages && entry.createdAt <= oldestInPage.createdAt) return false;
    return true;
  };
  const seen = new Set<string>();
  const merged: TimeEntry[] = [];
  let changed = false;
  for (const entry of prev) {
    const replacement = incoming.get(entry.id);
    if (replacement) {
      merged.push(replacement);
      seen.add(entry.id);
      if (replacement !== entry) changed = true;
    } else if (!isWithinPageWindow(entry)) {
      merged.push(entry);
    } else {
      changed = true;
    }
  }
  for (const entry of pageEntries) {
    if (!seen.has(entry.id)) {
      merged.push(entry);
      changed = true;
    }
  }
  return changed ? merged : prev;
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

// Build the same base64url(JSON({createdAt, id})) shape the server emits so
// decodeEntriesCursor lines up with an entry's ms-precision createdAt. The
// `createdAt` is rendered as Postgres `created_at::text` would emit it:
// `YYYY-MM-DD HH:MM:SS.fff` with no zone marker (the column is TIMESTAMP
// WITHOUT TIME ZONE). Using `.toISOString()` here would silently mask the
// timezone-handling bug fixed alongside issue #519.
const encodeCursorFor = (entry: { createdAt: number; id: string }): string => {
  const d = new Date(entry.createdAt);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const text =
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
  const json = JSON.stringify({ createdAt: text, id: entry.id });
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

describe('App.tsx timesheets mergeById', () => {
  test('initial page with empty prev returns the page in its original order', () => {
    const a = makeEntry('a', 3);
    const b = makeEntry('b', 2);
    const c = makeEntry('c', 1);
    expect(mergeById([], [a, b, c], null, null)).toEqual([a, b, c]);
  });

  test('preserves prev order; new server rows are appended (continuation page case)', () => {
    // prev = newest already-loaded entries; page = OLDER entries from the
    // next cursor. The page must appear AFTER prev, never before.
    const newest = makeEntry('newest', 10);
    const newer = makeEntry('newer', 9);
    const older1 = makeEntry('older1', 5);
    const older2 = makeEntry('older2', 4);

    // Continuation page: cursor = oldest of previous page (`newer`), no more pages.
    const merged = mergeById([newest, newer], [older1, older2], encodeCursorFor(newer), null);

    expect(merged.map((e) => e.id)).toEqual(['newest', 'newer', 'older1', 'older2']);
  });

  test('preserves an optimistic insert at the top when the initial page resolves', () => {
    // M21 scenario: user creates D (server-confirmed, newest) while the first
    // page is in flight. When [A, B, C] lands, D must survive AT THE TOP.
    const optimistic = makeEntry('optimistic-d', 100);
    const a = makeEntry('a', 30);
    const b = makeEntry('b', 20);
    const c = makeEntry('c', 10);

    const merged = mergeById([optimistic], [a, b, c], null, null);

    expect(merged.map((e) => e.id)).toEqual(['optimistic-d', 'a', 'b', 'c']);
  });

  test('server wins on id collisions but the row stays in prev position', () => {
    const localA = makeEntry('a', 1, 'local-version');
    const serverA = makeEntry('a', 1, 'server-version');

    const merged = mergeById([localA], [serverA], null, null);

    expect(merged.map((e) => e.id)).toEqual(['a']);
    expect(merged[0]?.notes).toBe('server-version');
  });

  test('no duplicates when prev and page share an id', () => {
    const a = makeEntry('a', 2);
    const b = makeEntry('b', 1);
    const merged = mergeById([a, b], [a, b], null, null);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
  });

  test('drops server-deleted entries inside the page window (issue #519)', () => {
    // prev contains [a, deleted, c] from a prior full load. The first/only
    // page now returns [a, c] - 'deleted' has been removed on the server.
    // Pre-fix this kept 'deleted' until a full reload.
    const a = makeEntry('a', 30);
    const deleted = makeEntry('deleted', 20);
    const c = makeEntry('c', 10);

    const merged = mergeById([a, deleted, c], [a, c], null, null);

    expect(merged.map((e) => e.id)).toEqual(['a', 'c']);
  });

  test('keeps prev entries older than the page when more pages follow', () => {
    // First page returns the newest [a, b], with a nextCursor signalling
    // more older pages incoming. prev has an older entry from a prior load
    // that the continuation page might still return - keep it.
    const a = makeEntry('a', 30);
    const b = makeEntry('b', 20);
    const oldX = makeEntry('oldX', 5);

    const merged = mergeById([a, b, oldX], [a, b], null, 'next-cursor-token');

    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'oldX']);
  });

  test('drops server-deleted entries straddling a cross-page cursor boundary', () => {
    // Initial first page returned [a, b], setting cursor = b. The
    // continuation page now returns [c] (last page). prev has [a, b, gapX]
    // where gapX is between b and c on the createdAt axis - it would have
    // been included in this continuation page if it still existed.
    const a = makeEntry('a', 30);
    const b = makeEntry('b', 20);
    const gapX = makeEntry('gapX', 15); // strictly less than cursor (b), greater than newest in page (c)
    const c = makeEntry('c', 10);

    const merged = mergeById([a, b, gapX], [c], encodeCursorFor(b), null);

    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  test('continuation page keeps prev rows newer than the input cursor', () => {
    // The continuation merge must not drop entries newer than its cursor
    // (those came from earlier pages or from a concurrent insert).
    const newest = makeEntry('newest', 100);
    const a = makeEntry('a', 30);
    const b = makeEntry('b', 20);
    const c = makeEntry('c', 10);

    // cursor positioned at b (previous page's oldest); page returns [c].
    const merged = mergeById([newest, a, b], [c], encodeCursorFor(b), null);

    expect(merged.map((e) => e.id)).toEqual(['newest', 'a', 'b', 'c']);
  });

  test('empty page is a no-op (no info to determine deletes)', () => {
    const a = makeEntry('a', 30);
    const b = makeEntry('b', 20);

    const merged = mergeById([a, b], [], null, null);

    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
  });

  test('keeps prev entries that share their ms with the cursor (µs is ambiguous)', () => {
    // pg-node truncates entry.createdAt to ms; the cursor preserves µs.
    // When an entry shares its ms with the cursor, the µs ordering on the
    // server side is unrecoverable on the client, so the merge must NOT
    // drop the entry even if it's missing from the page response.
    const ambiguous = makeEntry('A', 200); // ms === cursor's ms, id < cursor.id
    const cursorRow = makeEntry('B', 200);
    const older = makeEntry('c', 100);

    const merged = mergeById([ambiguous], [older], encodeCursorFor(cursorRow), null);

    expect(merged.map((e) => e.id)).toEqual(['A', 'c']);
  });

  test('returns prev by reference when an empty page produces a no-op (issue #591)', () => {
    // Empty continuation pages must not trigger redundant re-renders by
    // returning a fresh array reference when nothing in prev changed.
    const a = makeEntry('a', 30);
    const b = makeEntry('b', 20);
    const prev = [a, b];

    const merged = mergeById(prev, [], encodeCursorFor(b), null);

    expect(merged).toBe(prev);
  });

  test('returns prev by reference when page rows are identical references (issue #591)', () => {
    // A reload whose page entries are the same object refs already in prev
    // is a structural no-op: setEntries must short-circuit via Object.is.
    const a = makeEntry('a', 30);
    const b = makeEntry('b', 20);
    const prev = [a, b];

    const merged = mergeById(prev, [a, b], null, null);

    expect(merged).toBe(prev);
  });

  test('returns a new array reference when prev contains a server-deleted row (issue #591)', () => {
    // Sanity guard for the changed-flag: a drop inside the page window must
    // still produce a new reference so consumers re-render.
    const a = makeEntry('a', 30);
    const deleted = makeEntry('deleted', 20);
    const c = makeEntry('c', 10);
    const prev = [a, deleted, c];

    const merged = mergeById(prev, [a, c], null, null);

    expect(merged).not.toBe(prev);
    expect(merged.map((e) => e.id)).toEqual(['a', 'c']);
  });

  test('returns a new array reference when page rows are field-equal but different objects (issue #591)', () => {
    // The common real-world case: server returns freshly-parsed rows whose
    // refs differ from prev. The merge must produce a new array so subtree
    // updates that depend on row identity (e.g. version bumps) still fire.
    const a = makeEntry('a', 30);
    const b = makeEntry('b', 20);
    const prev = [a, b];
    const aCopy = makeEntry('a', 30);
    const bCopy = makeEntry('b', 20);

    const merged = mergeById(prev, [aCopy, bCopy], null, null);

    expect(merged).not.toBe(prev);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
  });

  test('keeps prev entries at the same ms as the first page boundary', () => {
    // Same µs ambiguity at the first-page newest-row boundary, where the
    // strict id-tiebreaker would mis-classify a row with id < newest's id.
    const ambiguous = makeEntry('A', 30); // ms === newestInPage's ms, id < newestInPage.id
    const b = makeEntry('b', 30);
    const c = makeEntry('c', 20);

    const merged = mergeById([ambiguous, c], [b, c], null, null);

    // prev order preserved for kept rows; new page rows append at the end.
    expect(merged.map((e) => e.id)).toEqual(['A', 'c', 'b']);
  });
});
