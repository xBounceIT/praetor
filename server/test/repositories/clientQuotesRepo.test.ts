import { beforeEach, describe, expect, test } from 'bun:test';
import * as clientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const quoteRow = {
  id: 'cq-1',
  linkedOfferId: null,
  clientId: 'c-1',
  clientName: 'Acme',
  paymentTerms: 'net30',
  discount: '10',
  discountType: 'percentage',
  status: 'draft',
  expirationDate: new Date('2026-06-01T00:00:00Z'),
  notes: null,
  createdAt: 1735689600000,
  updatedAt: 1735689700000,
};

const itemRow = {
  id: 'qi-1',
  quoteId: 'cq-1',
  productId: 'p-1',
  productName: 'Widget',
  quantity: '2',
  unitPrice: '10',
  productCost: '5',
  productMolPercentage: '20',
  supplierQuoteId: null,
  supplierQuoteItemId: null,
  supplierQuoteSupplierName: null,
  supplierQuoteUnitPrice: null,
  discount: '0',
  note: null,
  unitType: 'unit',
};

describe('listAll', () => {
  test('embeds the linkedOfferId correlated subquery and orders DESC', async () => {
    exec.enqueue({ rows: [{ ...quoteRow, linkedOfferId: 'co-1' }] });
    const result = await clientQuotesRepo.listAll(exec);
    expect(exec.calls[0].sql).toContain('FROM customer_offers co');
    expect(exec.calls[0].sql).toContain('co.linked_quote_id = quotes.id');
    expect(exec.calls[0].sql).toContain('ORDER BY created_at DESC');
    expect(result[0].linkedOfferId).toBe('co-1');
  });
});

describe('listAllItems', () => {
  test('returns mapped items in created_at ASC order', async () => {
    exec.enqueue({ rows: [itemRow] });
    const result = await clientQuotesRepo.listAllItems(exec);
    expect(exec.calls[0].sql).toContain('ORDER BY created_at ASC');
    expect(result[0].quantity).toBe(2);
    expect(result[0].productCost).toBe(5);
    expect(result[0].productMolPercentage).toBe(20);
  });

  test('null productMolPercentage stays null in output', async () => {
    exec.enqueue({ rows: [{ ...itemRow, productMolPercentage: null }] });
    const result = await clientQuotesRepo.listAllItems(exec);
    expect(result[0].productMolPercentage).toBeNull();
  });
});

describe('existsById / findIdConflict', () => {
  test('existsById returns true on match', async () => {
    exec.enqueue({ rows: [{ id: 'cq-1' }] });
    expect(await clientQuotesRepo.existsById('cq-1', exec)).toBe(true);
  });

  test('findIdConflict excludes self via id <> $2', async () => {
    exec.enqueue({ rows: [] });
    await clientQuotesRepo.findIdConflict('new', 'cur', exec);
    expect(exec.calls[0].sql).toContain('id <> $2');
  });
});

describe('findCurrentForUpdate', () => {
  test('returns parsed status and discount fields', async () => {
    exec.enqueue({
      rows: [{ status: 'sent', discount: '15.5', discount_type: 'currency' }],
    });
    const result = await clientQuotesRepo.findCurrentForUpdate('cq-1', exec);
    expect(result).toEqual({ status: 'sent', discount: 15.5, discountType: 'currency' });
  });

  test('defaults discountType to percentage when null', async () => {
    exec.enqueue({ rows: [{ status: 'draft', discount: 0, discount_type: null }] });
    const result = await clientQuotesRepo.findCurrentForUpdate('cq-1', exec);
    expect(result?.discountType).toBe('percentage');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.findCurrentForUpdate('cq-x', exec)).toBeNull();
  });
});

describe('linked-sale guards', () => {
  test('findLinkedOfferId returns id from customer_offers', async () => {
    exec.enqueue({ rows: [{ id: 'co-1' }] });
    expect(await clientQuotesRepo.findLinkedOfferId('cq-1', exec)).toBe('co-1');
    expect(exec.calls[0].sql).toContain('FROM customer_offers WHERE linked_quote_id = $1');
  });

  test('findNonDraftLinkedSale uses status <> "draft"', async () => {
    exec.enqueue({ rows: [{ id: 's-1' }] });
    await clientQuotesRepo.findNonDraftLinkedSale('cq-1', exec);
    expect(exec.calls[0].sql).toContain('status <> $2');
    expect(exec.calls[0].params).toEqual(['cq-1', 'draft']);
  });

  test('deleteDraftSalesForQuote scopes the delete to draft sales', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });
    await clientQuotesRepo.deleteDraftSalesForQuote('cq-1', exec);
    expect(exec.calls[0].sql).toContain('DELETE FROM sales');
    expect(exec.calls[0].sql).toContain('linked_quote_id = $1 AND status = $2');
    expect(exec.calls[0].params).toEqual(['cq-1', 'draft']);
  });
});

