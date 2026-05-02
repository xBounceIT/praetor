import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as clientOffersRepo from '../../repositories/clientOffersRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Builder fixtures match the column order in db/schema/customerOffers.ts and
// db/schema/customerOfferItems.ts.
const OFFER_BASE: readonly unknown[] = [
  'co-1',
  'cq-1',
  'c-1',
  'Acme',
  'net30',
  '5',
  'percentage',
  'draft',
  '2026-06-01',
  null,
  new Date('2026-01-01T00:00:00Z'),
  new Date('2026-01-01T00:01:40Z'),
];

const offerRow = (overrides: Record<number, unknown> = {}) => makeRow(OFFER_BASE, overrides);

const ITEM_BASE: readonly unknown[] = [
  'coi-1',
  'co-1',
  'p-1',
  'Widget',
  '2',
  '10',
  '5',
  null,
  '0',
  null,
  new Date('2026-01-01T00:00:00Z'),
  'unit',
  null,
  null,
  null,
  null,
];

const itemRow = (overrides: Record<number, unknown> = {}) => makeRow(ITEM_BASE, overrides);

describe('listAll', () => {
  test('orders by created_at DESC and maps types', async () => {
    exec.enqueue({ rows: [offerRow()] });
    const result = await clientOffersRepo.listAll(testDb);
    expect(exec.calls[0].sql).toContain('from "customer_offers"');
    expect(exec.calls[0].sql).toContain('order by "customer_offers"."created_at" desc');
    expect(result[0].discount).toBe(5);
    expect(result[0].expirationDate).toBe('2026-06-01');
  });
});

describe('listAllItems', () => {
  test('orders items by created_at ASC', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await clientOffersRepo.listAllItems(testDb);
    expect(exec.calls[0].sql).toContain('order by "customer_offer_items"."created_at" asc');
    expect(result[0].quantity).toBe(2);
    expect(result[0].unitPrice).toBe(10);
    expect(result[0].unitType).toBe('unit');
  });
});

describe('existsById / findIdConflict', () => {
  test('existsById returns true on match', async () => {
    exec.enqueue({ rows: [['co-1']] });
    expect(await clientOffersRepo.existsById('co-1', testDb)).toBe(true);
  });

  test('findIdConflict excludes the current id via <> predicate', async () => {
    exec.enqueue({ rows: [] });
    await clientOffersRepo.findIdConflict('new', 'cur', testDb);
    expect(exec.calls[0].sql).toContain('"id" <> $2');
    expect(exec.calls[0].params).toEqual(['new', 'cur']);
  });
});

describe('findForUpdate', () => {
  test('returns existing offer fields needed for permission checks', async () => {
    exec.enqueue({ rows: [['co-1', 'cq-1', 'c-1', 'Acme', 'draft']] });
    const result = await clientOffersRepo.findForUpdate('co-1', testDb);
    expect(result?.linkedQuoteId).toBe('cq-1');
    expect(result?.status).toBe('draft');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientOffersRepo.findForUpdate('co-x', testDb)).toBeNull();
  });
});

describe('findExistingForQuote', () => {
  test('returns offer id when one exists for the quote', async () => {
    exec.enqueue({ rows: [['co-1']] });
    expect(await clientOffersRepo.findExistingForQuote('cq-1', testDb)).toBe('co-1');
  });

  test('returns null when none exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientOffersRepo.findExistingForQuote('cq-1', testDb)).toBeNull();
  });
});

describe('findLinkedSaleId', () => {
  test('queries sales.linked_offer_id and returns sale id', async () => {
    exec.enqueue({ rows: [['s-1']] });
    const result = await clientOffersRepo.findLinkedSaleId('co-1', testDb);
    expect(exec.calls[0].sql).toContain('from "sales"');
    expect(exec.calls[0].sql).toContain('"linked_offer_id" = $1');
    expect(result).toBe('s-1');
  });
});

