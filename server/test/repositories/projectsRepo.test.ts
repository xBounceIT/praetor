import { beforeEach, describe, expect, test } from 'bun:test';
import * as projectsRepo from '../../repositories/projectsRepo.ts';
import {
  MANUAL_ASSIGNMENT_SOURCE,
  PROJECT_CASCADE_ASSIGNMENT_SOURCE,
  TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
} from '../../utils/top-manager-assignments.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const rawRow = {
  id: 'p-1',
  name: 'Alpha',
  client_id: 'c-1',
  color: '#3b82f6',
  description: 'desc',
  is_disabled: false,
  created_at: new Date('2026-04-30T12:00:00Z'),
  order_id: null,
};

const mappedRow = {
  id: 'p-1',
  name: 'Alpha',
  clientId: 'c-1',
  color: '#3b82f6',
  description: 'desc',
  isDisabled: false,
  createdAt: new Date('2026-04-30T12:00:00Z').getTime(),
  orderId: null,
};

describe('listAll', () => {
  test('returns mapped rows', async () => {
    exec.enqueue({ rows: [rawRow] });
    expect(await projectsRepo.listAll(exec)).toEqual([mappedRow]);
    expect(exec.calls[0].params).toEqual([]);
  });
});

describe('listForUser', () => {
  test('passes userId as $1 and joins user_projects', async () => {
    exec.enqueue({ rows: [rawRow] });
    await projectsRepo.listForUser('u-1', exec);
    expect(exec.calls[0].params).toEqual(['u-1']);
    expect(exec.calls[0].sql).toContain('INNER JOIN user_projects');
  });
});

describe('findClientId', () => {
  test('returns client_id when found', async () => {
    exec.enqueue({ rows: [{ client_id: 'c-1' }] });
    expect(await projectsRepo.findClientId('p-1', exec)).toBe('c-1');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await projectsRepo.findClientId('p-x', exec)).toBeNull();
  });
});

describe('lockClientIdById', () => {
  test('uses FOR UPDATE', async () => {
    exec.enqueue({ rows: [{ client_id: 'c-1' }] });
    await projectsRepo.lockClientIdById('p-1', exec);
    expect(exec.calls[0].sql).toContain('FOR UPDATE');
  });
});

describe('lockNameAndClientById', () => {
  test('returns mapped object when found', async () => {
    exec.enqueue({ rows: [{ name: 'Alpha', client_id: 'c-1' }] });
    expect(await projectsRepo.lockNameAndClientById('p-1', exec)).toEqual({
      name: 'Alpha',
      clientId: 'c-1',
    });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await projectsRepo.lockNameAndClientById('p-x', exec)).toBeNull();
  });
});

describe('create', () => {
  test('passes 7 columns in order (incl. order_id) and returns the mapped row', async () => {
    exec.enqueue({ rows: [rawRow] });
    const created = await projectsRepo.create(
      {
        id: 'p-1',
        name: 'Alpha',
        clientId: 'c-1',
        color: '#3b82f6',
        description: 'desc',
        isDisabled: false,
      },
      exec,
    );
    expect(exec.calls[0].params).toEqual(['p-1', 'Alpha', 'c-1', '#3b82f6', 'desc', false, null]);
    expect(exec.calls[0].sql).toContain('RETURNING');
    expect(created).toEqual(mappedRow);
  });

  test('forwards orderId when provided', async () => {
    exec.enqueue({ rows: [{ ...rawRow, order_id: 'so-7' }] });
    const created = await projectsRepo.create(
      {
        id: 'p-1',
        name: 'Alpha',
        clientId: 'c-1',
        color: '#3b82f6',
        description: 'desc',
        isDisabled: false,
        orderId: 'so-7',
      },
      exec,
    );
    expect(exec.calls[0].params[6]).toBe('so-7');
    expect(created.orderId).toBe('so-7');
  });
});

