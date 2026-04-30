import { beforeEach, describe, expect, test } from 'bun:test';
import * as clientOffersRepo from '../../repositories/clientOffersRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const offerRow = {
  id: 'co-1',
  linkedQuoteId: 'cq-1',
  clientId: 'c-1',
  clientName: 'Acme',
  paymentTerms: 'net30',
  discount: '5',
  discountType: 'percentage',
  status: 'draft',
  expirationDate: new Date('2026-06-01T00:00:00Z'),
  notes: null,
  createdAt: 1735689600000,
  updatedAt: 1735689700000,
};

const itemRow = {
  id: 'coi-1',
  offerId: 'co-1',
  productId: 'p-1',
  productName: 'Widget',
  quantity: '2',
  unitPrice: '10',
  productCost: '5',
  productMolPercentage: null,
  supplierQuoteId: null,
  supplierQuoteItemId: null,
  supplierQuoteSupplierName: null,
  supplierQuoteUnitPrice: null,
  unitType: 'unit',
  note: null,
  discount: '0',
};

describe('listAll', () => {
  test('orders by created_at DESC and maps types', async () => {
    exec.enqueue({ rows: [offerRow] });
    const result = await clientOffersRepo.listAll(exec);
    expect(exec.calls[0].sql).toContain('FROM customer_offers');
    expect(exec.calls[0].sql).toContain('ORDER BY created_at DESC');
    expect(result[0].discount).toBe(5);
    expect(result[0].expirationDate).toBe('2026-06-01');
  });
});

describe('listAllItems', () => {
  test('orders items by created_at ASC', async () => {
    exec.enqueue({ rows: [itemRow] });
    const result = await clientOffersRepo.listAllItems(exec);
    expect(exec.calls[0].sql).toContain('ORDER BY created_at ASC');
    expect(result[0].quantity).toBe(2);
    expect(result[0].unitPrice).toBe(10);
    expect(result[0].unitType).toBe('unit');
  });
});

describe('existsById / findIdConflict', () => {
  test('existsById returns true on match', async () => {
    exec.enqueue({ rows: [{ id: 'co-1' }] });
    expect(await clientOffersRepo.existsById('co-1', exec)).toBe(true);
  });

  test('findIdConflict excludes self via id <> $2', async () => {
    exec.enqueue({ rows: [] });
    await clientOffersRepo.findIdConflict('new', 'cur', exec);
    expect(exec.calls[0].sql).toContain('id <> $2');
    expect(exec.calls[0].params).toEqual(['new', 'cur']);
  });
});

describe('findForUpdate', () => {
  test('returns existing offer fields needed for permission checks', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'co-1',
          linkedQuoteId: 'cq-1',
          clientId: 'c-1',
          clientName: 'Acme',
          status: 'draft',
        },
      ],
    });
    const result = await clientOffersRepo.findForUpdate('co-1', exec);
    expect(result?.linkedQuoteId).toBe('cq-1');
    expect(result?.status).toBe('draft');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientOffersRepo.findForUpdate('co-x', exec)).toBeNull();
  });
});

describe('findExistingForQuote', () => {
  test('returns offer id when one exists for the quote', async () => {
    exec.enqueue({ rows: [{ id: 'co-1' }] });
    expect(await clientOffersRepo.findExistingForQuote('cq-1', exec)).toBe('co-1');
  });

  test('returns null when none exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientOffersRepo.findExistingForQuote('cq-1', exec)).toBeNull();
  });
});

describe('findLinkedSaleId', () => {
  test('queries sales.linked_offer_id and returns sale id', async () => {
    exec.enqueue({ rows: [{ id: 's-1' }] });
    const result = await clientOffersRepo.findLinkedSaleId('co-1', exec);
    expect(exec.calls[0].sql).toContain('FROM sales WHERE linked_offer_id = $1');
    expect(result).toBe('s-1');
  });
});

describe('create', () => {
  test('inserts 10 fields and returns mapped offer', async () => {
    exec.enqueue({ rows: [offerRow] });
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
      exec,
    );
    expect(exec.calls[0].sql).toContain('INSERT INTO customer_offers');
    expect(exec.calls[0].params).toHaveLength(10);
    expect(result.id).toBe('co-1');
  });
});

describe('update', () => {
  test('passes 10 params and uses COALESCE preservation', async () => {
    exec.enqueue({ rows: [offerRow] });
    await clientOffersRepo.update('co-1', { status: 'accepted' }, exec);
    expect(exec.calls[0].sql).toContain('UPDATE customer_offers');
    expect(exec.calls[0].sql).toContain('updated_at = CURRENT_TIMESTAMP');
    expect(exec.calls[0].params).toHaveLength(10);
    expect(exec.calls[0].params[6]).toBe('accepted'); // status
    expect(exec.calls[0].params[9]).toBe('co-1'); // where id
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientOffersRepo.update('co-x', { status: 'accepted' }, exec)).toBeNull();
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT and preserves order', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [
        { ...itemRow, id: 'a' },
        { ...itemRow, id: 'b' },
      ],
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
    const result = await clientOffersRepo.replaceItems('co-1', items, exec);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM customer_offer_items');
    expect(exec.calls[1].sql).toContain('INSERT INTO customer_offer_items');
    expect(exec.calls[1].sql).toContain(
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15), ($16',
    );
    expect(exec.calls[1].params[0]).toBe('a');
    expect(exec.calls[1].params[15]).toBe('b'); // 15 fields per row, second row starts at $16 = index 15
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('with empty items skips the INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await clientOffersRepo.replaceItems('co-1', [], exec);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('DELETE');
    expect(result).toEqual([]);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await clientOffersRepo.deleteById('co-1', exec)).toBe(true);
  });

  test('returns false when no row matched', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await clientOffersRepo.deleteById('co-x', exec)).toBe(false);
  });
});
