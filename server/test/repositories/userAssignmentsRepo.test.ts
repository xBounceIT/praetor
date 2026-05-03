import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as userAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import { TOP_MANAGER_ROLE_ID } from '../../utils/permissions.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

// Local destructure: the namespace import satisfies CLAUDE.md, and shorter names keep the
// `describe.each` tables and assertion bodies readable.
const {
  applyProjectCascadeToClients,
  assignClientToTopManagers,
  assignClientToUser,
  assignProjectToTopManagers,
  assignProjectToUser,
  assignTaskToTopManagers,
  assignTaskToUser,
  clearProjectCascadeAssignments,
  MANUAL_ASSIGNMENT_SOURCE,
  PROJECT_CASCADE_ASSIGNMENT_SOURCE,
  replaceUserClients,
  replaceUserProjects,
  replaceUserTasks,
  syncTopManagerAssignmentsForUser,
  TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
  userHasTopManagerRole,
} = userAssignmentsRepo;

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const findCall = (predicate: (sql: string) => boolean) => exec.calls.find((c) => predicate(c.sql));

describe.each([
  ['assignClientToUser', 'user_clients', 'client_id', assignClientToUser],
  ['assignProjectToUser', 'user_projects', 'project_id', assignProjectToUser],
  ['assignTaskToUser', 'user_tasks', 'task_id', assignTaskToUser],
] as const)('%s', (_label, table, fkColumn, fn) => {
  test(`emits INSERT INTO ${table} ... ON CONFLICT DO UPDATE SET assignment_source = CASE`, async () => {
    exec.enqueue({ rows: [] });
    await fn('u-1', 'x-1', undefined, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain(`insert into "${table}"`);
    expect(sql).toContain('on conflict');
    expect(sql).toContain(`"user_id"`);
    expect(sql).toContain(`"${fkColumn}"`);
    expect(sql).toContain('do update');
    expect(sql).toContain('case');
  });

  test('CASE merge orders manual > top_manager_auto > existing', async () => {
    exec.enqueue({ rows: [] });
    await fn('u-1', 'x-1', undefined, testDb);
    // Both branches reference excluded.assignment_source — the proposed-insert row.
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('excluded.assignment_source');
    expect(exec.calls[0].params).toContain(MANUAL_ASSIGNMENT_SOURCE);
    expect(exec.calls[0].params).toContain(TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE);
  });

  test(`defaults source to '${MANUAL_ASSIGNMENT_SOURCE}'`, async () => {
    exec.enqueue({ rows: [] });
    await fn('u-1', 'x-1', undefined, testDb);
    expect(exec.calls[0].params).toContain('u-1');
    expect(exec.calls[0].params).toContain('x-1');
    // The default source appears as the inserted-values param. The CASE branches reference
    // 'manual' / 'top_manager_auto' too, so there can be multiple matches; assert presence.
    expect(exec.calls[0].params).toContain(MANUAL_ASSIGNMENT_SOURCE);
  });

  test('forwards an explicit non-default source', async () => {
    exec.enqueue({ rows: [] });
    await fn('u-1', 'x-1', PROJECT_CASCADE_ASSIGNMENT_SOURCE, testDb);
    expect(exec.calls[0].params).toContain(PROJECT_CASCADE_ASSIGNMENT_SOURCE);
  });
});

describe.each([
  ['assignClientToTopManagers', 'user_clients', 'client_id', assignClientToTopManagers],
  ['assignProjectToTopManagers', 'user_projects', 'project_id', assignProjectToTopManagers],
  ['assignTaskToTopManagers', 'user_tasks', 'task_id', assignTaskToTopManagers],
] as const)('%s', (_label, table, fkColumn, fn) => {
  test(`emits INSERT ... SELECT FROM user_roles WHERE role_id = ${TOP_MANAGER_ROLE_ID}`, async () => {
    exec.enqueue({ rows: [] });
    await fn('x-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain(`insert into "${table}"`);
    expect(sql).toContain(`"${fkColumn}"`);
    expect(sql).toContain('select ur.user_id');
    expect(sql).toContain('from user_roles');
    expect(sql).toContain('ur.role_id');
    expect(sql).toContain('on conflict');
    expect(sql).toContain('do update');
  });

  test('passes targetId, TOP_MANAGER_AUTO source, and TOP_MANAGER_ROLE_ID as params', async () => {
    exec.enqueue({ rows: [] });
    await fn('x-1', testDb);
    expect(exec.calls[0].params).toContain('x-1');
    expect(exec.calls[0].params).toContain(TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE);
    expect(exec.calls[0].params).toContain(TOP_MANAGER_ROLE_ID);
    // Manual is referenced inside the CASE so it appears as a param too.
    expect(exec.calls[0].params).toContain(MANUAL_ASSIGNMENT_SOURCE);
  });
});

describe('clearProjectCascadeAssignments', () => {
  test('only deletes rows whose assignment_source is project_cascade', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    await clearProjectCascadeAssignments('user-1', testDb);
    expect(exec.calls[0].sql).toContain('assignment_source =');
    expect(exec.calls[0].params).toContain(PROJECT_CASCADE_ASSIGNMENT_SOURCE);
    expect(exec.calls[0].params).toContain('user-1');
  });
});

describe('applyProjectCascadeToClients', () => {
  test('inserts derived rows from user_projects join projects with project_cascade source', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    await applyProjectCascadeToClients('user-1', testDb);
    expect(exec.calls[0].params).toContain(PROJECT_CASCADE_ASSIGNMENT_SOURCE);
    expect(exec.calls[0].sql).toContain('JOIN projects');
    expect(exec.calls[0].sql).toContain('ON CONFLICT (user_id, client_id) DO NOTHING');
    expect(exec.calls[0].params).toContain('user-1');
  });
});

