import { beforeEach, describe, expect, test } from 'bun:test';
import * as workUnitsRepo from '../../repositories/workUnitsRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const row = {
  id: 'wu-1',
  name: 'Engineering',
  description: 'Eng team',
  isDisabled: false,
  managers: [{ id: 'u-1', name: 'Alice' }],
  userCount: 7,
};

describe('findById', () => {
  test('passes id as $1 and returns the row', async () => {
    exec.enqueue({ rows: [row] });
    const result = await workUnitsRepo.findById('wu-1', exec);
    expect(exec.calls[0].params).toEqual(['wu-1']);
    expect(result).toEqual(row);
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.findById('wu-x', exec)).toBeNull();
  });
});

describe('listAll', () => {
  test('takes no params and returns rows', async () => {
    exec.enqueue({ rows: [row, { ...row, id: 'wu-2', userCount: 3 }] });
    const result = await workUnitsRepo.listAll(exec);
    expect(exec.calls[0].params).toEqual([]);
    expect(result).toHaveLength(2);
    expect(result[1].userCount).toBe(3);
  });
});

describe('listManagedBy', () => {
  test('passes manager id as $1', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.listManagedBy('u-1', exec);
    expect(exec.calls[0].params).toEqual(['u-1']);
  });
});

describe('create', () => {
  test('passes [id, name, description] from object', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.create({ id: 'wu-1', name: 'Eng', description: 'desc' }, exec);
    expect(exec.calls[0].params).toEqual(['wu-1', 'Eng', 'desc']);
  });

  test('null description is passed through as null', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.create({ id: 'wu-1', name: 'Eng', description: null }, exec);
    expect(exec.calls[0].params).toEqual(['wu-1', 'Eng', null]);
  });
});

describe('addManagers', () => {
  test('skips query when userIds is empty', async () => {
    await workUnitsRepo.addManagers('wu-1', [], exec);
    expect(exec.calls).toHaveLength(0);
  });

  test('passes [unitId, userIds] for batched insert', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.addManagers('wu-1', ['u-1', 'u-2'], exec);
    expect(exec.calls[0].params).toEqual(['wu-1', ['u-1', 'u-2']]);
    expect(exec.calls[0].sql).toContain('unnest($2::text[])');
  });
});

describe('addUsersToUnit', () => {
  test('skips query when userIds is empty', async () => {
    await workUnitsRepo.addUsersToUnit('wu-1', [], exec);
    expect(exec.calls).toHaveLength(0);
  });

  test('passes [unitId, userIds] and uses ON CONFLICT DO NOTHING', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.addUsersToUnit('wu-1', ['u-1', 'u-2'], exec);
    expect(exec.calls[0].params).toEqual(['wu-1', ['u-1', 'u-2']]);
    expect(exec.calls[0].sql).toContain('ON CONFLICT DO NOTHING');
  });
});

describe('lockById', () => {
  test('uses FOR UPDATE and returns true when row exists', async () => {
    exec.enqueue({ rows: [{ id: 'wu-1' }] });
    const result = await workUnitsRepo.lockById('wu-1', exec);
    expect(exec.calls[0].sql).toContain('FOR UPDATE');
    expect(result).toBe(true);
  });

  test('returns false when row missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.lockById('wu-x', exec)).toBe(false);
  });
});

describe('updateFields', () => {
  test('skips query entirely when no fields provided', async () => {
    await workUnitsRepo.updateFields('wu-1', {}, exec);
    expect(exec.calls).toHaveLength(0);
  });

  test('builds SET list from provided fields, id last', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.updateFields(
      'wu-1',
      { name: 'New', description: 'D', isDisabled: true },
      exec,
    );
    const call = exec.calls[0];
    expect(call.sql).toContain('name = $1');
    expect(call.sql).toContain('description = $2');
    expect(call.sql).toContain('is_disabled = $3');
    expect(call.sql).toContain('WHERE id = $4');
    expect(call.params).toEqual(['New', 'D', true, 'wu-1']);
  });

  test('only includes the fields that are defined', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.updateFields('wu-1', { name: 'New' }, exec);
    const call = exec.calls[0];
    expect(call.params).toEqual(['New', 'wu-1']);
    expect(call.sql).not.toContain('description');
    expect(call.sql).not.toContain('is_disabled');
  });

  test('null description is treated as a value to set, not skipped', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.updateFields('wu-1', { description: null }, exec);
    expect(exec.calls[0].params).toEqual([null, 'wu-1']);
  });
});

describe('clearManagers / clearUsers', () => {
  test('clearManagers passes unitId', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.clearManagers('wu-1', exec);
    expect(exec.calls[0].params).toEqual(['wu-1']);
    expect(exec.calls[0].sql).toContain('work_unit_managers');
  });

  test('clearUsers passes unitId', async () => {
    exec.enqueue({ rows: [] });
    await workUnitsRepo.clearUsers('wu-1', exec);
    expect(exec.calls[0].params).toEqual(['wu-1']);
    expect(exec.calls[0].sql).toContain('user_work_units');
  });
});

describe('deleteById', () => {
  test('returns deleted row when found', async () => {
    exec.enqueue({ rows: [{ name: 'Eng' }] });
    const result = await workUnitsRepo.deleteById('wu-1', exec);
    expect(result).toEqual({ name: 'Eng' });
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.deleteById('wu-x', exec)).toBeNull();
  });
});

describe('findUserIds', () => {
  test('maps rows to id array', async () => {
    exec.enqueue({ rows: [{ id: 'u-1' }, { id: 'u-2' }] });
    const result = await workUnitsRepo.findUserIds('wu-1', exec);
    expect(result).toEqual(['u-1', 'u-2']);
    expect(exec.calls[0].params).toEqual(['wu-1']);
  });
});

describe('findNameById', () => {
  test('returns name when found', async () => {
    exec.enqueue({ rows: [{ name: 'Eng' }] });
    expect(await workUnitsRepo.findNameById('wu-1', exec)).toBe('Eng');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.findNameById('wu-x', exec)).toBeNull();
  });
});

describe('isUserManagerOfUnit', () => {
  test('passes [unitId, userId]', async () => {
    exec.enqueue({ rows: [{ '?column?': 1 }] });
    const result = await workUnitsRepo.isUserManagerOfUnit('u-1', 'wu-1', exec);
    expect(exec.calls[0].params).toEqual(['wu-1', 'u-1']);
    expect(result).toBe(true);
  });

  test('returns false when no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.isUserManagerOfUnit('u-1', 'wu-1', exec)).toBe(false);
  });
});

describe('isUserManagedBy', () => {
  test('passes [managerId, targetUserId]', async () => {
    exec.enqueue({ rows: [{ '?column?': 1 }] });
    const result = await workUnitsRepo.isUserManagedBy('mgr', 'target', exec);
    expect(exec.calls[0].params).toEqual(['mgr', 'target']);
    expect(result).toBe(true);
  });

  test('returns false when no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await workUnitsRepo.isUserManagedBy('mgr', 'target', exec)).toBe(false);
  });
});
