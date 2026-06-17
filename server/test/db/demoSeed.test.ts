import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import {
  assertNoDemoDocumentIdConflicts,
  cleanupDemoNamespace,
  insertCompatibilityDefaults,
  selectDemoUserCleanupIds,
} from '../../db/demoSeed.ts';
import {
  buildDemoIds,
  COMPATIBILITY_DEFAULTS,
  DEMO_CUSTOMER_OFFERS,
  DEMO_EXPECTED_COUNTS,
  DEMO_IDS,
  DEMO_QUOTES,
  DEMO_SALES,
  DEMO_SUPPLIER_QUOTES,
  DEMO_SUPPLIER_SALES,
  DEMO_TOP_MANAGER_USER_IDS,
  DEMO_USER_CLIENT_ASSIGNMENTS,
  DEMO_USER_PROJECT_ASSIGNMENTS,
  DEMO_USER_TASK_ASSIGNMENTS,
  DEMO_USERS,
} from '../../db/demoSeedManifest.ts';
import {
  DOCUMENT_CODE_MODULES,
  type DocumentCodeModuleId,
  renderDocumentCode,
} from '../../utils/document-codes.ts';
import { parseInsertValuesBlocks } from './seedSqlParsing.ts';

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

const CONTRACT_TYPES = new Set([
  'permanent',
  'fixed_term',
  'contractor',
  'internship',
  'consultant',
  'other',
]);
const EMPLOYMENT_STATUSES = new Set(['active', 'onboarding', 'on_leave', 'terminated']);
const WORK_LOCATIONS = new Set(['office', 'remote', 'hybrid', 'customer_site', 'other']);

const documentCodesFor = (
  moduleId: DocumentCodeModuleId,
  count: number,
  year = new Date().getFullYear(),
) =>
  Array.from({ length: count }, (_, index) =>
    renderDocumentCode(DOCUMENT_CODE_MODULES[moduleId], {
      year,
      sequence: index + 1,
    }),
  );

type QueryCall = { sql: string; params: unknown[] | undefined };

const buildQueryRecorder = (rowCount = 1, rows: unknown[] = []) => {
  const calls: QueryCall[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return { rowCount, rows };
    },
  } as unknown as PoolClient;

  return { calls, client };
};

const findDelete = (calls: QueryCall[], table: string) =>
  calls.find((call) => call.sql.startsWith(`DELETE FROM ${table} `));

type DemoAssignment = { userId: string; targetId: string };

const sortAssignments = (assignments: readonly DemoAssignment[]) =>
  assignments
    .map((assignment) => `${assignment.userId}:${assignment.targetId}`)
    .sort((a, b) => a.localeCompare(b));

const parsedAssignments = (table: string, targetColumn: string) =>
  sortAssignments(
    parseInsertValuesBlocks(SEED_SQL, table).map((row) => ({
      userId: row.user_id,
      targetId: row[targetColumn] ?? '',
    })),
  );

describe('selectDemoUserCleanupIds', () => {
  test('preserves canonical demo users so cascading user data survives demo reseed', () => {
    expect(
      selectDemoUserCleanupIds([{ id: 'u2' }, { id: 'u3' }, { id: 'legacy-manager' }]),
    ).toEqual({
      dependentUserIds: ['u2', 'u3', 'legacy-manager'],
      userIdsToDelete: ['legacy-manager'],
    });
  });
});

describe('insertCompatibilityDefaults', () => {
  test('refreshes existing compatibility rows instead of leaving stale conflicts untouched', async () => {
    const { calls, client } = buildQueryRecorder();

    await insertCompatibilityDefaults(client, {});

    expect(calls).toHaveLength(3);
    expect(calls[0]?.sql).toContain('ON CONFLICT (id) DO UPDATE SET');
    expect(calls[0]?.sql).toContain('name = EXCLUDED.name');
    expect(calls[0]?.sql).toContain('is_disabled = FALSE');
    expect(calls[0]?.sql).toContain('contacts = DEFAULT');
    expect(calls[0]?.sql).toContain('client_code = NULL');
    expect(calls[1]?.sql).toContain('description = EXCLUDED.description');
    expect(calls[1]?.sql).toContain('tipo_confirmed = EXCLUDED.tipo_confirmed');
    expect(calls[1]?.sql).toContain('order_id = NULL');
    expect(calls[1]?.sql).toContain('billing_type = DEFAULT');
    expect(calls[2]?.sql).toContain('project_id = EXCLUDED.project_id');
    expect(calls[2]?.sql).toContain('is_recurring = DEFAULT');
    expect(calls[2]?.sql).toContain('monthly_effort = DEFAULT');
  });
});