describe('userHasTopManagerRole', () => {
  test(`queries user_roles for (userId, ${TOP_MANAGER_ROLE_ID}) and returns true when a row exists`, async () => {
    exec.enqueue({ rows: [[1]] });
    const result = await userHasTopManagerRole('u-1', testDb);
    expect(result).toBe(true);
    expect(exec.calls[0].params).toContain('u-1');
    expect(exec.calls[0].params).toContain(TOP_MANAGER_ROLE_ID);
    expect(exec.calls[0].sql.toLowerCase()).toContain('user_roles');
  });

  test('returns false when no row exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await userHasTopManagerRole('u-1', testDb)).toBe(false);
  });
});

describe('syncTopManagerAssignmentsForUser', () => {
  describe('non-top-manager branch', () => {
    // Role check returns no row → not a top manager → 3 deletes + cascade rebuild.
    const enqueueNonTopManager = () => {
      exec.enqueue({ rows: [] }); // userHasTopManagerRole → false
      exec.enqueueEmptyN(4); // 3 parallel deletes + 1 cascade rebuild
    };

    test('runs the role check first', async () => {
      enqueueNonTopManager();
      await syncTopManagerAssignmentsForUser('u-1', testDb);
      expect(exec.calls[0].sql.toLowerCase()).toContain('user_roles');
    });

    test('deletes top_manager_auto rows from user_clients/user_projects/user_tasks', async () => {
      enqueueNonTopManager();
      await syncTopManagerAssignmentsForUser('u-1', testDb);
      // Promise.all order isn't deterministic; assert each delete by table name.
      for (const table of ['user_clients', 'user_projects', 'user_tasks']) {
        const call = findCall((s) => s.toLowerCase().includes(`delete from "${table}"`));
        expect(call).toBeDefined();
        expect(call?.params).toContain('u-1');
        expect(call?.params).toContain(TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE);
      }
    });

    test('emits the project_cascade rebuild via applyProjectCascadeToClients', async () => {
      enqueueNonTopManager();
      await syncTopManagerAssignmentsForUser('u-1', testDb);
      const cascade = findCall((s) => /insert into user_clients/i.test(s));
      expect(cascade).toBeDefined();
      expect(cascade?.sql).toContain('user_projects up');
      expect(cascade?.sql).toContain('JOIN projects p');
      expect(cascade?.sql).toContain('ON CONFLICT (user_id, client_id) DO NOTHING');
      expect(cascade?.params).toContain(PROJECT_CASCADE_ASSIGNMENT_SOURCE);
      expect(cascade?.params).toContain('u-1');
    });

    test('runs no top-manager INSERT...SELECT FROM clients/projects/tasks', async () => {
      enqueueNonTopManager();
      await syncTopManagerAssignmentsForUser('u-1', testDb);
      // The non-TM branch's only INSERT touches user_clients via project_cascade — never
      // SELECT id FROM clients/projects/tasks.
      const wrongInsert = exec.calls.find(
        (c) => /from\s+(clients|projects|tasks)\b/i.test(c.sql) && /insert\s+into/i.test(c.sql),
      );
      expect(wrongInsert).toBeUndefined();
    });
  });

  describe('top-manager branch', () => {
    // Role check returns a row → top manager → 3 INSERTs (no deletes).
    const enqueueTopManager = () => {
      exec.enqueue({ rows: [[1]] }); // userHasTopManagerRole → true
      exec.enqueueEmptyN(3); // 3 parallel INSERTs
    };

    test('runs the role check first', async () => {
      enqueueTopManager();
      await syncTopManagerAssignmentsForUser('u-1', testDb);
      expect(exec.calls[0].sql.toLowerCase()).toContain('user_roles');
    });

    test.each([
      ['user_clients', 'client_id', 'clients'],
      ['user_projects', 'project_id', 'projects'],
      ['user_tasks', 'task_id', 'tasks'],
    ] as const)('emits INSERT INTO %s SELECT FROM %s', async (table, fkColumn, sourceTable) => {
      enqueueTopManager();
      await syncTopManagerAssignmentsForUser('u-1', testDb);
      const call = findCall(
        (s) =>
          s.toLowerCase().includes(`insert into "${table}"`) &&
          s.toLowerCase().includes(`from "${sourceTable}"`),
      );
      expect(call).toBeDefined();
      expect(call?.sql).toContain(`"${fkColumn}"`);
      expect(call?.sql.toLowerCase()).toContain('on conflict');
      expect(call?.params).toContain('u-1');
      expect(call?.params).toContain(TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE);
      expect(call?.params).toContain(MANUAL_ASSIGNMENT_SOURCE);
    });

    test('issues no DELETEs', async () => {
      enqueueTopManager();
      await syncTopManagerAssignmentsForUser('u-1', testDb);
      const anyDelete = exec.calls.find((c) => /delete\s+from/i.test(c.sql));
      expect(anyDelete).toBeUndefined();
    });
  });
});

