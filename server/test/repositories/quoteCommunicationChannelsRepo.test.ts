import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as repo from '../../repositories/quoteCommunicationChannelsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('listAllWithCounts', () => {
  test('maps raw SQL timestamp strings without requiring Date instances', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'qcc_email',
          name: 'Email',
          createdAt: '2026-01-01T10:00:00.000Z',
          updatedAt: '2026-01-02T11:30:00.000Z',
          clientQuoteCount: '2',
          supplierQuoteCount: '3',
        },
      ],
    });

    const [channel] = await repo.listAllWithCounts(testDb);

    expect(exec.calls[0].sql).toContain('quote_communication_channels');
    expect(channel).toEqual({
      id: 'qcc_email',
      name: 'Email',
      createdAt: new Date('2026-01-01T10:00:00.000Z').getTime(),
      updatedAt: new Date('2026-01-02T11:30:00.000Z').getTime(),
      clientQuoteCount: 2,
      supplierQuoteCount: 3,
      totalQuoteCount: 5,
    });
  });
});
