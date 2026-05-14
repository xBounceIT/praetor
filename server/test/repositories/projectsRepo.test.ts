import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as projectsRepo from '../../repositories/projectsRepo.ts';
import * as userAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import { ForeignKeyError } from '../../utils/http-errors.ts';
import { makeDbError } from '../helpers/dbErrors.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

// Local destructure: the namespace import satisfies CLAUDE.md, and shorter names keep the
// per-row assertion bodies readable.
const {
  MANUAL_ASSIGNMENT_SOURCE,
  PROJECT_CASCADE_ASSIGNMENT_SOURCE,
  TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
} = userAssignmentsRepo;

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// listAll/findClientId/lockClientIdById/lockNameAndClientById/create/update/deleteById use the
// query builder (rowMode: 'array' positional rows in schema declaration order). listForUser
// and the user_projects/user_clients-touching helpers use executeRows (named-key rows).
//
// Schema column order: id, name, client_id, color, description, is_disabled, created_at, order_id,
// offer_id, start_date, end_date, revenue, billing_type, billing_frequency
const PROJECT_ROW: readonly unknown[] = [
  'p-1',
  'Alpha',
  'c-1',
  '#3b82f6',
  'desc',
  false,
  new Date('2026-04-30T12:00:00Z'),
  null,
  null,
  null,
  null,
  null,
  'time_and_materials',
  'monthly',
];

const mappedRow: projectsRepo.Project = {
  id: 'p-1',
  name: 'Alpha',
  clientId: 'c-1',
  color: '#3b82f6',
  description: 'desc',
  isDisabled: false,
  createdAt: new Date('2026-04-30T12:00:00Z').getTime(),
  orderId: null,
  offerId: null,
  startDate: null,
  endDate: null,
  revenue: null,
  billingType: 'time_and_materials',
  billingFrequency: 'monthly',
};

const rawProjectRow = {
  id: 'p-1',
  name: 'Alpha',
  client_id: 'c-1',
  color: '#3b82f6',
  description: 'desc',
  is_disabled: false,
  created_at: new Date('2026-04-30T12:00:00Z'),
  order_id: null,
  offer_id: null,
  start_date: null,
  end_date: null,
  revenue: null,
  billing_type: 'time_and_materials',
  billing_frequency: 'monthly',
};

describe('listAll', () => {
  test('returns mapped rows', async () => {
    exec.enqueue({ rows: [rawProjectRow] });
    expect(await projectsRepo.listAll(testDb)).toEqual([mappedRow]);
    expect(exec.calls[0].params).toEqual([]);
    expect(exec.calls[0].sql).toContain('billing_type');
  });

  test('maps derived mixed billing type', async () => {
    exec.enqueue({ rows: [{ ...rawProjectRow, billing_type: 'mixed' }] });
    const result = await projectsRepo.listAll(testDb);
    expect(result[0].billingType).toBe('mixed');
  });
});

describe('listForUser', () => {
  test('passes userId and joins user_projects (raw SQL)', async () => {
    exec.enqueue({
      rows: [rawProjectRow],
    });
    const result = await projectsRepo.listForUser('u-1', testDb);
    expect(exec.calls[0].params).toContain('u-1');
    expect(exec.calls[0].sql).toContain('INNER JOIN user_projects');
    expect(result[0]).toEqual(mappedRow);
  });
});

describe('listByIds', () => {
  test('returns mapped projects for the provided ids', async () => {
    exec.enqueue({ rows: [rawProjectRow] });

    const result = await projectsRepo.listByIds(['p-1'], testDb);

    expect(exec.calls[0].sql).toContain('WHERE p.id = ANY');
    expect(exec.calls[0].params).toContain('p-1');
    expect(result[0]).toEqual(mappedRow);
  });

  test('returns empty array without querying for empty ids', async () => {
    expect(await projectsRepo.listByIds([], testDb)).toEqual([]);
    expect(exec.calls).toHaveLength(0);
  });
});

describe('findClientId', () => {
  test('returns clientId when found', async () => {
    exec.enqueue({ rows: [['c-1']] });
    expect(await projectsRepo.findClientId('p-1', testDb)).toBe('c-1');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await projectsRepo.findClientId('p-x', testDb)).toBeNull();
  });
});