describe('cleanupDemoNamespace', () => {
  test('clears preserved demo users from assignment tables before reseeding', async () => {
    const { calls, client } = buildQueryRecorder();

    await cleanupDemoNamespace(client, {
      dependentUserIds: ['u2', 'u3', 'legacy-manager'],
      userIdsToDelete: ['legacy-manager'],
    });

    for (const table of ['user_clients', 'user_projects', 'user_tasks']) {
      const call = findDelete(calls, table);
      expect(call?.sql).toContain('user_id = ANY($1::text[])');
      expect(call?.params).toEqual([['u2', 'u3', 'legacy-manager']]);
    }
  });

  test('clears demo-user activity that would survive because canonical users are preserved', async () => {
    const { calls, client } = buildQueryRecorder();

    await cleanupDemoNamespace(client, {
      dependentUserIds: ['u2', 'u3'],
      userIdsToDelete: [],
    });

    expect(findDelete(calls, 'time_entries')?.sql).toContain('user_id = ANY($2::text[])');
    expect(findDelete(calls, 'notifications')?.sql).toContain('user_id = ANY($2::text[])');
    expect(findDelete(calls, 'user_work_units')?.sql).toContain('user_id = ANY($2::text[])');
    expect(findDelete(calls, 'work_unit_managers')?.sql).toContain('user_id = ANY($2::text[])');
  });

  test('uses the provided seed year when cleaning default-code documents', async () => {
    const { calls, client } = buildQueryRecorder();

    await cleanupDemoNamespace(
      client,
      {
        dependentUserIds: ['u2', 'u3'],
        userIdsToDelete: [],
      },
      2027,
    );

    expect(findDelete(calls, 'quotes')?.params?.[0]).toEqual(
      documentCodesFor('client_quote', 14, 2027),
    );
    expect(findDelete(calls, 'sales')?.params?.[0]).toEqual(
      documentCodesFor('client_order', 5, 2027),
    );
  });
});

describe('assertNoDemoDocumentIdConflicts', () => {
  test('fails before cleanup can overwrite real documents using default demo codes', async () => {
    const conflictingId = documentCodesFor('client_quote', 1, 2027)[0];
    const { client } = buildQueryRecorder(1, [{ table_name: 'quotes', id: conflictingId }]);

    await expect(assertNoDemoDocumentIdConflicts(client, 2027)).rejects.toThrow(
      `Demo seed document ID collision with non-demo records: quotes:${conflictingId}`,
    );
  });

  test('passes when the runtime demo codes are unused by non-demo rows', async () => {
    const { calls, client } = buildQueryRecorder(0);

    await expect(assertNoDemoDocumentIdConflicts(client, 2027)).resolves.toBeUndefined();
    expect(calls[0]?.params?.[0]).toEqual(buildDemoIds(2027).quotes);
  });

  test('allows compatibility demo clients to be cleaned before reseeding', async () => {
    const { calls, client } = buildQueryRecorder(0);

    await assertNoDemoDocumentIdConflicts(client, 2027);

    expect(calls[0]?.params?.[5]).toEqual([
      ...COMPATIBILITY_DEFAULTS.clients,
      ...buildDemoIds(2027).clients,
    ]);
  });
});

