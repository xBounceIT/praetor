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
// Schema column order: id, name, client_id, description, is_disabled, created_at, order_id,
// offer_id, start_date, end_date, revenue, billing_type, billing_frequency, status, tipo, tipo_confirmed
const PROJECT_ROW: readonly unknown[] = [
  'p-1',
  'Alpha',
  'c-1',
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
  'in_corso',
  'attivo',
  true,
];

const mappedRow: projectsRepo.Project = {
  id: 'p-1',
  name: 'Alpha',
  clientId: 'c-1',
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
  status: 'in_corso',
  tipo: 'attivo',
  tipoConfirmed: true,
};

const rawProjectRow = {
  id: 'p-1',
  name: 'Alpha',
  client_id: 'c-1',
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
  status: 'in_corso',
  tipo: 'attivo',
  tipo_confirmed: true,
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

  test('selects and maps status / tipo / tipo_confirmed, defaulting confirmed to false', async () => {
    exec.enqueue({
      rows: [{ ...rawProjectRow, status: 'in_pausa', tipo: 'passivo', tipo_confirmed: false }],
    });
    const result = await projectsRepo.listAll(testDb);
    expect(exec.calls[0].sql).toContain('p.status');
    expect(exec.calls[0].sql).toContain('p.tipo');
    expect(exec.calls[0].sql).toContain('p.tipo_confirmed');
    expect(result[0].status).toBe('in_pausa');
    expect(result[0].tipo).toBe('passivo');
    expect(result[0].tipoConfirmed).toBe(false);
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

describe('listRilCatalogForUser', () => {
  test('selects only RIL project-code fields without billing metadata', async () => {
    exec.enqueue({ rows: [{ id: 'p-1', name: 'Alpha', orderId: 'ORD-1' }] });

    const result = await projectsRepo.listRilCatalogForUser('u-1', testDb);

    expect(result).toEqual([{ id: 'p-1', name: 'Alpha', orderId: 'ORD-1' }]);
    expect(exec.calls[0].params).toContain('u-1');
    expect(exec.calls[0].sql).toContain('INNER JOIN user_projects');
    expect(exec.calls[0].sql).not.toContain('billing_type');
    expect(exec.calls[0].sql).not.toContain('FROM tasks');
  });
});

describe('listByIds', () => {
  test('returns a Map keyed by id and binds ids as one array parameter', async () => {
    exec.enqueue({ rows: [rawProjectRow] });

    const result = await projectsRepo.listByIds(['p-1', 'p-2'], testDb);

    expect(exec.calls[0].sql).toContain('WHERE p.id = ANY($1::text[])');
    expect(exec.calls[0].params).toEqual([['p-1', 'p-2']]);
    expect(result.get('p-1')).toEqual(mappedRow);
  });

  test('returns an empty Map without querying for empty ids', async () => {
    const result = await projectsRepo.listByIds([], testDb);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  // Regression test for issue #535: callers must be able to detect missing ids.
  test('omits ids with no matching row from the returned Map', async () => {
    exec.enqueue({ rows: [rawProjectRow] });

    const result = await projectsRepo.listByIds(['p-1', 'p-missing'], testDb);

    expect(result.size).toBe(1);
    expect(result.has('p-1')).toBe(true);
    expect(result.has('p-missing')).toBe(false);
  });
});

describe('listNamesByIds', () => {
  test('returns project/client display names and binds ids as one array parameter', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'p-1',
          name: 'Alpha',
          client_id: 'c-1',
          client_name: 'Acme',
          end_date: null,
          status: 'in_corso',
        },
      ],
    });

    const result = await projectsRepo.listNamesByIds(['p-1', 'p-2'], testDb);

    expect(exec.calls[0].sql).toContain('WHERE p.id = ANY($1::text[])');
    expect(exec.calls[0].params).toEqual([['p-1', 'p-2']]);
    expect(result.get('p-1')).toEqual({
      projectName: 'Alpha',
      clientId: 'c-1',
      clientName: 'Acme',
      endDate: null,
      status: 'in_corso',
    });
  });

  test('returns empty map without querying for empty ids', async () => {
    expect(await projectsRepo.listNamesByIds([], testDb)).toEqual(new Map());
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

describe('findClientLinksById', () => {
  test('returns an internal project with no commercial links', async () => {
    exec.enqueue({ rows: [makeRow([null, null, 'interno'])] });

    const result = await projectsRepo.findClientLinksById('p-1', testDb);

    expect(result).toEqual({ orderId: null, offerId: null, tipo: 'interno' });
  });

  test('returns null when the project is missing', async () => {
    exec.enqueue({ rows: [] });

    expect(await projectsRepo.findClientLinksById('p-missing', testDb)).toBeNull();
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
        description: 'desc',
        isDisabled: false,
        tipo: 'attivo',
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
    exec.enqueue({ rows: [makeRow(PROJECT_ROW, { 6: 'so-7' })] });
    exec.enqueue({ rows: [{ ...rawProjectRow, order_id: 'so-7' }] });
    const created = await projectsRepo.create(
      {
        id: 'p-1',
        name: 'Alpha',
        clientId: 'c-1',
        description: 'desc',
        isDisabled: false,
        orderId: 'so-7',
        tipo: 'attivo',
      },
      testDb,
    );
    expect(exec.calls[0].params).toContain('so-7');
    expect(created.orderId).toBe('so-7');
  });

  test('persists tipo and confirms it on create (issue #784)', async () => {
    exec.enqueue({ rows: [makeRow(PROJECT_ROW, { 14: 'passivo' })] });
    exec.enqueue({ rows: [{ ...rawProjectRow, tipo: 'passivo' }] });
    const created = await projectsRepo.create(
      {
        id: 'p-1',
        name: 'Alpha',
        clientId: 'c-1',
        description: 'desc',
        isDisabled: false,
        tipo: 'passivo',
      },
      testDb,
    );
    // status, tipo, and tipo_confirmed are the last three bound create values.
    expect(exec.calls[0].params.at(-3)).toBe('da_fare');
    expect(exec.calls[0].params.at(-2)).toBe('passivo');
    expect(exec.calls[0].params.at(-1)).toBe(true);
    expect(created.tipo).toBe('passivo');
    expect(created.tipoConfirmed).toBe(true);
  });

  test('persists status on create', async () => {
    exec.enqueue({ rows: [makeRow(PROJECT_ROW, { 13: 'in_pausa' })] });
    exec.enqueue({ rows: [{ ...rawProjectRow, status: 'in_pausa' }] });

    const created = await projectsRepo.create(
      {
        id: 'p-1',
        name: 'Alpha',
        clientId: 'c-1',
        description: 'desc',
        isDisabled: false,
        tipo: 'attivo',
        status: 'in_pausa',
      },
      testDb,
    );

    expect(exec.calls[0].params).toContain('in_pausa');
    expect(created.status).toBe('in_pausa');
  });
  // Drizzle wraps driver errors in DrizzleQueryError with the original DatabaseError on .cause.
  // The repo must unwrap to read .constraint, otherwise it can't distinguish order-FK from
  // client-FK violations.
  const newProjectInput: projectsRepo.NewProject = {
    id: 'p-1',
    name: 'Alpha',
    clientId: 'c-1',
    description: 'desc',
    isDisabled: false,
    orderId: 'so-bad',
    tipo: 'attivo',
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

  // Billing frequency is independent of billing type now: an "A misura" (time_and_materials)
  // project may bill one-time. The update writes the requested frequency directly, without
  // reading back the stored billing type to normalize against it.
  test('billingFrequency-only update persists the requested frequency for any billing type', async () => {
    exec.enqueue({ rows: [makeRow(PROJECT_ROW)] });
    exec.enqueue({ rows: [rawProjectRow] });

    await projectsRepo.update('p-1', { billingFrequency: 'one_time' }, testDb);

    // Exactly UPDATE + findById — no read-back SELECT to normalize the frequency against the
    // stored billing type (that was the removed behavior); a reintroduced one would add a call.
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('update "projects"');
    expect(exec.calls[0].params).toContain('one_time');
    expect(exec.calls[0].params).not.toContain('monthly');
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
    exec.enqueue({ rows: [makeRow(PROJECT_ROW, { 6: 'co-9' })] });
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

  test('setting tipo also confirms it (tipo_confirmed = true) (issue #784)', async () => {
    exec.enqueue({ rows: [makeRow(PROJECT_ROW)] });
    exec.enqueue({ rows: [rawProjectRow] });
    await projectsRepo.update('p-1', { tipo: 'passivo' }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"tipo" =');
    expect(sql).toContain('"tipo_confirmed" =');
    expect(exec.calls[0].params).toContain('passivo');
    expect(exec.calls[0].params).toContain(true);
  });

  test('a null tipo patch is ignored rather than clearing the NOT NULL column', async () => {
    exec.enqueue({ rows: [rawProjectRow] });
    const result = await projectsRepo.update('p-1', { tipo: null }, testDb);
    // No settable fields → falls back to a SELECT, never issues an UPDATE.
    expect(exec.calls[0].sql.toLowerCase()).not.toContain('update');
    expect(result).toEqual(mappedRow);
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
