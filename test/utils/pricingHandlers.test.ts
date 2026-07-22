import { describe, expect, test } from 'bun:test';
import { calcProductSalePrice, type PricingItem } from '../../utils/numbers';
import {
  makeCostUpdater,
  makeMolUpdater,
  makeRevenueUpdater,
  makeUnitPriceUpdater,
} from '../../utils/pricingHandlers';

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

  test('preserves user-entered cost when item unitType is days', () => {
    const state: FormState = { items: [baseItem({ unitType: 'days', productCost: 0 })] };
    const next = makeCostUpdater<FormState>(0, '80')(state);
    expect(next.items?.[0].productCost).toBe(80);
    expect(next.items?.[0].productMolPercentage).toBe(20);
  });

  test('keeps hourly storage when editing a legacy product-backed day cost', () => {
    const state: FormState = {
      items: [
        baseItem({
          unitType: 'days',
          productCost: 50,
          pricingSemanticsVersion: 1,
        }),
      ],
    };

    const next = makeCostUpdater<FormState>(0, '480')(state);

    expect(next.items?.[0].productCost).toBe(60);
    expect(next.items?.[0].productMolPercentage).toBe(-380);
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

  test('preserves a supplier-sourced days cost on edit', () => {
    const state: FormState = {
      items: [
        baseItem({
          supplierQuoteItemId: 'q1',
          supplierQuoteUnitPrice: 70,
          unitType: 'days',
          pricingSemanticsVersion: 1,
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

  test('does not convert cost for a day-labelled product', () => {
    const state: FormState = {
      items: [baseItem({ productCost: 10, productMolPercentage: 0, unitType: 'days' })],
    };
    const next = makeUnitPriceUpdater<FormState>(0, '120')(state);
    expect(next.items?.[0].productMolPercentage).toBe(91.67);
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

describe('makeRevenueUpdater', () => {
  test('back-solves net revenue through quantity, duration, and line discount', () => {
    const state: FormState = {
      items: [
        baseItem({
          productCost: 60,
          productMolPercentage: 40,
          quantity: 2,
          durationMonths: 3,
          discount: 20,
        }),
      ],
    };

    const next = makeRevenueUpdater<FormState>(0, '720')(state);
    const updated = next.items?.[0];
    expect(updated?.unitPrice).toBeCloseTo(150, 10);
    expect(updated?.productMolPercentage).toBe(60);
    expect(updated?.productCost).toBe(60);
  });

  test('preserves a supplier-quote cost while deriving the sale price and MOL', () => {
    const state: FormState = {
      items: [
        baseItem({
          supplierQuoteItemId: 'supplier-item-1',
          supplierQuoteUnitPrice: 80,
          productCost: undefined,
          quantity: 2,
        }),
      ],
    };

    const next = makeRevenueUpdater<FormState>(0, '240')(state);
    const updated = next.items?.[0];
    expect(updated?.unitPrice).toBe(120);
    expect(updated?.productMolPercentage).toBe(33.33);
    expect(updated?.supplierQuoteUnitPrice).toBe(80);
    expect(updated?.productCost).toBeUndefined();
  });

  test('uses the neutral duration multiplier for N/A lines', () => {
    const state: FormState = {
      items: [baseItem({ quantity: 2, durationMonths: 24, durationUnit: 'na' })],
    };
    const next = makeRevenueUpdater<FormState>(0, '200')(state);
    expect(next.items?.[0].unitPrice).toBe(100);
  });

  test('back-solves revenue using the displayed years multiplier', () => {
    const state: FormState = {
      items: [
        baseItem({
          productCost: 60,
          unitPrice: 80,
          quantity: 2,
          durationMonths: 12,
          durationUnit: 'years',
          discount: 20,
        }),
      ],
    };

    const next = makeRevenueUpdater<FormState>(0, '160')(state);
    expect(next.items?.[0].unitPrice).toBe(100);
    expect(next.items?.[0].productMolPercentage).toBe(40);
  });

  test('rounds the derived unit price to persisted currency precision', () => {
    const state: FormState = { items: [baseItem({ productCost: 10, quantity: 3 })] };
    const next = makeRevenueUpdater<FormState>(0, '100')(state);
    const updated = next.items?.[0];

    expect(updated?.unitPrice).toBe(33.33);
    expect(updated?.productMolPercentage).toBe(70);
    expect((updated?.unitPrice ?? 0) * 3).toBeCloseTo(99.99, 10);
  });

  test('clears sale price and MOL when revenue is cleared', () => {
    const state: FormState = { items: [baseItem({ productMolPercentage: 50 })] };
    const next = makeRevenueUpdater<FormState>(0, '')(state);
    expect(next.items?.[0].unitPrice).toBeUndefined();
    expect(next.items?.[0].productMolPercentage).toBeNull();
  });

  test('does not update when quantity is not positive', () => {
    const state: FormState = { items: [baseItem({ quantity: 0 })] };
    expect(makeRevenueUpdater<FormState>(0, '100')(state)).toBe(state);
  });

  test('does not update when a 100% line discount makes net revenue non-invertible', () => {
    const state: FormState = { items: [baseItem({ discount: 100 })] };
    expect(makeRevenueUpdater<FormState>(0, '100')(state)).toBe(state);
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
