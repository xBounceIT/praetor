import { describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import { computeSupplierOrderTotal, listOrderOptions } from '../../repositories/resalesRepo.ts';
import type { SupplierOrder, SupplierOrderItem } from '../../repositories/supplierOrdersRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

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

  test('caps currency order discount at the computed subtotal', () => {
    const total = computeSupplierOrderTotal(
      makeOrder({ discount: 500, discountType: 'currency' }),
      [makeItem({ quantity: 1, unitPrice: 120 })],
    );

    expect(total).toBe(0);
  });

  test('rounds the discounted unit price before multiplying quantity', () => {
    const total = computeSupplierOrderTotal(makeOrder({}), [
      makeItem({ quantity: 100, unitPrice: 10.01, discount: 10 }),
    ]);

    expect(total).toBe(901);
  });
});

describe('listOrderOptions', () => {
  test('includes draft client orders when they have linked supplier orders', async () => {
    ({ exec, testDb } = setupTestDb());
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