describe('lockClientIdById', () => {
  test('uses FOR UPDATE', async () => {
    exec.enqueue({ rows: [['c-1']] });
    await projectsRepo.lockClientIdById('p-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('for update');
  });
});

describe('lockNameAndClientById', () => {
  test('returns mapped object when found', async () => {
    exec.enqueue({ rows: [['Alpha', 'c-1']] });
    expect(await projectsRepo.lockNameAndClientById('p-1', testDb)).toEqual({
      name: 'Alpha',
      clientId: 'c-1',
    });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await projectsRepo.lockNameAndClientById('p-x', testDb)).toBeNull();
  });
});

describe('lockColorAllocation', () => {
  test('uses a transaction-scoped advisory lock', async () => {
    exec.enqueue({ rows: [] });

    await projectsRepo.lockColorAllocation(testDb);

    expect(exec.calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(exec.calls[0].sql).toContain('praetor.projects.color');
  });
});

describe('listColorsForAllocation', () => {
  test('returns existing project colors in stable order', async () => {
    exec.enqueue({ rows: [{ color: '#ef4444' }, { color: '#f59e0b' }] });

    const result = await projectsRepo.listColorsForAllocation(testDb);

    expect(result).toEqual(['#ef4444', '#f59e0b']);
    expect(exec.calls[0].sql).toContain('SELECT color FROM projects');
    expect(exec.calls[0].sql).toContain('ORDER BY created_at, id');
  });
});

describe('isColorUniqueViolation', () => {
  test('detects the project color unique index', () => {
    expect(
      projectsRepo.isColorUniqueViolation(makeDbError('23505', 'idx_projects_color_unique')),
    ).toBe(true);
  });

  test('ignores unrelated unique violations', () => {
    expect(projectsRepo.isColorUniqueViolation(makeDbError('23505', 'projects_pkey'))).toBe(false);
  });
});

describe('findBillingById', () => {
  test('returns stored billing fields without deriving mixed', async () => {
    exec.enqueue({ rows: [makeRow(['retainer', 'one_time'])] });

    const result = await projectsRepo.findBillingById('p-1', testDb);

    expect(result).toEqual({ billingType: 'retainer', billingFrequency: 'one_time' });
    expect(exec.calls[0].sql.toLowerCase()).toContain('select');
    expect(exec.calls[0].sql.toLowerCase()).not.toContain('case');
  });
});

describe('create', () => {
  test('inserts and returns mapped row, defaulting orderId to null', async () => {
    exec.enqueue({ rows: [makeRow(PROJECT_ROW)] });
    exec.enqueue({ rows: [rawProjectRow] });
    const created = await projectsRepo.create(
      {
        id: 'p-1',
        name: 'Alpha',
        clientId: 'c-1',
        color: '#3b82f6',
        description: 'desc',
        isDisabled: false,
      },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "projects"');
    expect(exec.calls[0].params).toContain('p-1');
    expect(exec.calls[0].params).toContain('c-1');
    expect(exec.calls[0].params).toContain(null);
    expect(created).toEqual(mappedRow);
  });

  test('forwards orderId when provided', async () => {
    exec.enqueue({ rows: [makeRow(PROJECT_ROW, { 7: 'so-7' })] });
    exec.enqueue({ rows: [{ ...rawProjectRow, order_id: 'so-7' }] });
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
      testDb,
    );
    expect(exec.calls[0].params).toContain('so-7');
    expect(created.orderId).toBe('so-7');
  });

  // Drizzle wraps driver errors in DrizzleQueryError with the original DatabaseError on .cause.
  // The repo must unwrap to read .constraint, otherwise it can't distinguish order-FK from
  // client-FK violations.
  const newProjectInput: projectsRepo.NewProject = {
    id: 'p-1',
    name: 'Alpha',
    clientId: 'c-1',
    color: '#3b82f6',
    description: 'desc',
    isDisabled: false,
    orderId: 'so-bad',
  };

  test('FK violation on projects_order_id_fkey throws ForeignKeyError("Linked order")', async () => {
    exec.enqueue(() => {
      throw makeDbError('23503', 'projects_order_id_fkey');
    });
    let thrown: unknown;
    try {
      await projectsRepo.create(newProjectInput, testDb);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForeignKeyError);
    expect((thrown as ForeignKeyError).target).toBe('Linked order');
  });

  test('FK violation on client constraint throws ForeignKeyError("Client")', async () => {
    exec.enqueue(() => {
      throw makeDbError('23503', 'projects_client_id_fkey');
    });
    let thrown: unknown;
    try {
      await projectsRepo.create(newProjectInput, testDb);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForeignKeyError);
    expect((thrown as ForeignKeyError).target).toBe('Client');
  });
});

describe('update', () => {
  test('only sets provided fields and returns mapped row', async () => {
    exec.enqueue({ rows: [makeRow(PROJECT_ROW)] });
    exec.enqueue({ rows: [rawProjectRow] });
    const result = await projectsRepo.update('p-1', { name: 'New' }, testDb);
    expect(result).toEqual(mappedRow);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "projects"');
    expect(sql).toContain('"name" = $1');
    expect(exec.calls[0].params).toContain('New');
    expect(exec.calls[0].params).toContain('p-1');
  });

  test('explicit null clears the column', async () => {
    exec.enqueue({ rows: [makeRow(PROJECT_ROW)] });
    exec.enqueue({ rows: [rawProjectRow] });
    await projectsRepo.update('p-1', { description: null }, testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('"description" = $1');
    expect(exec.calls[0].params).toContain(null);
    expect(exec.calls[0].params).toContain('p-1');
  });

  test('normalizes billingFrequency-only update against stored billing type', async () => {
    exec.enqueue({ rows: [makeRow(['time_and_materials'])] });
    exec.enqueue({ rows: [makeRow(PROJECT_ROW)] });
    exec.enqueue({ rows: [rawProjectRow] });

    await projectsRepo.update('p-1', { billingFrequency: 'one_time' }, testDb);

    expect(exec.calls[0].sql.toLowerCase()).toContain('select');
    expect(exec.calls[1].sql.toLowerCase()).toContain('update "projects"');
    expect(exec.calls[1].params).toContain('monthly');
    expect(exec.calls[1].params).not.toContain('one_time');
  });

  test('omitting all fields falls back to a SELECT (no UPDATE issued)', async () => {
    exec.enqueue({ rows: [rawProjectRow] });
    const result = await projectsRepo.update('p-1', {}, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).not.toContain('update');
    expect(sql).toContain('select');
    expect(result).toEqual(mappedRow);
  });

  test('returns null when no row matched (UPDATE path)', async () => {
    exec.enqueue({ rows: [] });
    expect(await projectsRepo.update('p-x', { name: 'X' }, testDb)).toBeNull();
  });

  test('sets orderId when provided', async () => {
    exec.enqueue({ rows: [makeRow(PROJECT_ROW, { 7: 'co-9' })] });
    exec.enqueue({ rows: [{ ...rawProjectRow, order_id: 'co-9' }] });
    await projectsRepo.update('p-1', { orderId: 'co-9' }, testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('"order_id" = $1');
    expect(exec.calls[0].params).toContain('co-9');
  });

  test('clears orderId when null', async () => {
    exec.enqueue({ rows: [makeRow(PROJECT_ROW)] });
    exec.enqueue({ rows: [rawProjectRow] });
    await projectsRepo.update('p-1', { orderId: null }, testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('"order_id" = $1');
    expect(exec.calls[0].params).toContain(null);
  });

  test('FK violation on projects_order_id_fkey throws ForeignKeyError("Linked order")', async () => {
    exec.enqueue(() => {
      throw makeDbError('23503', 'projects_order_id_fkey');
    });
    let thrown: unknown;
    try {
      await projectsRepo.update('p-1', { orderId: 'co-bad' }, testDb);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForeignKeyError);
    expect((thrown as ForeignKeyError).target).toBe('Linked order');
  });

  test('FK violation on client constraint still throws ForeignKeyError("Client")', async () => {
    exec.enqueue(() => {
      throw makeDbError('23503', 'projects_client_id_fkey');
    });
    let thrown: unknown;
    try {
      await projectsRepo.update('p-1', { clientId: 'c-bad' }, testDb);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForeignKeyError);
    expect((thrown as ForeignKeyError).target).toBe('Client');
  });
});

describe('deleteById', () => {
  test('passes id parameter', async () => {
    exec.enqueue({ rows: [] });
    await projectsRepo.deleteById('p-1', testDb);
    expect(exec.calls[0].params).toContain('p-1');
  });
});

describe('findAssignedUserIds', () => {
  test('maps user_id rows to string array', async () => {
    exec.enqueue({ rows: [{ user_id: 'u-1' }, { user_id: 'u-2' }] });
    expect(await projectsRepo.findAssignedUserIds('p-1', testDb)).toEqual(['u-1', 'u-2']);
  });
});

describe('findNonTopManagerUserIds', () => {
  test('passes [projectId, top_manager_auto] in that order', async () => {
    exec.enqueue({ rows: [{ user_id: 'u-1' }] });
    const result = await projectsRepo.findNonTopManagerUserIds('p-1', testDb);
    expect(result).toEqual(['u-1']);
    expect(exec.calls[0].params).toContain('p-1');
    expect(exec.calls[0].params).toContain(TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE);
  });
});

describe('clearNonTopManagerAssignments', () => {
  test('uses != on assignment_source', async () => {
    exec.enqueue({ rows: [] });
    await projectsRepo.clearNonTopManagerAssignments('p-1', testDb);
    expect(exec.calls[0].sql).toContain('assignment_source !=');
    expect(exec.calls[0].params).toContain('p-1');
    expect(exec.calls[0].params).toContain(TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE);
  });
});

describe('addManualAssignments', () => {
  test('skips query when userIds is empty', async () => {
    await projectsRepo.addManualAssignments('p-1', [], testDb);
    expect(exec.calls).toHaveLength(0);
  });

  test('uses MANUAL source and ON CONFLICT DO NOTHING with batch', async () => {
    exec.enqueue({ rows: [] });
    await projectsRepo.addManualAssignments('p-1', ['u-1', 'u-2'], testDb);
    expect(exec.calls[0].params).toContainEqual(['u-1', 'u-2']);
    expect(exec.calls[0].params).toContain('p-1');
    expect(exec.calls[0].params).toContain(MANUAL_ASSIGNMENT_SOURCE);
    expect(exec.calls[0].sql).toContain('ON CONFLICT DO NOTHING');
  });
});

describe('ensureClientCascadeAssignments', () => {
  test('skips query when userIds is empty', async () => {
    await projectsRepo.ensureClientCascadeAssignments([], 'c-1', testDb);
    expect(exec.calls).toHaveLength(0);
  });

  test('uses PROJECT_CASCADE source on user_clients with batch', async () => {
    exec.enqueue({ rows: [] });
    await projectsRepo.ensureClientCascadeAssignments(['u-1', 'u-2'], 'c-1', testDb);
    expect(exec.calls[0].sql).toContain('user_clients');
    expect(exec.calls[0].params).toContainEqual(['u-1', 'u-2']);
    expect(exec.calls[0].params).toContain('c-1');
    expect(exec.calls[0].params).toContain(PROJECT_CASCADE_ASSIGNMENT_SOURCE);
  });
});

describe('removeClientCascadeForUsersIfUnused', () => {
  test('skips query when userIds is empty', async () => {
    await projectsRepo.removeClientCascadeForUsersIfUnused([], 'c-1', testDb);
    expect(exec.calls).toHaveLength(0);
  });

  test('passes user ids as array param and uses ANY', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    await projectsRepo.removeClientCascadeForUsersIfUnused(['u-1', 'u-2'], 'c-1', testDb);
    expect(exec.calls[0].params).toContainEqual(['u-1', 'u-2']);
    expect(exec.calls[0].params).toContain('c-1');
    expect(exec.calls[0].params).toContain(PROJECT_CASCADE_ASSIGNMENT_SOURCE);
    expect(exec.calls[0].sql).toContain('ANY(');
  });
});
