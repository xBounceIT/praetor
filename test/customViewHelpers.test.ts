import { describe, expect, test } from 'bun:test';
import {
  type CustomView,
  computeViewApplication,
  filterStatesEqual,
  generateViewId,
  IMPORT_PAYLOAD_MAX_BYTES,
  isValidImportedView,
  isValidStoredView,
  moveByDelta,
  parseFilterState,
  parseSortState,
  parseStoredViews,
  reorderDropAbove,
} from '../components/shared/customViewHelpers';

const view = (overrides: Partial<CustomView> = {}): CustomView => ({
  id: 'view-1',
  name: 'View 1',
  hiddenColIds: [],
  sortState: null,
  filterState: {},
  ...overrides,
});

describe('generateViewId', () => {
  test('returns a non-empty string', () => {
    const id = generateViewId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('produces unique values per call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateViewId()));
    expect(ids.size).toBe(100);
  });

  test('returns RFC4122 v4 format when crypto is available', () => {
    const id = generateViewId();
    // Bun runtime exposes crypto.randomUUID; the result should match v4 shape.
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe('isValidImportedView', () => {
  test('accepts a minimal valid payload', () => {
    expect(isValidImportedView({ name: 'X', hiddenColIds: [] })).toBe(true);
  });

  test('accepts payload with sortState and filterState present', () => {
    expect(
      isValidImportedView({
        name: 'X',
        hiddenColIds: ['a', 'b'],
        sortState: { colId: 'a', px: 'asc' },
        filterState: { a: ['1'] },
      }),
    ).toBe(true);
  });

  test('rejects null and non-objects', () => {
    expect(isValidImportedView(null)).toBe(false);
    expect(isValidImportedView(undefined)).toBe(false);
    expect(isValidImportedView('hello')).toBe(false);
    expect(isValidImportedView(42)).toBe(false);
    expect(isValidImportedView([])).toBe(false); // arrays are objects but missing keys
  });

  test('rejects missing or empty name', () => {
    expect(isValidImportedView({ hiddenColIds: [] })).toBe(false);
    expect(isValidImportedView({ name: '', hiddenColIds: [] })).toBe(false);
    expect(isValidImportedView({ name: '   ', hiddenColIds: [] })).toBe(false);
    expect(isValidImportedView({ name: 42, hiddenColIds: [] })).toBe(false);
  });

  test('rejects non-array or mistyped hiddenColIds', () => {
    expect(isValidImportedView({ name: 'X' })).toBe(false);
    expect(isValidImportedView({ name: 'X', hiddenColIds: 'a' })).toBe(false);
    expect(isValidImportedView({ name: 'X', hiddenColIds: [1, 2] })).toBe(false);
    expect(isValidImportedView({ name: 'X', hiddenColIds: ['a', null] })).toBe(false);
  });
});

describe('isValidStoredView', () => {
  test('accepts a stored view with id', () => {
    expect(isValidStoredView({ id: 'a', name: 'X', hiddenColIds: [] })).toBe(true);
  });

  test('rejects entries missing or with empty id', () => {
    expect(isValidStoredView({ name: 'X', hiddenColIds: [] })).toBe(false);
    expect(isValidStoredView({ id: '', name: 'X', hiddenColIds: [] })).toBe(false);
    expect(isValidStoredView({ id: 42, name: 'X', hiddenColIds: [] })).toBe(false);
  });
});

describe('parseSortState', () => {
  test('returns null for non-object inputs', () => {
    expect(parseSortState(null)).toBe(null);
    expect(parseSortState(undefined)).toBe(null);
    expect(parseSortState('asc')).toBe(null);
    expect(parseSortState(7)).toBe(null);
  });

  test('returns null when colId is missing or wrong type', () => {
    expect(parseSortState({ px: 'asc' })).toBe(null);
    expect(parseSortState({ colId: 42, px: 'asc' })).toBe(null);
  });

  test('returns null for invalid px direction', () => {
    expect(parseSortState({ colId: 'name', px: 'sideways' })).toBe(null);
    expect(parseSortState({ colId: 'name' })).toBe(null);
  });

  test('returns the sort tuple for asc and desc', () => {
    expect(parseSortState({ colId: 'name', px: 'asc' })).toEqual({ colId: 'name', px: 'asc' });
    expect(parseSortState({ colId: 'name', px: 'desc' })).toEqual({ colId: 'name', px: 'desc' });
  });

  test('strips extra fields', () => {
    const result = parseSortState({ colId: 'name', px: 'asc', extra: 'junk' });
    expect(result).toEqual({ colId: 'name', px: 'asc' });
  });
});

describe('parseFilterState', () => {
  test('returns empty object for non-object inputs', () => {
    expect(parseFilterState(null)).toEqual({});
    expect(parseFilterState('hello')).toEqual({});
    expect(parseFilterState(7)).toEqual({});
  });

  test('keeps only entries whose values are arrays of strings', () => {
    const result = parseFilterState({
      good: ['a', 'b'],
      mixed: ['a', 1],
      notArray: 'hello',
      empty: [],
      objectVal: { a: 1 },
    });
    expect(result).toEqual({ good: ['a', 'b'], empty: [] });
  });
});

describe('parseStoredViews', () => {
  test('returns [] for null / empty input', () => {
    expect(parseStoredViews(null)).toEqual([]);
    expect(parseStoredViews('')).toEqual([]);
  });

  test('returns [] for malformed JSON', () => {
    expect(parseStoredViews('{not json')).toEqual([]);
  });

  test('returns [] when JSON is not an array', () => {
    expect(parseStoredViews('{"id":"a"}')).toEqual([]);
  });

  test('drops invalid entries and normalizes valid ones', () => {
    const stored = JSON.stringify([
      { id: 'a', name: 'View A', hiddenColIds: ['x'], sortState: { colId: 'x', px: 'asc' } },
      { id: '', name: 'broken', hiddenColIds: [] },
      { name: 'no-id', hiddenColIds: [] },
      {
        id: 'b',
        name: 'View B',
        hiddenColIds: ['y'],
        // sortState is invalid → should normalize to null
        sortState: { colId: 'y', px: 'sideways' },
        filterState: { y: ['1', '2'], bad: 'not-array' },
      },
    ]);
    const result = parseStoredViews(stored);
    expect(result).toEqual([
      {
        id: 'a',
        name: 'View A',
        hiddenColIds: ['x'],
        sortState: { colId: 'x', px: 'asc' },
        filterState: {},
      },
      {
        id: 'b',
        name: 'View B',
        hiddenColIds: ['y'],
        sortState: null,
        filterState: { y: ['1', '2'] },
      },
    ]);
  });
});

describe('computeViewApplication', () => {
  const gear = new Set(['name', 'amount']);
  const all = new Set(['name', 'amount', 'status']); // status is filter-only (not in gear)

  test('hides only gear-visible columns', () => {
    const result = computeViewApplication(
      view({ hiddenColIds: ['name', 'status', 'ghost'] }),
      gear,
      all,
    );
    expect(result.hiddenColIds).toEqual(new Set(['name']));
  });

  test('keeps sortState targeting any column in the full set', () => {
    const result = computeViewApplication(
      view({ sortState: { colId: 'status', px: 'desc' } }),
      gear,
      all,
    );
    expect(result.sortState).toEqual({ colId: 'status', px: 'desc' });
  });

  test('drops sortState targeting an unknown column', () => {
    const result = computeViewApplication(
      view({ sortState: { colId: 'ghost', px: 'asc' } }),
      gear,
      all,
    );
    expect(result.sortState).toBe(null);
  });

  test('keeps filter entries for filter-only columns', () => {
    const result = computeViewApplication(
      view({ filterState: { status: ['open'], ghost: ['x'], name: ['Acme'] } }),
      gear,
      all,
    );
    expect(result.filterState).toEqual({ status: ['open'], name: ['Acme'] });
  });

  test('handles missing filterState defensively', () => {
    const v = { ...view(), filterState: undefined as unknown as CustomView['filterState'] };
    const result = computeViewApplication(v, gear, all);
    expect(result.filterState).toEqual({});
  });
});

describe('reorderDropAbove', () => {
  test('moves an item upward (drop above earlier target)', () => {
    expect(reorderDropAbove(['A', 'B', 'C'], 2, 0)).toEqual(['C', 'A', 'B']);
  });

  test('moves an item downward and lands above the target (not below)', () => {
    // The off-by-one bug fixed in PR review: dragging A above C should yield
    // [B, A, C], not [B, C, A].
    expect(reorderDropAbove(['A', 'B', 'C'], 0, 2)).toEqual(['B', 'A', 'C']);
  });

  test('drop above adjacent item is a no-op for downward', () => {
    expect(reorderDropAbove(['A', 'B', 'C'], 0, 1)).toEqual(['A', 'B', 'C']);
  });

  test('drop above adjacent item moves for upward', () => {
    expect(reorderDropAbove(['A', 'B', 'C'], 1, 0)).toEqual(['B', 'A', 'C']);
  });

  test('returns the same reference when fromIdx === toIdx', () => {
    const arr = ['A', 'B', 'C'];
    expect(reorderDropAbove(arr, 1, 1)).toBe(arr);
  });

  test('returns the same reference for out-of-bounds indices', () => {
    const arr = ['A', 'B'];
    expect(reorderDropAbove(arr, -1, 0)).toBe(arr);
    expect(reorderDropAbove(arr, 0, -1)).toBe(arr);
    expect(reorderDropAbove(arr, 5, 0)).toBe(arr);
    expect(reorderDropAbove(arr, 0, 5)).toBe(arr);
  });

  test('does not mutate the original array', () => {
    const arr = ['A', 'B', 'C'];
    reorderDropAbove(arr, 0, 2);
    expect(arr).toEqual(['A', 'B', 'C']);
  });
});

describe('moveByDelta', () => {
  test('moves an item up one slot', () => {
    expect(moveByDelta(['A', 'B', 'C'], 1, -1)).toEqual(['B', 'A', 'C']);
  });

  test('moves an item down one slot', () => {
    expect(moveByDelta(['A', 'B', 'C'], 1, 1)).toEqual(['A', 'C', 'B']);
  });

  test('clamps at boundaries: returns same reference when moving above index 0', () => {
    const arr = ['A', 'B', 'C'];
    expect(moveByDelta(arr, 0, -1)).toBe(arr);
  });

  test('clamps at boundaries: returns same reference when moving below last index', () => {
    const arr = ['A', 'B', 'C'];
    expect(moveByDelta(arr, 2, 1)).toBe(arr);
  });

  test('returns same reference when idx is -1 (id not found)', () => {
    const arr = ['A', 'B', 'C'];
    expect(moveByDelta(arr, -1, 1)).toBe(arr);
  });

  test('does not mutate the original array', () => {
    const arr = ['A', 'B', 'C'];
    moveByDelta(arr, 0, 1);
    expect(arr).toEqual(['A', 'B', 'C']);
  });
});

describe('IMPORT_PAYLOAD_MAX_BYTES', () => {
  test('is set to a sane upper bound (100 KB)', () => {
    expect(IMPORT_PAYLOAD_MAX_BYTES).toBe(100_000);
  });
});

describe('filterStatesEqual', () => {
  test('treats two empty objects as equal', () => {
    expect(filterStatesEqual({}, {})).toBe(true);
  });

  test('returns false on different key counts', () => {
    expect(filterStatesEqual({ a: ['1'] }, {})).toBe(false);
    expect(filterStatesEqual({}, { a: ['1'] })).toBe(false);
    expect(filterStatesEqual({ a: ['1'] }, { a: ['1'], b: ['2'] })).toBe(false);
  });

  test('returns true when same keys with structurally equal arrays', () => {
    expect(filterStatesEqual({ a: ['1', '2'] }, { a: ['1', '2'] })).toBe(true);
  });

  test('returns false when value arrays differ in length', () => {
    expect(filterStatesEqual({ a: ['1'] }, { a: ['1', '2'] })).toBe(false);
  });

  test('returns false on differing values', () => {
    expect(filterStatesEqual({ a: ['1'] }, { a: ['2'] })).toBe(false);
  });

  test('returns false when key is missing', () => {
    expect(filterStatesEqual({ a: ['1'] }, { b: ['1'] })).toBe(false);
  });

  test('order matters within a value array', () => {
    expect(filterStatesEqual({ a: ['1', '2'] }, { a: ['2', '1'] })).toBe(false);
  });
});
