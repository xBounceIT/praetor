import { beforeEach, describe, expect, test } from 'bun:test';
import * as productsRepo from '../../repositories/productsRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

describe('getSnapshots', () => {
  test('returns empty Map when given no ids without issuing a query', async () => {
    const result = await productsRepo.getSnapshots([], exec);
    expect(result.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  test('deduplicates ids and passes a unique-set array to ANY($1)', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.getSnapshots(['p-1', 'p-1', 'p-2'], exec);
    expect(exec.calls[0].sql).toContain('id = ANY($1)');
    expect(exec.calls[0].params).toEqual([['p-1', 'p-2']]);
  });

  test('maps cost as number and preserves null molPercentage', async () => {
    exec.enqueue({
      rows: [
        { id: 'p-1', costo: '10.5', molPercentage: '20' },
        { id: 'p-2', costo: '5', molPercentage: null },
      ],
    });
    const result = await productsRepo.getSnapshots(['p-1', 'p-2'], exec);
    expect(result.get('p-1')).toEqual({ productCost: 10.5, productMolPercentage: 20 });
    expect(result.get('p-2')).toEqual({ productCost: 5, productMolPercentage: null });
  });

  test('coerces empty/falsy ids out before deduplication', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.getSnapshots(['', 'p-1', ''], exec);
    expect(exec.calls[0].params).toEqual([['p-1']]);
  });
});