describe('update', () => {
  test('only sets provided fields and returns mapped row', async () => {
    exec.enqueue({ rows: [rawRow] });
    const result = await projectsRepo.update('p-1', { name: 'New' }, exec);
    expect(result).toEqual(mappedRow);
    expect(exec.calls[0].sql).toContain('SET name = $1');
    expect(exec.calls[0].sql).toContain('WHERE id = $2');
    expect(exec.calls[0].params).toEqual(['New', 'p-1']);
  });

  test('explicit null clears the column', async () => {
    exec.enqueue({ rows: [rawRow] });
    await projectsRepo.update('p-1', { description: null }, exec);
    expect(exec.calls[0].sql).toContain('description = $1');
    expect(exec.calls[0].params).toEqual([null, 'p-1']);
  });

  test('omitting all fields falls back to a SELECT (no UPDATE issued)', async () => {
    exec.enqueue({ rows: [rawRow] });
    const result = await projectsRepo.update('p-1', {}, exec);
    expect(exec.calls[0].sql).not.toContain('UPDATE');
    expect(exec.calls[0].sql).toContain('SELECT');
    expect(result).toEqual(mappedRow);
  });

  test('returns null when no row matched (UPDATE path)', async () => {
    exec.enqueue({ rows: [] });
    expect(await projectsRepo.update('p-x', { name: 'X' }, exec)).toBeNull();
  });
});

describe('deleteById', () => {
  test('passes id as $1', async () => {
    exec.enqueue({ rows: [] });
    await projectsRepo.deleteById('p-1', exec);
    expect(exec.calls[0].params).toEqual(['p-1']);
  });
});

describe('findAssignedUserIds', () => {
  test('maps user_id rows to string array', async () => {
    exec.enqueue({ rows: [{ user_id: 'u-1' }, { user_id: 'u-2' }] });
    expect(await projectsRepo.findAssignedUserIds('p-1', exec)).toEqual(['u-1', 'u-2']);
  });
});

describe('findNonTopManagerUserIds', () => {
  test('passes [projectId, top_manager_auto] in that order', async () => {
    exec.enqueue({ rows: [{ user_id: 'u-1' }] });
    const result = await projectsRepo.findNonTopManagerUserIds('p-1', exec);
    expect(result).toEqual(['u-1']);
    expect(exec.calls[0].params).toEqual(['p-1', TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE]);
  });
});

describe('clearNonTopManagerAssignments', () => {
  test('uses != on assignment_source', async () => {
    exec.enqueue({ rows: [] });
    await projectsRepo.clearNonTopManagerAssignments('p-1', exec);
    expect(exec.calls[0].sql).toContain('assignment_source != $2');
    expect(exec.calls[0].params).toEqual(['p-1', TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE]);
  });
});

describe('addManualAssignments', () => {
  test('skips query when userIds is empty', async () => {
    await projectsRepo.addManualAssignments('p-1', [], exec);
    expect(exec.calls).toHaveLength(0);
  });

  test('uses MANUAL source and ON CONFLICT DO NOTHING with batch', async () => {
    exec.enqueue({ rows: [] });
    await projectsRepo.addManualAssignments('p-1', ['u-1', 'u-2'], exec);
    expect(exec.calls[0].params).toEqual([['u-1', 'u-2'], 'p-1', MANUAL_ASSIGNMENT_SOURCE]);
    expect(exec.calls[0].sql).toContain('ON CONFLICT DO NOTHING');
  });
});

describe('ensureClientCascadeAssignments', () => {
  test('skips query when userIds is empty', async () => {
    await projectsRepo.ensureClientCascadeAssignments([], 'c-1', exec);
    expect(exec.calls).toHaveLength(0);
  });

  test('uses PROJECT_CASCADE source on user_clients with batch', async () => {
    exec.enqueue({ rows: [] });
    await projectsRepo.ensureClientCascadeAssignments(['u-1', 'u-2'], 'c-1', exec);
    expect(exec.calls[0].sql).toContain('user_clients');
    expect(exec.calls[0].params).toEqual([
      ['u-1', 'u-2'],
      'c-1',
      PROJECT_CASCADE_ASSIGNMENT_SOURCE,
    ]);
  });
});

describe('removeClientCascadeForUsersIfUnused', () => {
  test('skips query when userIds is empty', async () => {
    await projectsRepo.removeClientCascadeForUsersIfUnused([], 'c-1', exec);
    expect(exec.calls).toHaveLength(0);
  });

  test('passes user ids as array param and uses ANY', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    await projectsRepo.removeClientCascadeForUsersIfUnused(['u-1', 'u-2'], 'c-1', exec);
    expect(exec.calls[0].params).toEqual([
      ['u-1', 'u-2'],
      'c-1',
      PROJECT_CASCADE_ASSIGNMENT_SOURCE,
    ]);
    expect(exec.calls[0].sql).toContain('ANY($1::text[])');
  });
});
