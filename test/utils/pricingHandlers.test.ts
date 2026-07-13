import { describe, expect, test } from 'bun:test';
import { calcProductSalePrice, type PricingItem } from '../../utils/numbers';
import { makeCostUpdater, makeMolUpdater, makeUnitPriceUpdater } from '../../utils/pricingHandlers';

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
  test('updates productCost and derives MOL while preserving the sale price', () => {
    const state: FormState = { items: [baseItem({ productCost: 50, productMolPercentage: 25 })] };
    const next = makeCostUpdater<FormState>(0, '80')(state);
    const updated = next.items?.[0];
    expect(updated?.productCost).toBe(80);
    expect(updated?.unitPrice).toBe(100);
    expect(updated?.productMolPercentage).toBe(20);
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
    expect(next.items?.[0].productMolPercentage).toBe(20);
  });

  test("writes supplierQuoteUnitPrice in the LINE's unit when item is linked to a quote", () => {
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

  test('does NOT convert a supplier-sourced days cost to hours on edit (#812 round 19)', () => {
    // supplierQuoteUnitPrice mirrors the supplier item, whose unit the line copies — the server
    // snapshot, the #779 forward sync and the staleness compare all read it in that unit. The old
    // hourly conversion stored 10 and pushed a ÷8 cost onto a days-priced supplier item.
    const state: FormState = {
      items: [
        baseItem({
          supplierQuoteItemId: 'q1',
          supplierQuoteUnitPrice: 70,
          unitType: 'days',
          productCost: undefined,
        }),
      ],
    };
    const next = makeCostUpdater<FormState>(0, '80')(state);
    expect(next.items?.[0].supplierQuoteUnitPrice).toBe(80);
    expect(next.items?.[0].unitPrice).toBe(100);
    expect(next.items?.[0].productMolPercentage).toBe(20);
  });

  test('keeps a cleared cost unfilled and clears MOL without overwriting the sale price', () => {
    const state: FormState = { items: [baseItem({ productCost: 50, productMolPercentage: 25 })] };
    const next = makeCostUpdater<FormState>(0, '')(state);
    expect(next.items?.[0].productCost).toBeUndefined();
    expect(next.items?.[0].unitPrice).toBe(100);
    expect(next.items?.[0].productMolPercentage).toBeNull();
  });
});

describe('makeUnitPriceUpdater', () => {
  test('updates sale price and automatically derives MOL from the current cost', () => {
    const state: FormState = { items: [baseItem({ productCost: 60, productMolPercentage: 0 })] };
    const next = makeUnitPriceUpdater<FormState>(0, '80')(state);
    expect(next.items?.[0].unitPrice).toBe(80);
    expect(next.items?.[0].productMolPercentage).toBe(25);
  });

  test('uses the line-unit cost for a day-priced product', () => {
    const state: FormState = {
      items: [baseItem({ productCost: 10, productMolPercentage: 0, unitType: 'days' })],
    };
    const next = makeUnitPriceUpdater<FormState>(0, '120')(state);
    expect(next.items?.[0].productMolPercentage).toBe(33.33);
  });

  test('shows a negative MOL when the sale price is below cost', () => {
    const state: FormState = { items: [baseItem({ productCost: 120 })] };
    const next = makeUnitPriceUpdater<FormState>(0, '80')(state);
    expect(next.items?.[0].productMolPercentage).toBe(-50);
  });

  test('clears the MOL when the sale price is cleared', () => {
    const state: FormState = { items: [baseItem({ productMolPercentage: 50 })] };
    const next = makeUnitPriceUpdater<FormState>(0, '')(state);
    expect(next.items?.[0].unitPrice).toBeUndefined();
    expect(next.items?.[0].productMolPercentage).toBeNull();
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

  test('clamps MOL at 99.99 and recalculates price instead of silently resetting margin', () => {
    const state: FormState = { items: [baseItem({ productCost: 50, productMolPercentage: 0 })] };
    const next = makeMolUpdater<FormState>(0, '118')(state);
    expect(next.items?.[0].productMolPercentage).toBe(99.99);
    expect(next.items?.[0].unitPrice).toBeCloseTo(calcProductSalePrice(50, 99.99), 5);
  });

  test('preserves other items when updating one', () => {
    const a = baseItem({ productMolPercentage: 0 });
    const b = baseItem({ productMolPercentage: 50 });
    const state: FormState = { items: [a, b] };
    const next = makeMolUpdater<FormState>(0, '20')(state);
    expect(next.items?.[1]).toBe(b);
  });

  test('keeps a cleared MOL unfilled while recalculating with the neutral percentage', () => {
    const state: FormState = { items: [baseItem({ productCost: 50, productMolPercentage: 25 })] };
    const next = makeMolUpdater<FormState>(0, '')(state);
    expect(next.items?.[0].productMolPercentage).toBeNull();
    expect(next.items?.[0].unitPrice).toBe(50);
  });
});
