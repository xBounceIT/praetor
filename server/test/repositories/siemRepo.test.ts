import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as siemRepo from '../../repositories/siemRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('siemRepo outbox', () => {
  test('guards enablement with the same successfully tested revision', async () => {
    await siemRepo.enableTestedRevision(4, testDb);

    expect(exec.calls[0]?.sql).toContain('"revision" = $');
    expect(exec.calls[0]?.sql).toContain('"tested_revision" = $');
    expect(exec.calls[0]?.sql).toContain('"last_test_success" = $');
  });

  test('updates configuration only when the expected revision still matches', async () => {
    await siemRepo.updateConfigForRevision({ revision: 5, host: 'next.example.test' }, 4, testDb);

    expect(exec.calls[0]?.sql).toContain('"revision" = $');
    expect(exec.calls[0]?.params).toContain(4);
    expect(exec.calls[0]?.params).toContain(5);
    expect(exec.calls[0]?.params).toContain('next.example.test');
  });

  test('claims available or expired rows with SKIP LOCKED and a bounded batch', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'siem-1',
          payload: {
            eventId: 'runtime.http.info',
            occurredAt: '2026-07-14T10:00:00.000Z',
            level: 'info',
            category: 'runtime',
            resource: 'http',
            message: 'ok',
            attributes: {},
          },
          attempts: 2,
        },
      ],
    });

    const rows = await siemRepo.claimBatch('worker-a', 100, testDb);

    expect(rows[0]?.id).toBe('siem-1');
    expect(exec.calls[0]?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(exec.calls[0]?.sql).toContain("claimed_at < CURRENT_TIMESTAMP - INTERVAL '60 seconds'");
    expect(exec.calls[0]?.params).toEqual([100, 'worker-a']);
  });

  test('retry increments attempts, schedules availability, and clears the lease', async () => {
    exec.enqueue({ rows: [] });
    const availableAt = new Date('2026-07-14T10:05:00.000Z');

    await siemRepo.retry('siem-1', 'worker-a', availableAt, 'connection refused', testDb);

    const call = exec.calls[0];
    expect(call?.sql).toContain('attempts = attempts + 1');
    expect(call?.sql).toContain('claim_token = NULL');
    expect(call?.sql).toContain('claimed_at = NULL');
    expect(call?.params).toEqual([availableAt, 'connection refused', 'siem-1', 'worker-a']);
  });

  test('renews all leases owned by a worker claim token', async () => {
    await siemRepo.renewClaims('worker-a', testDb);

    expect(exec.calls[0]?.sql).toContain('SET claimed_at = CURRENT_TIMESTAMP');
    expect(exec.calls[0]?.sql).toContain('WHERE claim_token = $1');
    expect(exec.calls[0]?.params).toEqual(['worker-a']);
  });

  test('skips cleanup when another replica owns the cleanup lease', async () => {
    exec.enqueue({ rows: [{ acquired: false }] });

    const dropped = await siemRepo.cleanup(30, 1_000_000, testDb);

    expect(dropped).toEqual({ retention: 0, capacity: 0 });
    expect(exec.calls).toHaveLength(1);
  });

  test('cleanup removes expired and oldest excess events and records both drop counters', async () => {
    exec.enqueue({ rows: [{ acquired: true }] });
    exec.enqueue({ rows: [{ count: 4 }] });
    exec.enqueue({ rows: [{ count: 7 }] });
    exec.enqueue({ rows: [] });

    const dropped = await siemRepo.cleanup(30, 1_000_000, testDb);

    expect(dropped).toEqual({ retention: 4, capacity: 7 });
    expect(exec.calls[0]?.sql).toContain('pg_try_advisory_xact_lock');
    expect(exec.calls[1]?.sql).toContain("INTERVAL '1 day'");
    expect(exec.calls[1]?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(exec.calls[1]?.params).toContain(10_000);
    expect(exec.calls[2]?.sql).toContain('ORDER BY created_at ASC, id ASC');
    expect(exec.calls[2]?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(exec.calls[2]?.params).toContain(10_000);
    expect(exec.calls[2]?.params).toContain(1_000_000);
    expect(exec.calls[2]?.sql).not.toContain('OFFSET');
    expect(exec.calls[3]?.sql).toContain('dropped_retention = dropped_retention + $1');
    expect(exec.calls[3]?.sql).toContain('dropped_capacity = dropped_capacity + $2');
  });
});
