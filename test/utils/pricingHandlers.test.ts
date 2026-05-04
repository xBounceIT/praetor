import { describe, expect, test } from 'bun:test';
import { calcProductSalePrice, type PricingItem } from '../../utils/numbers';
import { makeCostUpdater, makeMolUpdater } from '../../utils/pricingHandlers';

type FormState = { items?: PricingItem[]; otherField?: string };

const baseItem = (overrides: Partial<PricingItem> = {}): PricingItem => ({
  unitPrice: 100,
  quantity: 1,
  productCost: 50,
  productMolPercentage: 0,
  unitType: 'hours',
  ...overrides,
});

describe('makeCostUpdater', () => {
  test('updates productCost (in hours) and unitPrice when cost changes', () => {
    const state: FormState = { items: [baseItem({ productCost: 50, productMolPercentage: 25 })] };
    const next = makeCostUpdater<FormState>(0, '80')(state);
    const updated = next.items?.[0];
    expect(updated?.productCost).toBe(80);
    expect(updated?.unitPrice).toBeCloseTo(calcProductSalePrice(80, 25), 5);
  });

  test('returns the same reference when the cost is unchanged (no-op optimization)', () => {
    const state: FormState = { items: [baseItem({ productCost: 50 })] };
    const next = makeCostUpdater<FormState>(0, '50')(state);
    expect(next).toBe(state);
  });

  test('returns the same reference when the index is out of range', () => {
    const state: FormState = { items: [baseItem()] };
    const next = makeCostUpdater<FormState>(5, '99')(state);
    expect(next).toBe(state);
  });

  test('returns the same reference when items is undefined', () => {
    const state: FormState = {};
    const next = makeCostUpdater<FormState>(0, '99')(state);
    expect(next).toBe(state);
  });

  test('preserves sibling fields and other items in the array', () => {
    const a = baseItem({ productCost: 10 });
    const b = baseItem({ productCost: 20 });
    const state: FormState = { items: [a, b], otherField: 'keep' };
    const next = makeCostUpdater<FormState>(0, '15')(state);
    expect(next.otherField).toBe('keep');
    expect(next.items?.[1]).toBe(b); // untouched item is the same reference
  });

  test('converts user-entered cost from days back to hours when item unitType is days', () => {
    // user enters 80 (per day) → stored productCost (hours) should be 10
    const state: FormState = { items: [baseItem({ unitType: 'days', productCost: 0 })] };
    const next = makeCostUpdater<FormState>(0, '80', 'hours')(state);
    expect(next.items?.[0].productCost).toBe(10);
  });

  test('writes supplierQuoteUnitPrice (in hours) when item is linked to a quote', () => {
    const state: FormState = {
      items: [
        baseItem({
          supplierQuoteItemId: 'q1',
          supplierQuoteUnitPrice: 5,
          productCost: undefined,
        }),
      ],
    };
    const next = makeCostUpdater<FormState>(0, '8')(state);
    expect(next.items?.[0].supplierQuoteUnitPrice).toBe(8);
    // productCost should be untouched on quote-linked items
    expect(next.items?.[0].productCost).toBeUndefined();
  });
});

describe('makeMolUpdater', () => {
  test('updates productMolPercentage and recalculates unitPrice from existing cost', () => {
    const state: FormState = { items: [baseItem({ productCost: 100, productMolPercentage: 0 })] };
    const next = makeMolUpdater<FormState>(0, '25')(state);
    const updated = next.items?.[0];
    expect(updated?.productMolPercentage).toBe(25);
    expect(updated?.unitPrice).toBeCloseTo(calcProductSalePrice(100, 25), 5);
  });

  test('returns the same reference when MOL is unchanged', () => {
    const state: FormState = { items: [baseItem({ productMolPercentage: 25 })] };
    const next = makeMolUpdater<FormState>(0, '25')(state);
    expect(next).toBe(state);
  });

  test('returns the same reference when index is out of range', () => {
    const state: FormState = { items: [baseItem()] };
    const next = makeMolUpdater<FormState>(99, '50')(state);
    expect(next).toBe(state);
  });

  test('clamps MOL ≥ 100 by reusing cost as price (delegates to calcProductSalePrice)', () => {
    const state: FormState = { items: [baseItem({ productCost: 50, productMolPercentage: 0 })] };
    const next = makeMolUpdater<FormState>(0, '100')(state);
    expect(next.items?.[0].unitPrice).toBe(50);
  });

  test('preserves other items when updating one', () => {
    const a = baseItem({ productMolPercentage: 0 });
    const b = baseItem({ productMolPercentage: 50 });
    const state: FormState = { items: [a, b] };
    const next = makeMolUpdater<FormState>(0, '20')(state);
    expect(next.items?.[1]).toBe(b);
  });
});