describe('demoSeedManifest assignment coverage', () => {
  test('seed.sql document collision guard allows compatibility demo clients', () => {
    const guardStart = SEED_SQL.indexOf('INSERT INTO demo_document_code_conflicts');
    const guardEnd = SEED_SQL.indexOf('SELECT CASE', guardStart);

    expect(guardStart).toBeGreaterThan(-1);
    expect(guardEnd).toBeGreaterThan(guardStart);
    const guard = SEED_SQL.slice(guardStart, guardEnd);

    expect(guard).toContain("q.client_id NOT IN ('c1', 'c2')");
    expect(guard).toContain("o.client_id NOT IN ('c1', 'c2')");
    expect(guard).toContain("s.client_id NOT IN ('c1', 'c2')");
  });

  test('manifest document IDs use the admin default document code templates', () => {
    expect(DEMO_QUOTES.map((row) => row.id)).toEqual(documentCodesFor('client_quote', 14));
    expect(DEMO_CUSTOMER_OFFERS.map((row) => row.id)).toEqual(documentCodesFor('client_offer', 5));
    expect(DEMO_SUPPLIER_QUOTES.map((row) => row.id)).toEqual(
      documentCodesFor('supplier_quote', 14),
    );
    expect(DEMO_SALES.map((row) => row.id)).toEqual(documentCodesFor('client_order', 5));
    expect(DEMO_SUPPLIER_SALES.map((row) => row.id)).toEqual(documentCodesFor('supplier_order', 5));
  });

  test('seed.sql document rows and counters match the default-code manifest', () => {
    expect(parseInsertValuesBlocks(SEED_SQL, 'quotes').map((row) => row.id)).toEqual(
      DEMO_QUOTES.map((row) => row.id),
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'customer_offers').map((row) => row.id)).toEqual(
      DEMO_CUSTOMER_OFFERS.map((row) => row.id),
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'supplier_quotes').map((row) => row.id)).toEqual(
      DEMO_SUPPLIER_QUOTES.map((row) => row.id),
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'sales').map((row) => row.id)).toEqual(
      DEMO_SALES.map((row) => row.id),
    );
    expect(parseInsertValuesBlocks(SEED_SQL, 'supplier_sales').map((row) => row.id)).toEqual(
      DEMO_SUPPLIER_SALES.map((row) => row.id),
    );

    const counters = Object.fromEntries(
      parseInsertValuesBlocks(SEED_SQL, 'document_code_counters').map((row) => [
        row.module_id,
        Number(row.next_sequence),
      ]),
    );
    expect(counters).toEqual({
      client_quote: 15,
      client_offer: 6,
      supplier_quote: 15,
      client_order: 6,
      supplier_order: 6,
    });
  });

  test('seed.sql task ids match the compatibility and demo task manifests', () => {
    expect(
      parseInsertValuesBlocks(SEED_SQL, 'tasks')
        .map((row) => row.id)
        .sort(),
    ).toEqual([...COMPATIBILITY_DEFAULTS.tasks, ...DEMO_IDS.tasks].sort());
  });

  test('seed.sql user assignment rows match the demo manifest', () => {
    expect(parsedAssignments('user_clients', 'client_id')).toEqual(
      sortAssignments(DEMO_USER_CLIENT_ASSIGNMENTS),
    );
    expect(parsedAssignments('user_projects', 'project_id')).toEqual(
      sortAssignments(DEMO_USER_PROJECT_ASSIGNMENTS),
    );
    expect(parsedAssignments('user_tasks', 'task_id')).toEqual(
      sortAssignments(DEMO_USER_TASK_ASSIGNMENTS),
    );
  });

  test('assignment verification counts include top-manager refresh rows', () => {
    expect(DEMO_TOP_MANAGER_USER_IDS).toEqual(['u9']);
    expect(DEMO_EXPECTED_COUNTS.user_clients).toBe(
      DEMO_USER_CLIENT_ASSIGNMENTS.length +
        DEMO_TOP_MANAGER_USER_IDS.length *
          (COMPATIBILITY_DEFAULTS.clients.length + DEMO_IDS.clients.length),
    );
    expect(DEMO_EXPECTED_COUNTS.user_projects).toBe(
      DEMO_USER_PROJECT_ASSIGNMENTS.length +
        DEMO_TOP_MANAGER_USER_IDS.length *
          (COMPATIBILITY_DEFAULTS.projects.length + DEMO_IDS.projects.length),
    );
    expect(DEMO_EXPECTED_COUNTS.user_tasks).toBe(
      DEMO_USER_TASK_ASSIGNMENTS.length +
        DEMO_TOP_MANAGER_USER_IDS.length *
          (COMPATIBILITY_DEFAULTS.tasks.length + DEMO_IDS.tasks.length),
    );
  });
});

describe('DEMO_USERS HR profiles', () => {
  test('seeded users cover HR screens with complete operational profile data', () => {
    const employeeTypes = new Set(DEMO_USERS.map((user) => user.employeeType));
    expect(employeeTypes).toEqual(new Set(['app_user', 'internal', 'external']));

    const employeeCodes = DEMO_USERS.map((user) => user.employeeCode);
    expect(new Set(employeeCodes).size).toBe(employeeCodes.length);

    for (const user of DEMO_USERS) {
      expect(user.phone).toMatch(/^\+39 /);
      expect(user.jobTitle.trim()).not.toBe('');
      expect(user.department.trim()).not.toBe('');
      expect(user.employeeCode).toMatch(/^(EMP|EXT)-\d{3}$/);
      expect(user.hireDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(CONTRACT_TYPES.has(user.contractType)).toBe(true);
      expect(EMPLOYMENT_STATUSES.has(user.employmentStatus)).toBe(true);
      expect(WORK_LOCATIONS.has(user.workLocation)).toBe(true);
      expect(user.emergencyContactName.trim()).not.toBe('');
      expect(user.emergencyContactPhone).toMatch(/^\+39 /);
      expect(user.notes.trim()).not.toBe('');
      if (user.terminationDate !== null) {
        expect(user.terminationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(user.hireDate <= user.terminationDate).toBe(true);
      }
    }
  });
});
