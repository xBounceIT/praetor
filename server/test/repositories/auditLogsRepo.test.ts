import { beforeEach, describe, expect, test } from 'bun:test';
import * as auditLogsRepo from '../../repositories/auditLogsRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

describe('list', () => {
  test('emits no WHERE clause and no params when filter is empty', async () => {
    exec.enqueue({ rows: [] });
    await auditLogsRepo.list({}, exec);
    expect(exec.calls[0].sql).not.toContain('WHERE');
    expect(exec.calls[0].params).toEqual([]);
  });

  test('emits a >= clause bound to $1 when only startDate is set', async () => {
    exec.enqueue({ rows: [] });
    await auditLogsRepo.list({ startDate: '2024-01-01' }, exec);
    expect(exec.calls[0].sql).toContain('al.created_at >= $1::timestamptz');
    expect(exec.calls[0].params).toEqual(['2024-01-01']);
  });

  test('emits a <= clause bound to $1 (not $2) when only endDate is set', async () => {
    exec.enqueue({ rows: [] });
    await auditLogsRepo.list({ endDate: '2024-12-31' }, exec);
    expect(exec.calls[0].sql).toContain('al.created_at <= $1::timestamptz');
    expect(exec.calls[0].params).toEqual(['2024-12-31']);
  });

  test('emits both clauses joined by AND when both dates are set', async () => {
    exec.enqueue({ rows: [] });
    await auditLogsRepo.list({ startDate: '2024-01-01', endDate: '2024-12-31' }, exec);
    expect(exec.calls[0].sql).toContain('al.created_at >= $1::timestamptz');
    expect(exec.calls[0].sql).toContain('al.created_at <= $2::timestamptz');
    expect(exec.calls[0].sql).toContain(' AND ');
    expect(exec.calls[0].params).toEqual(['2024-01-01', '2024-12-31']);
  });

  test('returns createdAt verbatim from pg as a number', async () => {
    const row = {
      id: 'a1',
      userId: 'u1',
      userName: 'User',
      username: 'user',
      action: 'login',
      entityType: null,
      entityId: null,
      ipAddress: '127.0.0.1',
      createdAt: 1700000000000,
      details: null,
    };
    exec.enqueue({ rows: [row] });
    const result = await auditLogsRepo.list({}, exec);
    expect(result).toHaveLength(1);
    expect(result[0].createdAt).toBe(1700000000000);
  });
});

describe('create', () => {
  const baseInput = {
    userId: 'user-1',
    action: 'login',
    entityType: null,
    entityId: null,
    ipAddress: '127.0.0.1',
    details: null,
  } as const;

  test('targets audit_logs and lists the 7 columns in declared order', async () => {
    exec.enqueue({ rows: [] });
    await auditLogsRepo.create(baseInput, exec);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(sql).toContain('(id, user_id, action, entity_type, entity_id, ip_address, details)');
    expect(sql).toContain('$7::jsonb');
  });

  test('binds params $1..$7 in declared order with id first', async () => {
    exec.enqueue({ rows: [] });
    await auditLogsRepo.create(
      {
        userId: 'user-1',
        action: 'user.update',
        entityType: 'user',
        entityId: 'user-2',
        ipAddress: '10.0.0.1',
        details: null,
      },
      exec,
    );
    const params = exec.calls[0].params;
    expect(params).toHaveLength(7);
    expect(params[0]).toMatch(/^audit-/);
    expect(params.slice(1)).toEqual(['user-1', 'user.update', 'user', 'user-2', '10.0.0.1', null]);
  });

  test('generates a fresh id per call', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    await auditLogsRepo.create(baseInput, exec);
    await auditLogsRepo.create(baseInput, exec);
    expect(exec.calls[0].params[0]).not.toBe(exec.calls[1].params[0]);
  });

  test('passes details: null through as a literal null (not the string "null")', async () => {
    exec.enqueue({ rows: [] });
    await auditLogsRepo.create({ ...baseInput, details: null }, exec);
    expect(exec.calls[0].params[6]).toBeNull();
  });

  test('JSON-stringifies a non-null details object', async () => {
    exec.enqueue({ rows: [] });
    await auditLogsRepo.create(
      { ...baseInput, details: { targetLabel: 'Acme', counts: { items: 3 } } },
      exec,
    );
    const detailsParam = exec.calls[0].params[6];
    expect(typeof detailsParam).toBe('string');
    expect(JSON.parse(detailsParam as string)).toEqual({
      targetLabel: 'Acme',
      counts: { items: 3 },
    });
  });

  test('resolves to undefined', async () => {
    exec.enqueue({ rows: [] });
    const result = await auditLogsRepo.create(baseInput, exec);
    expect(result).toBeUndefined();
  });
});
