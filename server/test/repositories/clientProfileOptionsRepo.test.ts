import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as repo from '../../repositories/clientProfileOptionsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// listByCategory/getUsageCount/update use executeRows for the usage_count subquery — rows
// come back with snake_case named keys (matching the SQL aliases). findByCategoryAndId,
// findByCategoryAndValue, getNextSortOrder, create, deleteById use the query builder
// (rowMode: 'array' positional rows in schema declaration order).
//
// Schema column order: id, category, value, sort_order, created_at, updated_at
const optionPositionalRow: readonly unknown[] = [
  'cpo-1',
  'sector',
  'tech',
  1,
  new Date('2026-01-01T00:00:00Z'),
  null,
];

const optionAggRow = {
  id: 'cpo-1',
  category: 'sector',
  value: 'tech',
  sort_order: 1,
  usage_count: 3,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
};

describe('listByCategory', () => {
  test('embeds the correct usage-count subquery for sector', async () => {
    exec.enqueue({ rows: [optionAggRow] });
    const result = await repo.listByCategory('sector', testDb);
    expect(exec.calls[0].sql).toContain('"sector"');
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by o.sort_order asc, o.value asc');
    expect(exec.calls[0].params).toContain('sector');
    expect(result[0].usageCount).toBe(3);
  });

  test('embeds number_of_employees column when category=numberOfEmployees', async () => {
    exec.enqueue({ rows: [] });
    await repo.listByCategory('numberOfEmployees', testDb);
    expect(exec.calls[0].sql).toContain('"number_of_employees"');
  });

  test('embeds office_count_range column when category=officeCountRange', async () => {
    exec.enqueue({ rows: [] });
    await repo.listByCategory('officeCountRange', testDb);
    expect(exec.calls[0].sql).toContain('"office_count_range"');
  });
});

describe('findByCategoryAndId', () => {
  test('returns row when found', async () => {
    exec.enqueue({ rows: [['cpo-1', 'tech']] });
    const result = await repo.findByCategoryAndId('sector', 'cpo-1', testDb);
    expect(result).toEqual({ id: 'cpo-1', value: 'tech' });
    expect(exec.calls[0].params).toContain('cpo-1');
    expect(exec.calls[0].params).toContain('sector');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findByCategoryAndId('sector', 'missing', testDb)).toBeNull();
  });
});

describe('findByCategoryAndValue', () => {
  test('omits id <> when excludeId is null', async () => {
    exec.enqueue({ rows: [] });
    await repo.findByCategoryAndValue('sector', 'tech', null, testDb);
    expect(exec.calls[0].sql.toLowerCase()).not.toMatch(/"id"\s*<>/);
    expect(exec.calls[0].params).toContain('sector');
    expect(exec.calls[0].params).toContain('tech');
  });

  test('includes id <> when excludeId provided', async () => {
    exec.enqueue({ rows: [['cpo-2']] });
    const result = await repo.findByCategoryAndValue('sector', 'tech', 'cpo-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toMatch(/"id"\s*<>/);
    expect(exec.calls[0].params).toContain('cpo-1');
    expect(result).toBe(true);
  });
});

describe('getNextSortOrder', () => {
  test('returns 1 when table is empty', async () => {
    exec.enqueue({ rows: [[1]] });
    expect(await repo.getNextSortOrder('sector', testDb)).toBe(1);
  });

  test('returns max+1 when rows exist', async () => {
    exec.enqueue({ rows: [['5']] });
    expect(await repo.getNextSortOrder('sector', testDb)).toBe(5);
  });
});

describe('create', () => {
  test('inserts and returns mapped row with usage_count=0', async () => {
    exec.enqueue({ rows: [optionPositionalRow] });
    const result = await repo.create(
      { id: 'cpo-1', category: 'sector', value: 'tech', sortOrder: 1 },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "client_profile_options"');
    expect(exec.calls[0].params).toContain('cpo-1');
    expect(exec.calls[0].params).toContain('sector');
    expect(exec.calls[0].params).toContain('tech');
    expect(result.usageCount).toBe(0);
    expect(result.value).toBe('tech');
  });
});

describe('update', () => {
  test('updates option only when value did not change (no cascade)', async () => {
    exec.enqueue({ rows: [], rowCount: 1 }); // UPDATE option
    exec.enqueue({ rows: [optionAggRow] }); // SELECT updated row via executeRows
    const result = await repo.update(
      'sector',
      'cpo-1',
      { value: 'tech', sortOrder: null, previousValue: 'tech' },
      testDb,
    );
    // 2 calls only — no cascade UPDATE clients
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('update "client_profile_options"');
    expect(result?.value).toBe('tech');
  });

  test('cascades to clients table via internal allowlist when value changes (sector)', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    exec.enqueue({ rows: [], rowCount: 5 });
    exec.enqueue({ rows: [{ ...optionAggRow, value: 'finance' }] });
    await repo.update(
      'sector',
      'cpo-1',
      { value: 'finance', sortOrder: null, previousValue: 'tech' },
      testDb,
    );
    expect(exec.calls).toHaveLength(3);
    expect(exec.calls[1].sql.toLowerCase()).toContain('update clients set "sector"');
    expect(exec.calls[1].params).toContain('finance');
    expect(exec.calls[1].params).toContain('tech');
  });

  test('cascade for officeCountRange uses office_count_range column', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    exec.enqueue({ rows: [], rowCount: 1 });
    exec.enqueue({ rows: [{ ...optionAggRow, category: 'officeCountRange', value: '2-5' }] });
    await repo.update(
      'officeCountRange',
      'cpo-2',
      { value: '2-5', sortOrder: null, previousValue: '1' },
      testDb,
    );
    expect(exec.calls[1].sql.toLowerCase()).toContain('update clients set "office_count_range"');
  });

  test('returns null and skips cascade/select when option UPDATE matched no rows', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    const result = await repo.update(
      'sector',
      'cpo-x',
      { value: 'finance', sortOrder: null, previousValue: 'tech' },
      testDb,
    );
    expect(result).toBeNull();
    expect(exec.calls).toHaveLength(1);
  });
});

describe('getUsageCount', () => {
  test('returns 0 when no rows match', async () => {
    exec.enqueue({ rows: [{ usage_count: '0' }] });
    expect(await repo.getUsageCount('sector', 'cpo-1', testDb)).toBe(0);
  });

  test('parses count as a JS number', async () => {
    exec.enqueue({ rows: [{ usage_count: '7' }] });
    expect(await repo.getUsageCount('sector', 'cpo-1', testDb)).toBe(7);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await repo.deleteById('cpo-1', testDb)).toBe(true);
  });

  test('returns false when no row matched', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await repo.deleteById('cpo-x', testDb)).toBe(false);
  });
});
