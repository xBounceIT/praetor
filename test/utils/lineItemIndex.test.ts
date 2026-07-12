import { describe, expect, test } from 'bun:test';
import { createLineItemIndexResolver, createTemporaryLineItemId } from '../../utils/lineItemIndex';

describe('createTemporaryLineItemId', () => {
  test('stays unique when multiple rows are created in the same millisecond', () => {
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;

    try {
      const first = createTemporaryLineItemId();
      const second = createTemporaryLineItemId();
      expect(first).not.toBe(second);
      expect(first).toStartWith('temp-');
      expect(second).toStartWith('temp-');
    } finally {
      Date.now = originalNow;
    }
  });

  test('supports descriptive prefixes for specialized temporary rows', () => {
    expect(createTemporaryLineItemId('temp-reprice')).toStartWith('temp-reprice-');
  });
});

describe('createLineItemIndexResolver', () => {
  test('resolves sorted and filtered rows to their original form indices', () => {
    const items = [{ id: 'alpha' }, { id: 'bravo' }, { id: 'charlie' }];
    const resolveIndex = createLineItemIndexResolver(items);
    const sortedFilteredRows = [items[2], items[0]];

    expect(sortedFilteredRows.map(resolveIndex)).toEqual([2, 0]);
    expect(resolveIndex({ id: 'missing' })).toBe(-1);
  });

  test('preserves findIndex semantics when duplicate ids are encountered', () => {
    const resolveIndex = createLineItemIndexResolver([
      { id: 'duplicate' },
      { id: 'other' },
      { id: 'duplicate' },
    ]);

    expect(resolveIndex({ id: 'duplicate' })).toBe(0);
  });
});
