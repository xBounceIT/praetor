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
