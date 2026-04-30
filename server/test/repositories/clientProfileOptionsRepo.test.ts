import { beforeEach, describe, expect, test } from 'bun:test';
import * as repo from '../../repositories/clientProfileOptionsRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const optionRow = {
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
    exec.enqueue({ rows: [optionRow] });
    const result = await repo.listByCategory('sector', exec);
    expect(exec.calls[0].sql).toContain('clients c WHERE c.sector = o.value');
    expect(exec.calls[0].sql).toContain('ORDER BY o.sort_order ASC, o.value ASC');
    expect(exec.calls[0].params).toEqual(['sector']);
    expect(result[0].usageCount).toBe(3);
  });

  test('embeds number_of_employees column when category=numberOfEmployees', async () => {
    exec.enqueue({ rows: [] });
    await repo.listByCategory('numberOfEmployees', exec);
    expect(exec.calls[0].sql).toContain('c.number_of_employees = o.value');
  });

  test('embeds office_count_range column when category=officeCountRange', async () => {
    exec.enqueue({ rows: [] });
    await repo.listByCategory('officeCountRange', exec);
    expect(exec.calls[0].sql).toContain('c.office_count_range = o.value');
  });
});

describe('findByCategoryAndId', () => {
  test('returns row when found', async () => {
    exec.enqueue({ rows: [{ id: 'cpo-1', value: 'tech' }] });
    const result = await repo.findByCategoryAndId('sector', 'cpo-1', exec);
    expect(result).toEqual({ id: 'cpo-1', value: 'tech' });
    expect(exec.calls[0].params).toEqual(['cpo-1', 'sector']);
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findByCategoryAndId('sector', 'missing', exec)).toBeNull();
  });
});

describe('findByCategoryAndValue', () => {
  test('omits id <> $3 when excludeId is null', async () => {
    exec.enqueue({ rows: [] });
    await repo.findByCategoryAndValue('sector', 'tech', null, exec);
    expect(exec.calls[0].sql).not.toContain('id <> $3');
    expect(exec.calls[0].params).toEqual(['sector', 'tech']);
  });

  test('includes id <> $3 when excludeId provided', async () => {
    exec.enqueue({ rows: [{ id: 'cpo-2' }] });
    const result = await repo.findByCategoryAndValue('sector', 'tech', 'cpo-1', exec);
    expect(exec.calls[0].sql).toContain('id <> $3');
    expect(exec.calls[0].params).toEqual(['sector', 'tech', 'cpo-1']);
    expect(result).toBe(true);
  });
});

describe('getNextSortOrder', () => {
  test('returns 1 when table is empty', async () => {
    exec.enqueue({ rows: [{ next_sort_order: 1 }] });
    expect(await repo.getNextSortOrder('sector', exec)).toBe(1);
  });

  test('returns max+1 when rows exist', async () => {
    exec.enqueue({ rows: [{ next_sort_order: '5' }] });
    expect(await repo.getNextSortOrder('sector', exec)).toBe(5);
  });
});

describe('create', () => {
  test('inserts and returns mapped row with usage_count=0', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'cpo-new',
          category: 'sector',
          value: 'finance',
          sort_order: 2,
          created_at: '2026-04-01T00:00:00Z',
          updated_at: null,
        },
      ],
    });
    const result = await repo.create(
      { id: 'cpo-new', category: 'sector', value: 'finance', sortOrder: 2 },
      exec,
    );
    expect(exec.calls[0].sql).toContain('INSERT INTO client_profile_options');
    expect(exec.calls[0].params).toEqual(['cpo-new', 'sector', 'finance', 2]);
    expect(result.usageCount).toBe(0);
    expect(result.value).toBe('finance');
  });
});

describe('update', () => {
  test('updates option only when value did not change (no cascade)', async () => {
    exec.enqueue({ rows: [], rowCount: 1 }); // UPDATE option
    exec.enqueue({ rows: [optionRow] }); // SELECT updated
    const result = await repo.update(
      'sector',
      'cpo-1',
      { value: 'tech', sortOrder: null, previousValue: 'tech' },
      exec,
    );
    // Only 2 calls (UPDATE option, SELECT) — no cascade UPDATE
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('UPDATE client_profile_options');
    expect(exec.calls[1].sql).toContain('o.id = $1 AND o.category = $2');
    expect(exec.calls[1].params).toEqual(['cpo-1', 'sector']);
    expect(result?.value).toBe('tech');
  });

  test('cascades to clients table via internal allowlist when value changes (sector)', async () => {
    exec.enqueue({ rows: [], rowCount: 1 }); // UPDATE option
    exec.enqueue({ rows: [], rowCount: 5 }); // cascade UPDATE clients
    exec.enqueue({ rows: [{ ...optionRow, value: 'finance' }] });
    await repo.update(
      'sector',
      'cpo-1',
      { value: 'finance', sortOrder: null, previousValue: 'tech' },
      exec,
    );
    expect(exec.calls).toHaveLength(3);
    expect(exec.calls[1].sql).toContain('UPDATE clients SET sector = $1 WHERE sector = $2');
    expect(exec.calls[1].params).toEqual(['finance', 'tech']);
  });

  test('cascade for officeCountRange uses office_count_range column', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    exec.enqueue({ rows: [], rowCount: 1 });
    exec.enqueue({ rows: [{ ...optionRow, category: 'officeCountRange', value: '2-5' }] });
    await repo.update(
      'officeCountRange',
      'cpo-2',
      { value: '2-5', sortOrder: null, previousValue: '1' },
      exec,
    );
    expect(exec.calls[1].sql).toContain(
      'UPDATE clients SET office_count_range = $1 WHERE office_count_range = $2',
    );
  });

  test('returns null and skips cascade/select when option UPDATE matched no rows', async () => {
    exec.enqueue({ rows: [], rowCount: 0 }); // UPDATE option matched nothing (e.g., concurrent delete)
    const result = await repo.update(
      'sector',
      'cpo-x',
      { value: 'finance', sortOrder: null, previousValue: 'tech' },
      exec,
    );
    expect(result).toBeNull();
    // Cascade UPDATE clients and final SELECT both skipped
    expect(exec.calls).toHaveLength(1);
  });
});

describe('getUsageCount', () => {
  test('returns 0 when no rows match', async () => {
    exec.enqueue({ rows: [{ usage_count: '0' }] });
    expect(await repo.getUsageCount('sector', 'cpo-1', exec)).toBe(0);
  });

  test('parses count as a JS number', async () => {
    exec.enqueue({ rows: [{ usage_count: '7' }] });
    expect(await repo.getUsageCount('sector', 'cpo-1', exec)).toBe(7);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await repo.deleteById('cpo-1', exec)).toBe(true);
  });

  test('returns false when no row matched', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await repo.deleteById('cpo-x', exec)).toBe(false);
  });
});
