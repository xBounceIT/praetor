import { describe, expect, test } from 'bun:test';
import { filterVersionHistoryRows } from '../../utils/versionHistoryFilter';

const labels = {
  reasonRestore: 'Restored',
  reasonUpdate: 'Sent snapshot',
};

const rows = [
  {
    id: 'r3',
    createdAt: Date.UTC(2026, 6, 15, 10, 32),
    reason: 'update' as const,
    revisionCode: 'REV 3',
    createdByUserName: 'Alice',
  },
  {
    id: 'r2',
    createdAt: Date.UTC(2026, 6, 10, 9, 0),
    reason: 'restore' as const,
    revisionCode: 'REV 2',
    createdByUserName: 'Bob',
  },
  {
    id: 'r1',
    createdAt: Date.UTC(2026, 5, 1, 8, 0),
    reason: 'update' as const,
    revisionCode: 'REV 1',
    createdByUserName: null,
  },
];

describe('filterVersionHistoryRows', () => {
  test('returns all rows when query is empty or whitespace', () => {
    expect(filterVersionHistoryRows(rows, '', 'en', labels)).toEqual(rows);
    expect(filterVersionHistoryRows(rows, '   ', 'it', labels)).toEqual(rows);
  });

  test('filters by revision code', () => {
    expect(filterVersionHistoryRows(rows, 'rev 2', 'en', labels).map((row) => row.id)).toEqual([
      'r2',
    ]);
  });

  test('filters by author name', () => {
    expect(filterVersionHistoryRows(rows, 'alice', 'en', labels).map((row) => row.id)).toEqual([
      'r3',
    ]);
  });

  test('filters by reason label', () => {
    expect(filterVersionHistoryRows(rows, 'restored', 'en', labels).map((row) => row.id)).toEqual([
      'r2',
    ]);
  });

  test('returns empty when nothing matches', () => {
    expect(filterVersionHistoryRows(rows, 'zzz-no-match', 'en', labels)).toEqual([]);
  });
});
