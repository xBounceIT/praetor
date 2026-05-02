import { beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { type DbExecutor, executeRows } from '../../db/drizzle.ts';
import * as workUnitsRepo from '../../repositories/workUnitsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// findById/listAll/listManagedBy use executeRows with raw SQL — rows come back with
// the camelCase keys that the SELECT aliases produce ("isDisabled", "userCount", etc.).
// Other functions use the Drizzle query builder, which returns rows in `rowMode: 'array'`
// (positional arrays). Fixtures below are tagged with the path they exercise.
const aggRow = {
  id: 'wu-1',
  name: 'Engineering',
  description: 'Eng team',
  isDisabled: false,
  managers: [{ id: 'u-1', name: 'Alice' }],
  userCount: 7,
};

describe('findById', () => {
  test('passes id and returns the row', async () => {
    exec.enqueue({ rows: [aggRow] });
    const result = await workUnitsRepo.findById('wu-1', testDb);
    expect(exec.calls[0].params).toContain('wu-1');
    expect(result).toEqual(aggRow);
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.findById('wu-x', testDb)).toBeNull();
  });
});

describe('listAll', () => {
  test('takes no params and returns rows', async () => {
    exec.enqueue({ rows: [aggRow, { ...aggRow, id: 'wu-2', userCount: 3 }] });
    const result = await workUnitsRepo.listAll(testDb);
    expect(exec.calls[0].params).toEqual([]);
    expect(result).toHaveLength(2);
    expect(result[1].userCount).toBe(3);
  });
});

describe('listManagedBy', () => {
  test('passes manager id', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.listManagedBy('u-1', testDb);
    expect(exec.calls[0].params).toContain('u-1');
  });
});

describe('create', () => {
  test('passes id, name, description', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.create({ id: 'wu-1', name: 'Eng', description: 'desc' }, testDb);
    expect(exec.calls[0].params).toContain('wu-1');
    expect(exec.calls[0].params).toContain('Eng');
    expect(exec.calls[0].params).toContain('desc');
  });

  test('null description is passed through as null', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.create({ id: 'wu-1', name: 'Eng', description: null }, testDb);
    expect(exec.calls[0].params).toContain(null);
  });
});

describe('addManagers', () => {
  test('skips query when userIds is empty', async () => {
    await workUnitsRepo.addManagers('wu-1', [], testDb);
    expect(exec.calls).toHaveLength(0);
  });

  test('binds userIds as a single text[] param via unnest', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.addManagers('wu-1', ['u-1', 'u-2'], testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('insert into work_unit_managers');
    expect(sql).toContain('unnest(');
    expect(sql).toContain('on conflict do nothing');
    expect(exec.calls[0].params).toContain('wu-1');
    expect(exec.calls[0].params).toContainEqual(['u-1', 'u-2']);
  });
});

describe('addUsersToUnit', () => {
  test('skips query when userIds is empty', async () => {
    await workUnitsRepo.addUsersToUnit('wu-1', [], testDb);
    expect(exec.calls).toHaveLength(0);
  });

  test('binds userIds as a single text[] param via unnest', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.addUsersToUnit('wu-1', ['u-1', 'u-2'], testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('insert into user_work_units');
    expect(sql).toContain('unnest(');
    expect(sql).toContain('on conflict do nothing');
    expect(exec.calls[0].params).toContain('wu-1');
    expect(exec.calls[0].params).toContainEqual(['u-1', 'u-2']);
  });
});

describe('lockById', () => {
  test('uses FOR UPDATE and returns true when row exists', async () => {
    exec.enqueue({ rows: [['wu-1']] });
    const result = await workUnitsRepo.lockById('wu-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('for update');
    expect(result).toBe(true);
  });

  test('returns false when row missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.lockById('wu-x', testDb)).toBe(false);
  });
});

describe('updateFields', () => {
  test('skips query entirely when no fields provided', async () => {
    await workUnitsRepo.updateFields('wu-1', {}, testDb);
    expect(exec.calls).toHaveLength(0);
  });

  test('builds SET list from provided fields, id last', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.updateFields(
      'wu-1',
      { name: 'New', description: 'D', isDisabled: true },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"name" = $1');
    expect(sql).toContain('"description" = $2');
    expect(sql).toContain('"is_disabled" = $3');
    expect(sql).toContain('= $4');
    expect(exec.calls[0].params).toEqual(['New', 'D', true, 'wu-1']);
  });

  test('only includes the fields that are defined', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.updateFields('wu-1', { name: 'New' }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(exec.calls[0].params).toEqual(['New', 'wu-1']);
    expect(sql).not.toMatch(/"description"\s*=\s*\$/);
    expect(sql).not.toMatch(/"is_disabled"\s*=\s*\$/);
  });

  test('null description is treated as a value to set, not skipped', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.updateFields('wu-1', { description: null }, testDb);
    expect(exec.calls[0].params).toEqual([null, 'wu-1']);
  });
});