describe('replaceUserClients', () => {
  test('issues DELETE then a single bulk INSERT for the id list', async () => {
    exec.enqueue({ rows: [], rowCount: 5 });
    exec.enqueue({ rows: [], rowCount: 2 });
    await replaceUserClients('user-1', ['c1', 'c2'], 'manual', testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM');
    expect(exec.calls[0].sql).toContain('user_clients');
    expect(exec.calls[1].sql).toContain('INSERT INTO');
    expect(exec.calls[1].sql).toContain('user_clients');
    expect(exec.calls[1].sql).toContain('ON CONFLICT DO NOTHING');
    expect(exec.calls[1].params).toEqual(['user-1', 'c1', 'manual', 'user-1', 'c2', 'manual']);
  });

  test('only issues the DELETE when the id list is empty', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    await replaceUserClients('user-1', [], 'manual', testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('DELETE');
  });
});

describe('replaceUserProjects', () => {
  test('issues DELETE then a single bulk INSERT into user_projects', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    await replaceUserProjects('user-1', ['p1', 'p2'], 'manual', testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('user_projects');
    expect(exec.calls[1].sql).toContain('user_projects');
    expect(exec.calls[1].params).toEqual(['user-1', 'p1', 'manual', 'user-1', 'p2', 'manual']);
  });
});

describe('replaceUserTasks', () => {
  test('issues DELETE then a single bulk INSERT into user_tasks', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    await replaceUserTasks('user-1', ['t1'], 'manual', testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('user_tasks');
    expect(exec.calls[1].sql).toContain('user_tasks');
    expect(exec.calls[1].params).toEqual(['user-1', 't1', 'manual']);
  });
});
