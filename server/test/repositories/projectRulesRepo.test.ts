import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as projectRulesRepo from '../../repositories/projectRulesRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const createdAt = new Date(1700000000000);
const updatedAt = new Date(1700000100000);
const lastTriggeredAt = new Date(1700000050000);

const ruleRow = (overrides: Record<number, unknown> = {}) =>
  makeRow(
    [
      'pr-1',
      'p1',
      'Budget warning',
      'budget_used_pct',
      'gte',
      '80',
      'and',
      [{ field: 'budget_used_pct', operator: 'gte', value: '80', valueType: 'literal' }],
      'notify',
      { recipientUserIds: ['u1'], recipientRoleIds: ['manager'] },
      true,
      false,
      lastTriggeredAt,
      'u-admin',
      createdAt,
      updatedAt,
    ],
    overrides,
  );

describe('projectRulesRepo', () => {
  test('listByProject maps rule rows to API shape', async () => {
    exec.enqueue({ rows: [ruleRow()] });

    const result = await projectRulesRepo.listByProject('p1', testDb);

    expect(result).toEqual([
      {
        id: 'pr-1',
        projectId: 'p1',
        name: 'Budget warning',
        field: 'budget_used_pct',
        operator: 'gte',
        value: '80',
        conditionLogic: 'and',
        conditions: [
          { field: 'budget_used_pct', operator: 'gte', value: '80', valueType: 'literal' },
        ],
        actionType: 'notify',
        actionConfig: {
          recipientUserIds: ['u1'],
          recipientRoleIds: ['manager'],
          webhookIds: [],
          actions: [
            { type: 'notify', recipientType: 'user', recipientUserIds: ['u1'] },
            { type: 'notify', recipientType: 'role', recipientRoleIds: ['manager'] },
          ],
        },
        isEnabled: true,
        conditionMet: false,
        lastTriggeredAt: 1700000050000,
        createdBy: 'u-admin',
        createdAt: 1700000000000,
        updatedAt: 1700000100000,
      },
    ]);
  });

  test('create normalizes recipient config before insert', async () => {
    exec.enqueue({ rows: [ruleRow()] });

    await projectRulesRepo.create(
      {
        id: 'pr-1',
        projectId: 'p1',
        name: 'Budget warning',
        field: 'budget_used_pct',
        operator: 'gte',
        value: '80',
        conditionLogic: 'and',
        conditions: [
          { field: 'budget_used_pct', operator: 'gte', value: '80', valueType: 'literal' },
          { field: 'status', operator: 'eq', value: 'in_corso', valueType: 'literal' },
        ],
        actionType: 'notify',
        actionConfig: {
          recipientUserIds: [' u1 ', 'u1', ''],
          recipientRoleIds: [' manager ', 'manager', ''],
          webhookIds: [' webhook-1 ', 'webhook-1', ''],
          actions: [
            { type: 'notify', recipientType: 'user', recipientUserIds: ['u2', 'u2'] },
            { type: 'notify', recipientType: 'role', recipientRoleIds: ['admin', 'admin'] },
            { type: 'webhook', webhookId: 'webhook-2' },
          ],
        },
        isEnabled: true,
        createdBy: 'u-admin',
      },
      testDb,
    );

    expect(exec.calls[0].params).toContain(
      JSON.stringify({
        recipientUserIds: ['u1', 'u2'],
        recipientRoleIds: ['manager', 'admin'],
        webhookIds: ['webhook-1', 'webhook-2'],
        actions: [
          { type: 'notify', recipientType: 'user', recipientUserIds: ['u1', 'u2'] },
          { type: 'notify', recipientType: 'role', recipientRoleIds: ['manager', 'admin'] },
          { type: 'webhook', webhookId: 'webhook-1' },
          { type: 'webhook', webhookId: 'webhook-2' },
        ],
      }),
    );
  });

  test('update scopes by project and rule id, and can reset condition state', async () => {
    exec.enqueue({ rows: [ruleRow({ 2: 'Updated warning', 11: false, 12: null })] });

    const result = await projectRulesRepo.update(
      'p1',
      'pr-1',
      {
        name: 'Updated warning',
        resetCondition: true,
      },
      testDb,
    );

    expect(result?.name).toBe('Updated warning');
    expect(result?.conditionMet).toBe(false);
    expect(result?.lastTriggeredAt).toBeNull();
    expect(exec.calls[0].sql).toContain('"project_id" = $');
    expect(exec.calls[0].sql).toContain('"id" = $');
    expect(exec.calls[0].params).toContain('p1');
    expect(exec.calls[0].params).toContain('pr-1');
    expect(exec.calls[0].params).toContain(false);
  });

  test('deleteByProjectAndId deletes only the rule owned by the project', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });

    const result = await projectRulesRepo.deleteByProjectAndId('p1', 'pr-1', testDb);

    expect(result).toBe(true);
    expect(exec.calls[0].sql).toContain('"project_id" = $');
    expect(exec.calls[0].sql).toContain('"id" = $');
    expect(exec.calls[0].params).toContain('p1');
    expect(exec.calls[0].params).toContain('pr-1');
  });

  test('markTriggeredOnRisingEdge guards on condition_met=false', async () => {
    exec.enqueue({ rows: [['pr-1']] });

    const result = await projectRulesRepo.markTriggeredOnRisingEdge(
      'pr-1',
      new Date('2026-05-31T12:00:00'),
      testDb,
    );

    expect(result).toBe(true);
    expect(exec.calls[0].sql).toContain('"condition_met" = $');
    expect(exec.calls[0].params).toContain(false);
  });

  test('markConditionNotMet only resets previously met rules', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });

    const result = await projectRulesRepo.markConditionNotMet('pr-1', testDb);

    expect(result).toBe(true);
    expect(exec.calls[0].params).toContain(true);
  });
});
