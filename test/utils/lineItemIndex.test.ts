import { describe, expect, test } from 'bun:test';
import { createLineItemIndexResolver } from '../../utils/lineItemIndex';

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
