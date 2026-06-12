import { describe, expect, test } from 'bun:test';
import { computeSupplierOrderTotal } from '../../repositories/resalesRepo.ts';
import type { SupplierOrder, SupplierOrderItem } from '../../repositories/supplierOrdersRepo.ts';

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
    unitPrice: 0,
    discount: 0,
    note: null,
    durationMonths: 1,
    durationUnit: 'months',
    ...overrides,
  }) as SupplierOrderItem;

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
});
