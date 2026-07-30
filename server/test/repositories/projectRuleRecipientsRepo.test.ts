import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as recipientsRepo from '../../repositories/projectRuleRecipientsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('projectRuleRecipientsRepo', () => {
  test('lists enabled project-assigned users, role summaries, and enabled webhooks', async () => {
    exec.enqueue({
      rows: [{ id: 'u1', name: 'Alice', username: 'alice', avatarInitials: 'AL' }],
    });
    exec.enqueue({ rows: [{ id: 'manager', name: 'Manager' }] });
    exec.enqueue({ rows: [{ id: 'webhook-1', name: 'Slack' }] });
    exec.enqueue({
      rows: [
        {
          id: 'u1',
          name: 'Alice',
          username: 'alice',
          avatarInitials: 'AL',
          isDisabled: false,
        },
      ],
    });
    exec.enqueue({ rows: [{ id: 't1', name: 'Analysis', isDisabled: false }] });

    const result = await recipientsRepo.listRecipientOptions('p1', testDb);

    expect(result).toEqual({
      users: [{ id: 'u1', name: 'Alice', username: 'alice', avatarInitials: 'AL' }],
      roles: [{ id: 'manager', name: 'Manager' }],
      webhooks: [{ id: 'webhook-1', name: 'Slack' }],
      filters: {
        users: [
          {
            id: 'u1',
            name: 'Alice',
            username: 'alice',
            avatarInitials: 'AL',
            isDisabled: false,
          },
        ],
        tasks: [{ id: 't1', name: 'Analysis', isDisabled: false }],
      },
    });
    expect(exec.calls[0].sql).toContain('INNER JOIN user_projects');
    expect(exec.calls[0].sql).toContain('COALESCE(u.is_disabled, false) = false');
    expect(exec.calls[1].sql).toContain('INNER JOIN user_projects');
    expect(exec.calls[1].sql).toContain('LEFT JOIN user_roles');
    expect(exec.calls[1].sql).toContain('up.project_id');
    expect(exec.calls[1].sql).toContain('COALESCE(u.is_disabled, false) = false');
    expect(exec.calls[1].params).toContain('p1');
    expect(exec.calls[2].sql).toContain('FROM webhooks');
    expect(exec.calls[2].sql).toContain('WHERE enabled = true');
    expect(exec.calls[3].sql).toContain('FROM time_entries');
    expect(exec.calls[4].sql).toContain('FROM tasks');
  });

  test('finds invalid explicit users, roles, and webhooks', async () => {
    exec.enqueue({ rows: [{ id: 'u1' }] });
    exec.enqueue({ rows: [{ id: 'manager' }] });
    exec.enqueue({ rows: [{ id: 'webhook-1' }] });

    const result = await recipientsRepo.findInvalidRecipientIds(
      'p1',
      {
        recipientUserIds: ['u1', 'u2'],
        recipientRoleIds: ['manager', 'ghost'],
        webhookIds: ['webhook-1', 'webhook-missing'],
        actions: [],
      },
      testDb,
    );

    expect(result).toEqual({
      userIds: ['u2'],
      roleIds: ['ghost'],
      webhookIds: ['webhook-missing'],
    });
    expect(exec.calls[1].sql).toContain('INNER JOIN user_projects');
    expect(exec.calls[1].sql).toContain('LEFT JOIN user_roles');
    expect(exec.calls[1].sql).toContain('up.project_id');
    expect(exec.calls[1].sql).toContain('COALESCE(u.is_disabled, false) = false');
    expect(exec.calls[1].params).toContain('p1');
  });

  test('allows configured disabled webhook ids during update validation', async () => {
    exec.enqueue({ rows: [{ id: 'webhook-disabled' }] });

    const result = await recipientsRepo.findInvalidRecipientIds(
      'p1',
      {
        recipientUserIds: [],
        recipientRoleIds: [],
        webhookIds: ['webhook-disabled', 'webhook-new-disabled'],
        actions: [],
      },
      testDb,
      { allowedDisabledWebhookIds: ['webhook-disabled'] },
    );

    expect(result).toEqual({
      userIds: [],
      roleIds: [],
      webhookIds: ['webhook-new-disabled'],
    });
    expect(exec.calls[0].sql).toContain('enabled = true');
    expect(exec.calls[0].sql).toContain('id = ANY');
  });

  test('allows existing unassigned role ids while a rule is being disabled', async () => {
    exec.enqueue({ rows: [{ id: 'manager' }] });

    const result = await recipientsRepo.findInvalidRecipientIds(
      'p1',
      {
        recipientUserIds: [],
        recipientRoleIds: ['manager', 'ghost'],
        webhookIds: [],
        actions: [],
      },
      testDb,
      { allowedUnassignedRoleIds: ['manager'] },
    );

    expect(result).toEqual({
      userIds: [],
      roleIds: ['ghost'],
      webhookIds: [],
    });
    expect(exec.calls[0].sql).toContain('INNER JOIN user_projects');
    expect(exec.calls[0].sql).toContain('r.id = ANY');
    expect(exec.calls[0].params).toContainEqual(['manager']);
  });

  test('resolves explicit users plus project-assigned primary and secondary role users', async () => {
    exec.enqueue({ rows: [{ id: 'u1' }, { id: 'u2' }] });

    const result = await recipientsRepo.resolveRecipientUserIds(
      'p1',
      {
        recipientUserIds: ['u1'],
        recipientRoleIds: ['manager'],
        webhookIds: [],
        actions: [],
      },
      testDb,
    );

    expect(result).toEqual(['u1', 'u2']);
    expect(exec.calls[0].sql).toContain('INNER JOIN user_projects');
    expect(exec.calls[0].sql).toContain('up.project_id');
    expect(exec.calls[0].params).toContain('p1');
    expect(exec.calls[0].sql).toContain('LEFT JOIN user_roles');
    expect(exec.calls[0].sql).toContain('u.role = ANY');
    expect(exec.calls[0].sql).toContain('ur.role_id = ANY');
  });

  test('rejects periodic filters outside the project scope', async () => {
    exec.enqueue({ rows: [{ id: 'u1' }] });
    exec.enqueue({ rows: [{ id: 't1' }] });

    const result = await recipientsRepo.findInvalidScheduleFilterIds(
      'p1',
      { userIds: ['u1', 'u2'], taskIds: ['t1', 't2'] },
      testDb,
    );

    expect(result).toEqual({ userIds: ['u2'], taskIds: ['t2'] });
    expect(exec.calls[0].sql).toContain('FROM user_projects');
    expect(exec.calls[1].sql).toContain('t.project_id');
  });

  test('allows existing orphaned filters only when explicitly requested', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });

    const result = await recipientsRepo.findInvalidScheduleFilterIds(
      'p1',
      { userIds: ['deleted-user'], taskIds: ['deleted-task'] },
      testDb,
      { userIds: ['deleted-user'], taskIds: ['deleted-task'] },
    );

    expect(result).toEqual({ userIds: [], taskIds: [] });
  });
});
