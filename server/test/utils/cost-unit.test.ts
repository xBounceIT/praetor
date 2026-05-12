import { describe, expect, test } from 'bun:test';
import type { CostUnit } from '../../utils/cost-unit.ts';

// cost-unit.ts only exports the CostUnit string-union type. There is no runtime
// surface to exercise, so we simply pin the documented members.
describe('CostUnit', () => {
  test('accepts the documented "unit" and "hours" members', () => {
    const a: CostUnit = 'unit';
    const b: CostUnit = 'hours';
    expect([a, b]).toEqual(['unit', 'hours']);
  });
});
