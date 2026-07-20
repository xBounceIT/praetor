import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as clientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// QUOTE_LIST_PROJECTION column order:
// id, linkedOfferId (subquery), clientId, clientName, paymentTerms, discount, discountType,
// status, expirationDate, communicationChannelId, communicationChannelName, notes, createdAt,
// updatedAt
const QUOTE_BASE: readonly unknown[] = [
  'cq-1',
  null,
  'c-1',
  'Acme',
  'net30',
  '10',
  'percentage',
  'draft',
  '2026-06-01',
  'qcc_email',
  'Email',
  null,
  new Date('2026-04-01T00:00:00Z'),
  new Date('2026-04-01T00:01:00Z'),
];
const quoteRow = (overrides: Record<number, unknown> = {}) => makeRow(QUOTE_BASE, overrides);

// quote_items column order (from schema):
// id, quote_id, product_id, product_name, quantity, unit_price, product_cost,
// product_mol_percentage, supplier_quote_id, supplier_quote_item_id,
// supplier_quote_supplier_name, supplier_quote_unit_price, discount, note, unit_type,
// duration_months, duration_unit, created_at, position, candidate_id
const ITEM_BASE: readonly unknown[] = [
  'qi-1',
  'cq-1',
  'p-1',
  'Widget',
  '2',
  '10',
  '5',
  '20',
  null,
  null,
  null,
  null,
  '0',
  null,
  'unit',
  1,
  'months',
  new Date('2026-04-01T00:00:00Z'),
  0,
  null,
];
const itemRow = (overrides: Record<number, unknown> = {}) => makeRow(ITEM_BASE, overrides);

describe('listAll', () => {
  test('embeds the linkedOfferId correlated subquery and orders DESC', async () => {
    exec.enqueue({ rows: [quoteRow({ 1: 'co-1' })] });
    const result = await clientQuotesRepo.listAll(testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('from customer_offers co');
    expect(exec.calls[0].sql.toLowerCase()).toContain('co.linked_quote_id');
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by "quotes"."created_at" desc');
    expect(result[0].linkedOfferId).toBe('co-1');
  });

  test('correlated subqueries qualify the outer quotes.* column, not the inner table', async () => {
    // The list query is join-less, so `${quotes.id}` renders as a BARE "id" that would resolve
    // against the SUBQUERY's own inner table (customer_offers also has an id) — silently matching
    // co.id instead of the outer quote, so linkedOfferId was always null. The correlation must
    // reference the qualified outer column.
    exec.enqueue({ rows: [] });
    await clientQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('co.linked_quote_id = "quotes"."id"');
    // The supplier-expiration lookup is now line-sourced (earliest sourced supplier quote),
    // correlated on the qualified outer quote id (issue #779 follow-up).
    expect(sql).toContain('WHERE qi.quote_id = "quotes"."id"');
    expect(sql).not.toMatch(/co\.linked_quote_id = "id"/);
  });
});

describe('listAllItems', () => {
  test('returns mapped items in persisted position order with deterministic fallbacks', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await clientQuotesRepo.listAllItems(testDb);
    expect(exec.calls[0].sql.toLowerCase()).toMatch(
      /order by.*"quote_id" asc.*"position" asc.*"created_at" asc.*"id" asc/,
    );
    expect(result[0].quantity).toBe(2);
    expect(result[0].productCost).toBe(5);
    expect(result[0].productMolPercentage).toBe(20);
    expect(result[0].durationMonths).toBe(1);
    expect(result[0].durationUnit).toBe('months');
    expect(result[0].candidateId).toBe('cq-1');
    expect(exec.calls[0].sql.toLowerCase()).toContain('coalesce');
    expect(exec.calls[0].sql.toLowerCase()).toContain('from quote_candidates default_candidate');
  });

  test('maps a multi-month duration through to durationMonths', async () => {
    exec.enqueue({ rows: [itemRow({ 15: 12 })] });
    const result = await clientQuotesRepo.listAllItems(testDb);
    expect(result[0].durationMonths).toBe(12);
  });

  test('maps duration_unit through to durationUnit (issue #757)', async () => {
    exec.enqueue({ rows: [itemRow({ 16: 'years' })] });
    const result = await clientQuotesRepo.listAllItems(testDb);
    expect(result[0].durationUnit).toBe('years');
  });

  test('null productMolPercentage stays null in output', async () => {
    exec.enqueue({ rows: [itemRow({ 7: null })] });
    const result = await clientQuotesRepo.listAllItems(testDb);
    expect(result[0].productMolPercentage).toBeNull();
  });
});