describe('findItemSnapshotsForQuote', () => {
  test('maps snapshot row fields with parsed numbers and unitType normalization', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'qi-1',
          productId: 'p-1',
          productCost: '5',
          productMolPercentage: '20',
          supplierQuoteId: null,
          supplierQuoteItemId: null,
          supplierQuoteSupplierName: null,
          supplierQuoteUnitPrice: null,
          unitType: null,
        },
      ],
    });
    const result = await clientQuotesRepo.findItemSnapshotsForQuote('cq-1', exec);
    expect(result[0]).toEqual({
      id: 'qi-1',
      productId: 'p-1',
      productCost: 5,
      productMolPercentage: 20,
      supplierQuoteId: null,
      supplierQuoteItemId: null,
      supplierQuoteSupplierName: null,
      supplierQuoteUnitPrice: null,
      unitType: 'hours', // null normalized to "hours" by normalizeUnitType
    });
  });
});

describe('findItemTotals', () => {
  test('returns parsed numeric totals', async () => {
    exec.enqueue({
      rows: [
        { quantity: '2', unitPrice: '10', discount: '5' },
        { quantity: 1, unitPrice: 20, discount: null },
      ],
    });
    const result = await clientQuotesRepo.findItemTotals('cq-1', exec);
    expect(result).toEqual([
      { quantity: 2, unitPrice: 10, discount: 5 },
      { quantity: 1, unitPrice: 20, discount: 0 },
    ]);
  });
});

describe('create', () => {
  test('inserts 9 fields and returns mapped quote', async () => {
    exec.enqueue({ rows: [quoteRow] });
    const result = await clientQuotesRepo.create(
      {
        id: 'cq-1',
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 10,
        discountType: 'percentage',
        status: 'draft',
        expirationDate: '2026-06-01',
        notes: null,
      },
      exec,
    );
    expect(exec.calls[0].sql).toContain('INSERT INTO quotes');
    expect(exec.calls[0].params).toHaveLength(9);
    expect(result.id).toBe('cq-1');
    expect(result.discount).toBe(10);
  });
});

describe('update', () => {
  test('passes 10 params and uses COALESCE preservation', async () => {
    exec.enqueue({ rows: [quoteRow] });
    await clientQuotesRepo.update('cq-1', { status: 'accepted' }, exec);
    expect(exec.calls[0].sql).toContain('UPDATE quotes');
    expect(exec.calls[0].params).toHaveLength(10);
    expect(exec.calls[0].params[6]).toBe('accepted');
    expect(exec.calls[0].params[9]).toBe('cq-1');
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.update('cq-x', { status: 'accepted' }, exec)).toBeNull();
  });
});

describe('replaceItems', () => {
  test('issues DELETE then bulk INSERT with 15 fields per row', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [
        { ...itemRow, id: 'a' },
        { ...itemRow, id: 'b' },
      ],
    });
    const items: clientQuotesRepo.NewClientQuoteItem[] = [
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
        productMolPercentage: 25,
        discount: 1,
        note: 'note-b',
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
        supplierQuoteSupplierName: 'Vendor',
        supplierQuoteUnitPrice: 4,
        unitType: 'hours',
      },
    ];
    const result = await clientQuotesRepo.replaceItems('cq-1', items, exec);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM quote_items');
    expect(exec.calls[1].sql).toContain('INSERT INTO quote_items');
    expect(exec.calls[1].params).toHaveLength(30); // 2 * 15
    expect(exec.calls[1].params[0]).toBe('a');
    expect(exec.calls[1].params[15]).toBe('b');
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('with empty items skips the INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await clientQuotesRepo.replaceItems('cq-1', [], exec);
    expect(exec.calls).toHaveLength(1);
    expect(result).toEqual([]);
  });
});
