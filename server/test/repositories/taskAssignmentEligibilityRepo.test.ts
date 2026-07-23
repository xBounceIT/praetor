import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as taskAssignmentEligibilityRepo from '../../repositories/taskAssignmentEligibilityRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('findIneligibleAssigneeIds', () => {
  test('skips the database for an empty request', async () => {
    const result = await taskAssignmentEligibilityRepo.findIneligibleAssigneeIds(
      [],
      {
        viewerId: 'viewer-1',
        canViewAllUsers: false,
        canViewManagedUsers: false,
        canViewInternal: false,
        canViewExternal: false,
      },
      testDb,
    );

    expect(result).toEqual([]);
    expect(exec.calls).toHaveLength(0);
  });

  test('rejects requested IDs not returned by every eligibility and visibility guard', async () => {
    exec.enqueue({ rows: [{ id: 'eligible-user' }] });

    const result = await taskAssignmentEligibilityRepo.findIneligibleAssigneeIds(
      [
        'eligible-user',
        'missing-user',
        'disabled-user',
        'admin-only-user',
        'top-manager-user',
        'invisible-user',
      ],
      {
        viewerId: 'viewer-1',
        canViewAllUsers: false,
        canViewManagedUsers: true,
        canViewInternal: true,
        canViewExternal: false,
      },
      testDb,
    );

    expect(result).toEqual([
      'missing-user',
      'disabled-user',
      'admin-only-user',
      'top-manager-user',
      'invisible-user',
    ]);

    const query = exec.calls[0];
    expect(query.params).toContainEqual([
      'eligible-user',
      'missing-user',
      'disabled-user',
      'admin-only-user',
      'top-manager-user',
      'invisible-user',
    ]);
    expect(query.params).toContain('viewer-1');
    expect(query.sql).toContain('u.is_disabled');
    expect(query.sql).toContain('u.role <>');
    expect(query.sql).toContain('top_manager_role.role_id');
    expect(query.sql).toContain('non_admin_role.role_id <>');
    expect(query.sql).toContain('user_work_units assignee_uw');
    expect(query.sql).toContain("u.employee_type IN ('app_user', 'internal')");
    expect(query.sql).toContain("u.employee_type = 'external'");
  });

  test('does not apply caller scope joins to all-user viewers', async () => {
    exec.enqueue({ rows: [{ id: 'eligible-user' }] });

    const result = await taskAssignmentEligibilityRepo.findIneligibleAssigneeIds(
      ['eligible-user'],
      {
        viewerId: 'viewer-1',
        canViewAllUsers: true,
        canViewManagedUsers: false,
        canViewInternal: false,
        canViewExternal: false,
      },
      testDb,
    );

    expect(result).toEqual([]);
    expect(exec.calls[0].sql).not.toContain('user_work_units assignee_uw');
  });
});