describe('existsById / findIdConflict', () => {
  test('existsById returns true on match', async () => {
    exec.enqueue({ rows: [['cq-1']] });
    expect(await clientQuotesRepo.existsById('cq-1', testDb)).toBe(true);
  });

  test('findIdConflict passes both ids in params', async () => {
    exec.enqueue({ rows: [] });
    await clientQuotesRepo.findIdConflict('new', 'cur', testDb);
    expect(exec.calls[0].params).toContain('new');
    expect(exec.calls[0].params).toContain('cur');
  });
});

describe('findCurrent', () => {
  // GATE_PROJECTION order: status, discount, discountType, expirationDate, linkedSupplierQuoteId,
  // linkedSupplierQuoteExpiration (the last is the linked supplier quote's own expiration subquery).
  test('returns parsed status, discount, expiration and link fields', async () => {
    exec.enqueue({ rows: [['sent', '15.5', 'currency', '2026-06-01', null, null]] });
    const result = await clientQuotesRepo.findCurrent('cq-1', testDb);
    expect(result).toEqual({
      status: 'sent',
      discount: 15.5,
      discountType: 'currency',
      expirationDate: '2026-06-01',
      linkedSupplierQuoteId: null,
      linkedSupplierQuoteExpiration: null,
    });
  });

  test('defaults discountType to percentage when null', async () => {
    exec.enqueue({ rows: [['draft', 0, null, '2026-06-01', null, null]] });
    const result = await clientQuotesRepo.findCurrent('cq-1', testDb);
    expect(result?.discountType).toBe('percentage');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.findCurrent('cq-x', testDb)).toBeNull();
  });
});

describe('lockCurrentById', () => {
  test('uses FOR UPDATE in the emitted SQL', async () => {
    exec.enqueue({ rows: [['sent', '0', 'percentage', '2026-06-01', null, null]] });
    await clientQuotesRepo.lockCurrentById('cq-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('for update');
    expect(exec.calls[0].params).toContain('cq-1');
  });

  test('returns parsed row including the linked supplier quote expiration', async () => {
    exec.enqueue({ rows: [['draft', '7.25', 'currency', '2026-07-15', 'sq-9', '2026-05-01']] });
    const result = await clientQuotesRepo.lockCurrentById('cq-1', testDb);
    expect(result).toEqual({
      status: 'draft',
      discount: 7.25,
      discountType: 'currency',
      expirationDate: '2026-07-15',
      linkedSupplierQuoteId: 'sq-9',
      linkedSupplierQuoteExpiration: '2026-05-01',
    });
  });

  test('returns null when row missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.lockCurrentById('cq-x', testDb)).toBeNull();
  });
});

describe('linked-sale guards', () => {
  test('findLinkedOfferId returns id from customer_offers', async () => {
    exec.enqueue({ rows: [['co-1']] });
    expect(await clientQuotesRepo.findLinkedOfferId('cq-1', testDb)).toBe('co-1');
    expect(exec.calls[0].sql.toLowerCase()).toContain('from "customer_offers"');
    expect(exec.calls[0].params).toContain('cq-1');
  });

  test('findNonDraftLinkedSale filters out draft sales', async () => {
    exec.enqueue({ rows: [['s-1']] });
    await clientQuotesRepo.findNonDraftLinkedSale('cq-1', testDb);
    expect(exec.calls[0].params).toContain('cq-1');
    expect(exec.calls[0].params).toContain('draft');
  });

  test('deleteDraftSalesForQuote scopes the delete to draft sales', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });
    await clientQuotesRepo.deleteDraftSalesForQuote('cq-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "sales"');
    expect(exec.calls[0].params).toContain('cq-1');
    expect(exec.calls[0].params).toContain('draft');
  });
});

