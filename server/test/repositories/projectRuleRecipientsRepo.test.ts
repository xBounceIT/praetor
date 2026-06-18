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

    const result = await recipientsRepo.listRecipientOptions('p1', testDb);

    expect(result).toEqual({
      users: [{ id: 'u1', name: 'Alice', username: 'alice', avatarInitials: 'AL' }],
      roles: [{ id: 'manager', name: 'Manager' }],
      webhooks: [{ id: 'webhook-1', name: 'Slack' }],
    });
    expect(exec.calls[0].sql).toContain('INNER JOIN user_projects');
    expect(exec.calls[0].sql).toContain('COALESCE(u.is_disabled, false) = false');
    expect(exec.calls[2].sql).toContain('FROM webhooks');
    expect(exec.calls[2].sql).toContain('WHERE enabled = true');
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
  });

  test('resolves explicit project users plus primary and secondary role users', async () => {
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
    expect(exec.calls[0].sql).toContain('LEFT JOIN user_roles');
    expect(exec.calls[0].sql).toContain('u.role = ANY');
    expect(exec.calls[0].sql).toContain('ur.role_id = ANY');
  });
});
