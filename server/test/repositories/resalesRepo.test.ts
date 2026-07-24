import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import {
  computeSupplierOrderTotal,
  deleteCategoryIfUnused,
  listOrderOptions,
} from '../../repositories/resalesRepo.ts';
import type { SupplierOrder, SupplierOrderItem } from '../../repositories/supplierOrdersRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const makeOrder = (overrides: Partial<Pick<SupplierOrder, 'discount' | 'discountType'>>) =>
  ({
    discount: 0,
    discountType: 'percentage',
    ...overrides,
  }) as Pick<SupplierOrder, 'discount' | 'discountType'>;

const makeItem = (overrides: Partial<SupplierOrderItem>) =>
  ({
    id: 'item-1',
    orderId: 'so-1',
    productId: null,
    productName: 'Hardware',
    quantity: 1,
    unitType: 'unit',
    unitPrice: 0,
    discount: 0,
    legacyDiscountRounding: false,
    note: null,
    durationMonths: 1,
    durationUnit: 'months',
    ...overrides,
  }) as SupplierOrderItem;

const SUPPLIER_ORDER_BASE: readonly unknown[] = [
  'so-1',
  'q-1',
  'sup-1',
  'CloudSeat Licensing',
  'immediate',
  '0',
  'percentage',
  'draft',
  null,
  new Date('2026-06-12T00:00:00Z'),
  new Date('2026-06-12T00:01:00Z'),
];

const SUPPLIER_ORDER_ITEM_BASE: readonly unknown[] = [
  'soi-1',
  'so-1',
  null,
  'License',
  '1',
  'unit',
  '9',
  '0',
  false,
  null,
  new Date('2026-06-12T00:00:00Z'),
  1,
  'months',
];

describe('computeSupplierOrderTotal', () => {
  test('uses line duration and line discounts before order discount', () => {
    const total = computeSupplierOrderTotal(
      makeOrder({ discount: 10, discountType: 'percentage' }),
      [
        makeItem({ quantity: 2, unitPrice: 100, discount: 25, durationMonths: 3 }),
        makeItem({ id: 'item-2', quantity: 1, unitPrice: 50, durationUnit: 'na' }),
      ],
    );

    expect(total).toBe(450);
  });

  test('uses the displayed year value for supplier-order costs', () => {
    const total = computeSupplierOrderTotal(makeOrder({}), [
      makeItem({ quantity: 2, unitPrice: 100, durationMonths: 24, durationUnit: 'years' }),
    ]);

    expect(total).toBe(400);
  });

  test('caps currency order discount at the computed subtotal', () => {
    const total = computeSupplierOrderTotal(
      makeOrder({ discount: 500, discountType: 'currency' }),
      [makeItem({ quantity: 1, unitPrice: 120 })],
    );

    expect(total).toBe(0);
  });

  test('caps percentage order discount at 100% for legacy invalid data', () => {
    const total = computeSupplierOrderTotal(
      makeOrder({ discount: 150, discountType: 'percentage' }),
      [makeItem({ quantity: 1, unitPrice: 120 })],
    );

    expect(total).toBe(0);
  });

  test('rounds only after multiplying the precise discounted price by quantity', () => {
    const total = computeSupplierOrderTotal(makeOrder({}), [
      makeItem({ quantity: 100, unitPrice: 10.01, discount: 10 }),
    ]);

    expect(total).toBe(900.9);
  });

  test('keeps migrated supplier-order costs stable without flattening gross price and discount', () => {
    const item = makeItem({
      quantity: 150,
      unitPrice: 37.75,
      discount: 15,
      legacyDiscountRounding: true,
    });

    expect(item).toEqual(
      expect.objectContaining({ unitPrice: 37.75, discount: 15, legacyDiscountRounding: true }),
    );
    expect(computeSupplierOrderTotal(makeOrder({}), [item])).toBe(4813.5);
  });
});

describe('listOrderOptions', () => {
  test('includes draft client orders when they have linked supplier orders', async () => {
    exec.enqueue({
      rows: [
        {
          clientOrderId: 'ORD-2026-0001',
          clientName: 'Acme Corp',
          supplierOrderId: 'so-1',
          supplierName: 'CloudSeat Licensing',
        },
      ],
    });
    exec.enqueue({ rows: [makeRow(SUPPLIER_ORDER_BASE)] });
    exec.enqueue({ rows: [makeRow(SUPPLIER_ORDER_ITEM_BASE)] });

    const options = await listOrderOptions(testDb);

    expect(exec.calls[0].sql.toLowerCase()).not.toContain("s.status = 'confirmed'");
    expect(options).toEqual([
      {
        clientOrderId: 'ORD-2026-0001',
        clientName: 'Acme Corp',
        supplierOrders: [{ id: 'so-1', supplierName: 'CloudSeat Licensing', total: 9 }],
      },
    ]);
  });
});

describe('deleteCategoryIfUnused', () => {
  test('deletes with a conditional NOT EXISTS guard in one statement', async () => {
    exec.enqueue({ rows: [{ id: 'rvc-1' }] });

    const result = await deleteCategoryIfUnused('rvc-1', testDb);

    expect(result).toEqual({ status: 'deleted' });
    expect(exec.calls).toHaveLength(1);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('delete from resale_categories');
    expect(sql).toContain('not exists');
    expect(sql).toContain('resale_activities');
    expect(sql).toContain('returning');
    expect(exec.calls[0].params).toContain('rvc-1');
  });

  test('returns in_use when activities reference the category (no unconditional delete)', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [['2']] });

    const result = await deleteCategoryIfUnused('rvc-1', testDb);

    expect(result).toEqual({ status: 'in_use', activityCount: 2 });
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('not exists');
    expect(exec.calls[1].sql.toLowerCase()).toContain('resale_activities');
  });

  test('returns not_found when the category is missing and unused', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [['0']] });

    const result = await deleteCategoryIfUnused('missing', testDb);

    expect(result).toEqual({ status: 'not_found' });
  });
});