describe('findItemSnapshotsForQuote', () => {
  test('maps snapshot row fields with parsed numbers and unitType normalization', async () => {
    // Projected columns in order:
    // id, candidateId, productId, quantity, productCost, productMolPercentage, supplierQuoteId,
    // supplierQuoteItemId, supplierQuoteSupplierName, supplierQuoteUnitPrice, unitType
    exec.enqueue({
      rows: [['qi-1', 'qc-1', 'p-1', '3', '5', '20', null, null, null, null, null]],
    });
    const result = await clientQuotesRepo.findItemSnapshotsForQuote('cq-1', testDb);
    expect(result[0]).toEqual({
      id: 'qi-1',
      candidateId: 'qc-1',
      productId: 'p-1',
      quantity: 3,
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
  test('returns parsed numeric totals including durationMonths and durationUnit', async () => {
    exec.enqueue({
      rows: [
        ['2', '10', '5', 12, 'years'],
        [1, 20, null, null, null],
        [3, 30, 0, 6, 'na'],
      ],
    });
    const result = await clientQuotesRepo.findItemTotals('cq-1', testDb);
    expect(result).toEqual([
      { quantity: 2, unitPrice: 10, discount: 5, durationMonths: 12, durationUnit: 'years' },
      // null duration_unit normalizes to 'months'
      { quantity: 1, unitPrice: 20, discount: 0, durationMonths: 1, durationUnit: 'months' },
      // 'na' (N/A) is carried through so the quote-total gate can skip the duration multiplier
      { quantity: 3, unitPrice: 30, discount: 0, durationMonths: 6, durationUnit: 'na' },
    ]);
  });
});

describe('create', () => {
  test('inserts and returns mapped quote', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    const result = await clientQuotesRepo.create(
      {
        id: 'cq-1',
        description: 'Annual support quote',
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 10,
        discountType: 'percentage',
        status: 'draft',
        expirationDate: '2026-06-01',
        communicationChannelId: 'qcc_email',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "quotes"');
    expect(exec.calls[0].params).toContain('Annual support quote');
    expect(result.id).toBe('cq-1');
    expect(result.discount).toBe(10);
  });
});

describe('update', () => {
  test('uses COALESCE-per-column and includes id in WHERE', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    await clientQuotesRepo.update('cq-1', { status: 'accepted' }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "quotes"');
    expect(sql).toContain('coalesce');
    expect(exec.calls[0].params).toContain('accepted');
    expect(exec.calls[0].params).toContain('cq-1');
  });

  test('does not include id in the SET clause (issue #621)', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    await clientQuotesRepo.update('cq-1', { status: 'accepted' }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).not.toMatch(/set[^"]*"id"\s*=/);
  });

  test('clears notes when the patch explicitly supplies null', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    await clientQuotesRepo.update('cq-1', { notes: null }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).not.toMatch(/"notes"\s*=\s*coalesce/);
    expect(exec.calls[0].params).toContain(null);
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.update('cq-x', { status: 'accepted' }, testDb)).toBeNull();
  });
});

describe('rename', () => {
  test('issues a dedicated UPDATE that sets the id column and returns the mapped quote', async () => {
    exec.enqueue({ rows: [quoteRow({ 0: 'cq-2' })] });
    const result = await clientQuotesRepo.rename('cq-1', 'cq-2', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "quotes"');
    expect(sql).toMatch(/set[^"]*"id"\s*=/);
    expect(sql).toContain('current_timestamp');
    expect(exec.calls[0].params).toContain('cq-2'); // new id
    expect(exec.calls[0].params).toContain('cq-1'); // current id (WHERE)
    expect(result?.id).toBe('cq-2');
  });

  test('returns null when no row matched currentId', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.rename('cq-x', 'cq-y', testDb)).toBeNull();
  });
});

describe('restoreSnapshotQuote', () => {
  test('sets nullable notes directly instead of COALESCE-keeping the old value', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    await clientQuotesRepo.restoreSnapshotQuote(
      'cq-1',
      {
        description: 'Restored quote description',
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 10,
        discountType: 'percentage',
        status: 'draft',
        expirationDate: '2026-06-01',
        communicationChannelId: 'qcc_email',
        notes: null,
      },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "quotes"');
    expect(sql).not.toContain('coalesce');
    expect(sql.slice(sql.indexOf(' set ') + 5, sql.indexOf(' where '))).toContain('"description"');
    expect(exec.calls[0].params).toContain('Restored quote description');
    expect(exec.calls[0].params).toContain(null);
    expect(exec.calls[0].params).toContain('cq-1');
  });

  test('leaves description untouched when a legacy snapshot omits it', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    await clientQuotesRepo.restoreSnapshotQuote(
      'cq-1',
      {
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 10,
        discountType: 'percentage',
        status: 'draft',
        expirationDate: '2026-06-01',
        communicationChannelId: 'qcc_email',
        notes: null,
      },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    const setClause = sql.slice(sql.indexOf(' set ') + 5, sql.indexOf(' where '));
    expect(setClause).not.toContain('"description"');
  });

  test('returns null when no row is restored', async () => {
    exec.enqueue({ rows: [] });
    const result = await clientQuotesRepo.restoreSnapshotQuote(
      'cq-x',
      {
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 10,
        discountType: 'percentage',
        status: 'draft',
        expirationDate: '2026-06-01',
        communicationChannelId: 'qcc_email',
        notes: null,
      },
      testDb,
    );
    expect(result).toBeNull();
  });
});

describe('replaceItems', () => {
  test('issues DELETE then bulk INSERT and preserves order', async () => {
    exec.enqueue({ rows: [['cq-1']] });
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [itemRow({ 0: 'b', 18: 1 }), itemRow({ 0: 'a', 18: 0 })],
    });
    const items: clientQuotesRepo.NewClientQuoteItem[] = [
      {
        id: 'a',
        position: 0,
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
        durationMonths: 1,
        durationUnit: 'months',
      },
      {
        id: 'b',
        position: 1,
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
        durationMonths: 6,
        durationUnit: 'months',
      },
    ];
    const result = await clientQuotesRepo.replaceItems('cq-1', items, testDb);
    expect(exec.calls).toHaveLength(3);
    expect(exec.calls[0].sql.toLowerCase()).toContain('from "quote_candidates"');
    expect(exec.calls[1].sql.toLowerCase()).toContain('delete from "quote_items"');
    expect(exec.calls[1].sql.toLowerCase()).toContain('"candidate_id" is null');
    expect(exec.calls[2].sql.toLowerCase()).toContain('insert into "quote_items"');
    expect(exec.calls[2].params).toContain('a');
    expect(exec.calls[2].params).toContain('b');
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('with empty items skips the INSERT', async () => {
    exec.enqueue({ rows: [['cq-1']] });
    exec.enqueue({ rows: [] });
    const result = await clientQuotesRepo.replaceItems('cq-1', [], testDb);
    expect(exec.calls).toHaveLength(2);
    expect(result).toEqual([]);
  });

  test('resolves the persisted default candidate id after a quote rename', async () => {
    exec.enqueue({ rows: [['cq-before-rename']] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [itemRow({ 1: 'cq-renamed', 19: 'cq-before-rename' })] });
    const items: clientQuotesRepo.NewClientQuoteItem[] = [
      {
        id: 'qi-1',
        position: 0,
        productId: 'p-1',
        productName: 'Widget',
        quantity: 1,
        unitPrice: 10,
        productCost: 5,
        productMolPercentage: 20,
        discount: 0,
        note: null,
        supplierQuoteId: null,
        supplierQuoteItemId: null,
        supplierQuoteSupplierName: null,
        supplierQuoteUnitPrice: null,
        unitType: 'unit',
        durationMonths: 1,
        durationUnit: 'months',
      },
    ];

    const result = await clientQuotesRepo.replaceItems('cq-renamed', items, testDb);

    expect(exec.calls[0].params).toContain('cq-renamed');
    expect(exec.calls[1].params).toContain('cq-before-rename');
    expect(exec.calls[2].params).toContain('cq-before-rename');
    expect(result[0].candidateId).toBe('cq-before-rename');
  });
});

describe('findItemsForCandidate', () => {
  test('includes expand-phase null rows for the quote default candidate', async () => {
    exec.enqueue({ rows: [itemRow()] });

    const result = await clientQuotesRepo.findItemsForCandidate('cq-1', 'cq-1', testDb);

    expect(exec.calls[0].sql.toLowerCase()).toContain('"candidate_id" is null');
    expect(result[0].candidateId).toBe('cq-1');
  });

  test('maps null rows to the renamed default candidate primary key', async () => {
    exec.enqueue({ rows: [itemRow({ 1: 'cq-renamed', 19: null })] });

    const result = await clientQuotesRepo.findItemsForCandidate(
      'cq-renamed',
      'cq-before-rename',
      testDb,
    );

    expect(exec.calls[0].sql.toLowerCase()).toContain('from quote_candidates default_candidate');
    expect(result[0].candidateId).toBe('cq-before-rename');
  });
});

describe('findStatusAndClientName', () => {
  test('returns status and clientName when found', async () => {
    exec.enqueue({ rows: [['draft', 'Acme', '2999-12-31']] });
    expect(await clientQuotesRepo.findStatusAndClientName('cq-1', testDb)).toEqual({
      status: 'draft',
      clientName: 'Acme',
      expirationDate: '2999-12-31',
    });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.findStatusAndClientName('cq-x', testDb)).toBeNull();
  });
});

describe('findAnyLinkedSale', () => {
  test('returns sale id when found', async () => {
    exec.enqueue({ rows: [['s-1']] });
    expect(await clientQuotesRepo.findAnyLinkedSale('cq-1', testDb)).toBe('s-1');
    expect(exec.calls[0].sql.toLowerCase()).toContain('from "sales"');
    expect(exec.calls[0].params).toContain('cq-1');
  });

  test('returns null when no linked sale', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.findAnyLinkedSale('cq-x', testDb)).toBeNull();
  });
});

describe('findItemsForQuote', () => {
  test('selects items filtered by quoteId and maps them', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await clientQuotesRepo.findItemsForQuote('cq-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('from "quote_items"');
    expect(exec.calls[0].params).toContain('cq-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('qi-1');
  });

  test('orders rows by persisted position before legacy tie-breakers', async () => {
    exec.enqueue({ rows: [] });
    await clientQuotesRepo.findItemsForQuote('cq-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('order by');
    expect(sql).toMatch(/"position" asc.*"created_at" asc.*"id" asc/);
  });
});

describe('findFullForSnapshot', () => {
  test('returns quote and items when quote exists', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    exec.enqueue({ rows: [itemRow()] });
    const result = await clientQuotesRepo.findFullForSnapshot('cq-1', testDb);
    expect(result).not.toBeNull();
    expect(result?.quote.id).toBe('cq-1');
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].id).toBe('qi-1');
  });

  test('returns null when quote not found', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.findFullForSnapshot('cq-x', testDb)).toBeNull();
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await clientQuotesRepo.deleteById('cq-1', testDb)).toBe(true);
  });

  test('returns false when no row matched', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await clientQuotesRepo.deleteById('cq-x', testDb)).toBe(false);
  });
});