describe('create', () => {
  test('inserts 10 fields and returns mapped offer', async () => {
    exec.enqueue({ rows: [offerRow()] });
    const result = await clientOffersRepo.create(
      {
        id: 'co-1',
        linkedQuoteId: 'cq-1',
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 5,
        discountType: 'percentage',
        status: 'draft',
        expirationDate: '2026-06-01',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('insert into "customer_offers"');
    expect(exec.calls[0].params).toHaveLength(10);
    expect(exec.calls[0].params[5]).toBe('5'); // discount via numericForDb
    expect(result.id).toBe('co-1');
  });
});

describe('update', () => {
  test('binds 9 patch values via COALESCE, WHERE id last', async () => {
    exec.enqueue({ rows: [offerRow()] });
    await clientOffersRepo.update('co-1', { status: 'accepted' }, testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('update "customer_offers"');
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('CURRENT_TIMESTAMP');
    expect(sql).toContain('"id" = $10');
    expect(exec.calls[0].params).toHaveLength(10);
    expect(exec.calls[0].params[6]).toBe('accepted'); // status
    expect(exec.calls[0].params[9]).toBe('co-1'); // where id
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientOffersRepo.update('co-x', { status: 'accepted' }, testDb)).toBeNull();
  });

  test('numericForDb stringifies discount before COALESCE', async () => {
    exec.enqueue({ rows: [offerRow()] });
    await clientOffersRepo.update('co-1', { discount: 12.5 }, testDb);
    expect(exec.calls[0].params).toContain('12.5');
  });
});

describe('insertItems', () => {
  test('binds 15 fields per row in column order, with numericForDb on numerics', async () => {
    exec.enqueue({ rows: [itemRow()] });
    await clientOffersRepo.insertItems(
      'co-1',
      [
        {
          id: 'coi-1',
          productId: 'p-1',
          productName: 'Widget',
          quantity: 2,
          unitPrice: 10,
          productCost: 5,
          productMolPercentage: null,
          discount: 0,
          note: null,
          supplierQuoteId: null,
          supplierQuoteItemId: null,
          supplierQuoteSupplierName: null,
          supplierQuoteUnitPrice: null,
          unitType: 'unit',
        },
      ],
      testDb,
    );
    expect(exec.calls[0].sql).toContain('insert into "customer_offer_items"');
    // Drizzle emits columns in schema declaration order (createdAt is skipped — has
    // CURRENT_TIMESTAMP default and isn't passed), so unitType lands between note and the
    // supplier_quote_* group rather than at the end of the values list.
    expect(exec.calls[0].params).toEqual([
      'coi-1',
      'co-1',
      'p-1',
      'Widget',
      '2',
      '10',
      '5',
      null,
      '0',
      null,
      'unit',
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT and preserves order', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [itemRow({ 0: 'a' }), itemRow({ 0: 'b' })],
    });
    const items: clientOffersRepo.NewClientOfferItem[] = [
      {
        id: 'a',
        productId: 'p-1',
        productName: 'A',
        quantity: 1,
        unitPrice: 5,
        productCost: 2,
        productMolPercentage: null,
        discount: 0,
        note: null,
        supplierQuoteId: null,
        supplierQuoteItemId: null,
        supplierQuoteSupplierName: null,
        supplierQuoteUnitPrice: null,
        unitType: 'unit',
      },
      {
        id: 'b',
        productId: null,
        productName: 'B',
        quantity: 2,
        unitPrice: 6,
        productCost: 3,
        productMolPercentage: null,
        discount: 1,
        note: null,
        supplierQuoteId: null,
        supplierQuoteItemId: null,
        supplierQuoteSupplierName: null,
        supplierQuoteUnitPrice: null,
        unitType: 'hours',
      },
    ];
    const result = await clientOffersRepo.replaceItems('co-1', items, testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('delete from "customer_offer_items"');
    expect(exec.calls[1].sql).toContain('insert into "customer_offer_items"');
    expect(exec.calls[1].params[0]).toBe('a');
    expect(exec.calls[1].params[15]).toBe('b'); // 15 fields per row, second row starts at index 15
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('with empty items skips the INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await clientOffersRepo.replaceItems('co-1', [], testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('delete from');
    expect(result).toEqual([]);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await clientOffersRepo.deleteById('co-1', testDb)).toBe(true);
  });

  test('returns false when no row matched', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await clientOffersRepo.deleteById('co-x', testDb)).toBe(false);
  });
});

describe('mapOffer (exercised via create return path)', () => {
  const baseInput: clientOffersRepo.NewClientOffer = {
    id: 'co-1',
    linkedQuoteId: 'cq-1',
    clientId: 'c-1',
    clientName: 'Acme',
    paymentTerms: 'net30',
    discount: 5,
    discountType: 'percentage',
    status: 'draft',
    expirationDate: '2026-06-01',
    notes: null,
  };

  test('numeric-string discount is parsed to number', async () => {
    exec.enqueue({ rows: [offerRow({ 5: '12.5' })] });
    const result = await clientOffersRepo.create(baseInput, testDb);
    expect(result.discount).toBe(12.5);
  });

  test('unknown discountType falls back to percentage', async () => {
    exec.enqueue({ rows: [offerRow({ 6: 'mystery' })] });
    const result = await clientOffersRepo.create(baseInput, testDb);
    expect(result.discountType).toBe('percentage');
  });

  test('null createdAt/updatedAt fall back to 0', async () => {
    exec.enqueue({ rows: [offerRow({ 10: null, 11: null })] });
    const result = await clientOffersRepo.create(baseInput, testDb);
    expect(result.createdAt).toBe(0);
    expect(result.updatedAt).toBe(0);
  });
});

describe('mapItem (exercised via insertItems return path)', () => {
  const baseItem: clientOffersRepo.NewClientOfferItem = {
    id: 'coi-1',
    productId: 'p-1',
    productName: 'Widget',
    quantity: 2,
    unitPrice: 10,
    productCost: 5,
    productMolPercentage: null,
    discount: 0,
    note: null,
    supplierQuoteId: null,
    supplierQuoteItemId: null,
    supplierQuoteSupplierName: null,
    supplierQuoteUnitPrice: null,
    unitType: 'unit',
  };

  test('null productMolPercentage stays null (not coerced to 0)', async () => {
    exec.enqueue({ rows: [itemRow({ 7: null })] });
    const [result] = await clientOffersRepo.insertItems('co-1', [baseItem], testDb);
    expect(result.productMolPercentage).toBeNull();
  });

  test('numeric-string productMolPercentage is parsed to number', async () => {
    exec.enqueue({ rows: [itemRow({ 7: '12.5' })] });
    const [result] = await clientOffersRepo.insertItems('co-1', [baseItem], testDb);
    expect(result.productMolPercentage).toBe(12.5);
  });

  test('null unitType normalizes to default "hours"', async () => {
    exec.enqueue({ rows: [itemRow({ 11: null })] });
    const [result] = await clientOffersRepo.insertItems('co-1', [baseItem], testDb);
    expect(result.unitType).toBe('hours');
  });
});