describe('clearManagers / clearUsers', () => {
  test('clearManagers passes unitId', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.clearManagers('wu-1', testDb);
    expect(exec.calls[0].params).toContain('wu-1');
    expect(exec.calls[0].sql.toLowerCase()).toContain('"work_unit_managers"');
  });

  test('clearUsers passes unitId', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.clearUsers('wu-1', testDb);
    expect(exec.calls[0].params).toContain('wu-1');
    expect(exec.calls[0].sql.toLowerCase()).toContain('"user_work_units"');
  });
});

describe('deleteById', () => {
  test('returns deleted row when found', async () => {
    exec.enqueue({ rows: [['Eng']] });
    const result = await workUnitsRepo.deleteById('wu-1', testDb);
    expect(result).toEqual({ name: 'Eng' });
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.deleteById('wu-x', testDb)).toBeNull();
  });
});

describe('findUserIds', () => {
  test('maps rows to id array', async () => {
    exec.enqueue({ rows: [{ id: 'u-1' }, { id: 'u-2' }] });
    const result = await workUnitsRepo.findUserIds('wu-1', testDb);
    expect(result).toEqual(['u-1', 'u-2']);
    expect(exec.calls[0].params).toContain('wu-1');
  });
});

describe('findNameById', () => {
  test('returns name when found', async () => {
    exec.enqueue({ rows: [['Eng']] });
    expect(await workUnitsRepo.findNameById('wu-1', testDb)).toBe('Eng');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.findNameById('wu-x', testDb)).toBeNull();
  });
});

describe('isUserManagerOfUnit', () => {
  test('passes [unitId, userId] and returns true on match', async () => {
    exec.enqueue({ rows: [[1]] });
    const result = await workUnitsRepo.isUserManagerOfUnit('u-1', 'wu-1', testDb);
    expect(exec.calls[0].params).toContain('wu-1');
    expect(exec.calls[0].params).toContain('u-1');
    expect(result).toBe(true);
  });

  test('returns false when no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.isUserManagerOfUnit('u-1', 'wu-1', testDb)).toBe(false);
  });
});

describe('isUserManagedBy', () => {
  test('passes [managerId, targetUserId] and returns true on match', async () => {
    exec.enqueue({ rows: [[1]] });
    const result = await workUnitsRepo.isUserManagedBy('mgr', 'target', testDb);
    expect(exec.calls[0].params).toContain('mgr');
    expect(exec.calls[0].params).toContain('target');
    expect(result).toBe(true);
  });

  test('returns false when no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.isUserManagedBy('mgr', 'target', testDb)).toBe(false);
  });
});

describe('listManagedUserIds', () => {
  test('selects DISTINCT user_id joined through work_unit_managers and maps to strings', async () => {
    exec.enqueue({ rows: [{ user_id: 'u-1' }, { user_id: 'u-2' }] });
    const result = await workUnitsRepo.listManagedUserIds('mgr', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('select distinct');
    expect(sql).toContain('user_work_units');
    expect(sql).toContain('work_unit_managers');
    expect(exec.calls[0].params).toContain('mgr');
    expect(result).toEqual(['u-1', 'u-2']);
  });

  test('filters falsy values from the result', async () => {
    exec.enqueue({ rows: [{ user_id: 'u-1' }, { user_id: '' }] });
    const result = await workUnitsRepo.listManagedUserIds('mgr', testDb);
    expect(result).toEqual(['u-1']);
  });
});

describe('managedUserIdsSubquerySql', () => {
  test('returns a SQL fragment that binds managerId and joins the right tables when embedded', async () => {
    exec.enqueue({ rows: [] });
    const fragment = workUnitsRepo.managedUserIdsSubquerySql('mgr');
    await executeRows(testDb, sql`SELECT id FROM users WHERE id IN (${fragment})`);
    const emitted = exec.calls[0].sql.toLowerCase();
    expect(emitted).toContain('user_work_units');
    expect(emitted).toContain('work_unit_managers');
    expect(emitted).toContain('wum.user_id =');
    expect(exec.calls[0].params).toContain('mgr');
  });
});
