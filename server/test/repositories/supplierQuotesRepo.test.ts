import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as supplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Builder fixtures match the column order in db/schema/supplierQuotes.ts:
//   [id, supplierId, supplierName, clientId, clientName, paymentTerms, status,
//    expirationDate, notes, createdAt, updatedAt]
// `listAll` adds the linkedOrderId correlated subquery as a 12th projection column.
const QUOTE_BASE: readonly unknown[] = [
  'q-1',
  's-1',
  'Acme',
  null,
  null,
  'net30',
  'draft',
  '2026-06-01',
  null,
  new Date(1735689600000),
  new Date(1735689700000),
];

const quoteRow = (overrides: Record<number, unknown> = {}) => makeRow(QUOTE_BASE, overrides);

// listAll's projection appends linkedOrderId (11), then the reverse-lookup linkedClientQuoteId
// (12) and linkedClientQuoteStatus (13) for the linking client quote (issue #779).
const QUOTE_LIST_BASE: readonly unknown[] = [...QUOTE_BASE, null, null, null];

const quoteListRow = (overrides: Record<number, unknown> = {}) =>
  makeRow(QUOTE_LIST_BASE, overrides);

// Column order in db/schema/supplierQuotes.ts (supplier_quote_items):
//   [id, quoteId, productId, productName, quantity, unitPrice, note, createdAt, unitType,
//    listPrice, discountPercent, durationMonths, durationUnit]
const ITEM_BASE: readonly unknown[] = [
  'sqi-1',
  'q-1',
  null,
  'Widget',
  '2',
  '10.5',
  null,
  new Date(1735689600000),
  'unit',
  '21',
  '50',
  1,
  'months',
];

const itemRow = (overrides: Record<number, unknown> = {}) => makeRow(ITEM_BASE, overrides);

describe('listAll', () => {
  test('issues a query with linkedOrderId correlated subquery', async () => {
    exec.enqueue({ rows: [quoteListRow({ 11: 'so-1' })] });
    const result = await supplierQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('FROM supplier_sales');
    expect(sql).toContain('ss.linked_quote_id');
    expect(sql).toContain('order by "supplier_quotes"."created_at" desc');
    expect(result[0].linkedOrderId).toBe('so-1');
    expect(result[0].expirationDate).toBe('2026-06-01');
  });

  test('resolves the linking client quote id and status via line-sourcing reverse lookup', async () => {
    exec.enqueue({ rows: [quoteListRow({ 12: 'cq-7', 13: 'sent' })] });
    const result = await supplierQuotesRepo.listAll(testDb);
    // The link is now resolved through product-line sourcing, not a header column (issue #779
    // follow-up): the supplier quote follows the client quote whose quote_items source it.
    expect(exec.calls[0].sql).toContain('qi.supplier_quote_id = "supplier_quotes"."id"');
    expect(result[0].linkedClientQuoteId).toBe('cq-7');
    expect(result[0].linkedClientQuoteStatus).toBe('sent');
  });

  test('returns empty array when no rows', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.listAll(testDb)).toEqual([]);
  });

  test('correlated subqueries qualify the outer supplier_quotes.id (no ambiguous bare "id")', async () => {
    // The list query is join-less, so a bare `${supplierQuotes.id}` would render as "id" and
    // resolve against the subquery's own inner table (silent mis-correlation, or an ambiguity
    // abort in the JOIN subqueries). Every correlation must reference the qualified outer column.
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('ss.linked_quote_id = "supplier_quotes"."id"');
    expect(sql).toContain('qi.supplier_quote_id = "supplier_quotes"."id"');
    expect(sql).not.toMatch(/supplier_quote_id = "id"/);
  });

  test('resolves the chosen client quote ONCE via a LATERAL join, not 5x inlined subqueries', async () => {
    // Perf guard (PR #812 follow-up): the chosen-quote ranking used to be inlined into every
    // derived column (linkedClientQuoteId + 4 dependent subqueries), so Postgres re-ran the ranked
    // quote_items scan 5x per row. The LATERAL join evaluates it once; the ranking CASE must now
    // appear exactly once in the rendered SQL, and the offer fields come from a join, not subqueries.
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('left join lateral');
    expect(sql).toContain('"chosen_offer"."linked_quote_id" = "chosen"."id"');
    expect((sql.match(/when 'accepted' then 5/g) ?? []).length).toBe(1);
  });
});

describe('listAllItems', () => {
  test('orders items by created_at ASC', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierQuotesRepo.listAllItems(testDb);
    expect(exec.calls[0].sql).toContain('order by "supplier_quote_items"."created_at" asc');
    expect(result[0].quantity).toBe(2);
    expect(result[0].unitPrice).toBe(10.5);
    expect(result[0].listPrice).toBe(21);
    expect(result[0].discountPercent).toBe(50);
    expect(result[0].unitType).toBe('unit');
  });

  test('coerces unitType null to "unit"', async () => {
    exec.enqueue({ rows: [itemRow({ 8: null })] });
    const result = await supplierQuotesRepo.listAllItems(testDb);
    expect(result[0].unitType).toBe('unit');
  });

  test('maps the duration columns (issue #776)', async () => {
    exec.enqueue({ rows: [itemRow({ 11: 18, 12: 'years' })] });
    const result = await supplierQuotesRepo.listAllItems(testDb);
    expect(result[0].durationMonths).toBe(18);
    expect(result[0].durationUnit).toBe('years');
  });

  test('defaults a null/legacy duration to one month (issue #776)', async () => {
    exec.enqueue({ rows: [itemRow({ 11: null, 12: null })] });
    const result = await supplierQuotesRepo.listAllItems(testDb);
    expect(result[0].durationMonths).toBe(1);
    expect(result[0].durationUnit).toBe('months');
  });
});

describe('findLinkedOrderId', () => {
  test('returns id when found', async () => {
    exec.enqueue({ rows: [['so-1']] });
    expect(await supplierQuotesRepo.findLinkedOrderId('q-1', testDb)).toBe('so-1');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.findLinkedOrderId('q-x', testDb)).toBeNull();
  });
});

describe('isSourcedByClientDocuments', () => {
  // Three parallel probes in call order: quote_items, customer_offer_items, sale_items — each
  // matching either the denormalized supplier_quote_id or (legacy rows) the item-id subquery.
  test('true when any client line references the quote', async () => {
    exec.enqueue({ rows: [['qi-1']] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.isSourcedByClientDocuments('q-1', testDb)).toBe(true);
    const sqlTexts = exec.calls.map((c) => c.sql.toLowerCase());
    expect(sqlTexts[0]).toContain('"quote_items"');
    expect(sqlTexts[1]).toContain('"customer_offer_items"');
    expect(sqlTexts[2]).toContain('"sale_items"');
    for (const sqlText of sqlTexts) {
      expect(sqlText).toContain('"supplier_quote_id" =');
      expect(sqlText).toContain('"supplier_quote_item_id" in (select');
    }
    expect(exec.calls[0].params).toContain('q-1');
  });

  test('false when nothing references the quote', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.isSourcedByClientDocuments('q-1', testDb)).toBe(false);
  });
});

describe('findIdConflict', () => {
  test('excludes self via <> predicate', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.findIdConflict('new-id', 'cur-id', testDb);
    expect(exec.calls[0].sql).toContain('"id" <> $2');
    expect(exec.calls[0].params).toEqual(['new-id', 'cur-id']);
  });

  test('returns true when row matches', async () => {
    exec.enqueue({ rows: [['new-id']] });
    expect(await supplierQuotesRepo.findIdConflict('new-id', 'cur-id', testDb)).toBe(true);
  });
});

describe('update', () => {
  test('binds patch values via COALESCE, WHERE id last - no id in SET (issue #621)', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    await supplierQuotesRepo.update('q-1', { notes: 'hi' }, testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('update "supplier_quotes"');
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('CURRENT_TIMESTAMP');
    // The SET clause must NOT touch the primary key column.
    expect(sql).not.toMatch(/set[^"]*"id"\s*=/i);
    // Nor the vestigial status column (it still appears in RETURNING): it is fully derived
    // (issue #779) and update() must not offer a path to desync it.
    expect(sql).not.toContain('"status" =');
    expect(sql).toContain('"id" = $6');
    expect(exec.calls[0].params).toHaveLength(6);
    expect(exec.calls[0].params[4]).toBe('hi'); // notes
    expect(exec.calls[0].params[5]).toBe('q-1'); // where id
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.update('q-x', { notes: 'x' }, testDb)).toBeNull();
  });

  test('empty patch falls back to SELECT (no UPDATE issued, updated_at preserved)', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    const result = await supplierQuotesRepo.update('q-1', {}, testDb);
    const sqlText = exec.calls[0].sql.toLowerCase();
    expect(sqlText).not.toContain('update "supplier_quotes"');
    expect(sqlText).toContain('select');
    expect(result?.id).toBe('q-1');
  });
});

describe('rename', () => {
  test('issues a dedicated UPDATE that sets the id column and returns the mapped quote', async () => {
    exec.enqueue({ rows: [quoteRow({ 0: 'q-2' })] });
    const result = await supplierQuotesRepo.rename('q-1', 'q-2', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "supplier_quotes"');
    expect(sql).toMatch(/set[^"]*"id"\s*=/);
    expect(sql).toContain('current_timestamp');
    expect(exec.calls[0].params).toContain('q-2'); // new id
    expect(exec.calls[0].params).toContain('q-1'); // where current id
    expect(result?.id).toBe('q-2');
  });

  test('returns null when no row matched currentId', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.rename('q-x', 'q-y', testDb)).toBeNull();
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT and preserves item order', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [itemRow({ 0: 'sqi-a' }), itemRow({ 0: 'sqi-b' })] });
    const items = [
      {
        id: 'sqi-a',
        productId: null,
        productName: 'A',
        quantity: 1,
        listPrice: 5,
        discountPercent: 0,
        unitPrice: 5,
        note: null,
        unitType: 'unit',
        durationMonths: 1,
        durationUnit: 'months' as const,
      },
      {
        id: 'sqi-b',
        productId: null,
        productName: 'B',
        quantity: 2,
        listPrice: 8,
        discountPercent: 25,
        unitPrice: 6,
        note: null,
        unitType: 'unit',
        durationMonths: 1,
        durationUnit: 'months' as const,
      },
    ];
    const result = await supplierQuotesRepo.replaceItems('q-1', items, testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('delete from "supplier_quote_items"');
    expect(exec.calls[0].params).toEqual(['q-1']);
    expect(exec.calls[1].sql).toContain('insert into "supplier_quote_items"');
    expect(exec.calls[1].params[0]).toBe('sqi-a');
    expect(result.map((i) => i.id)).toEqual(['sqi-a', 'sqi-b']);
  });

  test('with empty items, deletes existing and skips INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierQuotesRepo.replaceItems('q-1', [], testDb);
    expect(exec.calls.length).toBe(1);
    expect(exec.calls[0].sql).toContain('delete from');
    expect(result).toEqual([]);
  });

  test('persists a line duration verbatim on insert — no unit-line coercion (issue #775)', async () => {
    exec.enqueue({ rows: [] }); // DELETE
    exec.enqueue({ rows: [itemRow({ 0: 'sqi-x' })] }); // INSERT ... RETURNING
    const items = [
      {
        id: 'sqi-x',
        productId: null,
        productName: 'Widget',
        quantity: 7,
        listPrice: 5,
        discountPercent: 0,
        unitPrice: 5,
        note: null,
        unitType: 'unit',
        // Duration applies to every line type now (issue #775); the repo persists the submitted
        // value/unit unchanged (covers version-restore, which rebuilds items straight from a
        // snapshot). The 'na' unit — not the line's unitType — is what disables the multiplier.
        durationMonths: 5,
        durationUnit: 'years' as const,
      },
    ];
    await supplierQuotesRepo.replaceItems('q-1', items, testDb);
    const insertParams = exec.calls[1].params;
    expect(insertParams).toContain('years');
    expect(insertParams).toContain(5);
  });
});

describe('getQuoteItemSnapshots', () => {
  test('returns empty Map when given no ids without issuing a query', async () => {
    const result = await supplierQuotesRepo.getQuoteItemSnapshots([], testDb);
    expect(result.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  test('deduplicates ids and filters falsy values', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.getQuoteItemSnapshots(['', 'a', 'a', 'b'], testDb);
    // Drizzle inArray expands the array to individual params (a, b after dedup/filter). The
    // effective-accepted predicate inlines 'accepted' / CURRENT_DATE, so they are not params.
    expect(exec.calls[0].params).toEqual(['a', 'b']);
  });

  test('does not gate on status (#779 derived model): any existing item resolves', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.getQuoteItemSnapshots(['a'], testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"supplier_quotes"');
    expect(sql).toContain('inner join');
    // Supplier quotes start as draft and progress only with the client document that uses
    // them, so sourcing must work from any extant quote — no status predicate.
    expect(sql).not.toContain("= 'accepted'");
    expect(exec.calls[0].params).toEqual(['a']);
  });

  test('maps row fields into snapshot shape with netCost mirroring unitPrice', async () => {
    exec.enqueue({ rows: [['sqi-1', 'sq-1', 'Acme', 'p-1', '12.5']] });
    const result = await supplierQuotesRepo.getQuoteItemSnapshots(['sqi-1'], testDb);
    expect(result.get('sqi-1')).toEqual({
      supplierQuoteId: 'sq-1',
      supplierName: 'Acme',
      productId: 'p-1',
      unitPrice: 12.5,
      netCost: 12.5,
    });
  });
});

describe('deleteById', () => {
  test('returns supplierName when row deleted', async () => {
    exec.enqueue({ rows: [['Acme']] });
    expect(await supplierQuotesRepo.deleteById('q-1', testDb)).toEqual({ supplierName: 'Acme' });
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.deleteById('q-x', testDb)).toBeNull();
  });
});

describe('existsById', () => {
  test('returns true when matching row exists', async () => {
    exec.enqueue({ rows: [['q-1']] });
    expect(await supplierQuotesRepo.existsById('q-1', testDb)).toBe(true);
  });

  test('returns false when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.existsById('q-x', testDb)).toBe(false);
  });
});

describe('lockEffectiveStatusById', () => {
  test('locks the row and resolves expiration and the full linked chain', async () => {
    exec.enqueue({ rows: [['2999-06-01', 'accepted', '2999-12-31', null, null]] });
    const result = await supplierQuotesRepo.lockEffectiveStatusById('q-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('for update');
    // The linked chain is resolved through line-sourcing (issue #779 follow-up).
    expect(exec.calls[0].sql).toContain('qi.supplier_quote_id = "supplier_quotes"."id"');
    expect(result).toEqual({
      expirationDate: '2999-06-01',
      linkedClientStatus: 'accepted',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: null,
      linkedOfferExpiration: null,
    });
  });

  test('returns null linked fields when unlinked', async () => {
    exec.enqueue({ rows: [['2999-06-01', null, null, null, null]] });
    const result = await supplierQuotesRepo.lockEffectiveStatusById('q-1', testDb);
    expect(result?.linkedClientStatus).toBeNull();
    expect(result?.linkedOfferStatus).toBeNull();
  });

  test('returns null when row missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.lockEffectiveStatusById('q-x', testDb)).toBeNull();
  });
});

describe('findItemsByIds', () => {
  test('returns [] without querying when no ids are given', async () => {
    expect(await supplierQuotesRepo.findItemsByIds([], testDb)).toEqual([]);
    expect(exec.calls).toHaveLength(0);
  });

  test('selects items by id list and maps them', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierQuotesRepo.findItemsByIds(['sqi-1'], testDb);
    expect(exec.calls[0].sql).toContain('from "supplier_quote_items"');
    expect(result[0].id).toBe('sqi-1');
  });
});

describe('syncItemPricing', () => {
  test('writes quantity + unit cost, recomputes list price keeping the discount, touches the quote', async () => {
    exec.enqueue({ rows: [] }); // item update
    exec.enqueue({ rows: [] }); // parent updated_at bump
    await supplierQuotesRepo.syncItemPricing(
      'q-1',
      [{ itemId: 'sqi-1', quantity: 3, unitCost: 80, discountPercent: 20 }],
      testDb,
    );
    const itemSql = exec.calls[0].sql.toLowerCase();
    expect(itemSql).toContain('update "supplier_quote_items"');
    // listPrice = 80 / (1 − 20/100) = 100, so listPrice × (1 − discount) keeps equaling the cost.
    expect(exec.calls[0].params).toEqual(expect.arrayContaining(['3', '80', '100', '20', 'sqi-1']));
    expect(exec.calls[1].sql.toLowerCase()).toContain('update "supplier_quotes"');
    expect(exec.calls[1].params).toContain('q-1');
  });

  test('a 100% discount cannot express a non-zero cost: resets to 0 with listPrice = cost', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.syncItemPricing(
      'q-1',
      [{ itemId: 'sqi-1', quantity: 1, unitCost: 50, discountPercent: 100 }],
      testDb,
    );
    expect(exec.calls[0].params).toEqual(expect.arrayContaining(['50', '0', 'sqi-1']));
  });
});

describe('findItemsForQuote', () => {
  test('selects items filtered by quoteId and maps them', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierQuotesRepo.findItemsForQuote('q-1', testDb);
    expect(exec.calls[0].sql).toContain('from "supplier_quote_items"');
    expect(exec.calls[0].params).toContain('q-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sqi-1');
  });

  test('orders rows deterministically by created_at then id', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.findItemsForQuote('q-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('order by');
    expect(sql).toMatch(/"created_at".*,.*"id"/);
  });
});

describe('findFullForSnapshot', () => {
  test('returns quote and items when quote exists', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierQuotesRepo.findFullForSnapshot('q-1', testDb);
    expect(result).not.toBeNull();
    expect(result?.quote.id).toBe('q-1');
    expect(result?.items).toHaveLength(1);
  });

  test('returns null when quote not found', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.findFullForSnapshot('q-x', testDb)).toBeNull();
  });
});

describe('create', () => {
  test('inserts and returns mapped quote', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    const result = await supplierQuotesRepo.create(
      {
        id: 'q-1',
        supplierId: 's-1',
        supplierName: 'Acme',
        clientId: null,
        clientName: null,
        paymentTerms: 'net30',
        status: 'draft',
        expirationDate: '2026-06-01',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('insert into "supplier_quotes"');
    expect(exec.calls[0].params).toContain('q-1');
    expect(exec.calls[0].params).toContain('Acme');
    expect(exec.calls[0].params).toContain('2026-06-01');
    expect(result.id).toBe('q-1');
  });

  test('persists the optional client link when provided', async () => {
    exec.enqueue({ rows: [quoteRow({ 3: 'c-1', 4: 'Globex' })] });
    const result = await supplierQuotesRepo.create(
      {
        id: 'q-1',
        supplierId: 's-1',
        supplierName: 'Acme',
        clientId: 'c-1',
        clientName: 'Globex',
        paymentTerms: 'net30',
        status: 'draft',
        expirationDate: '2026-06-01',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].params).toContain('c-1');
    expect(exec.calls[0].params).toContain('Globex');
    expect(result.clientId).toBe('c-1');
    expect(result.clientName).toBe('Globex');
  });
});

describe('restoreSnapshotQuote', () => {
  test('updates with snapshot fields and returns mapped quote', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    const result = await supplierQuotesRepo.restoreSnapshotQuote(
      'q-1',
      {
        supplierId: 's-1',
        supplierName: 'Acme',
        clientId: null,
        clientName: null,
        paymentTerms: 'net30',
        status: 'sent',
        expirationDate: '2026-06-01',
        notes: 'restored',
      },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('update "supplier_quotes"');
    expect(exec.calls[0].sql).toContain('CURRENT_TIMESTAMP');
    expect(exec.calls[0].params).toContain('Acme');
    expect(exec.calls[0].params).toContain('sent');
    expect(exec.calls[0].params).toContain('q-1');
    expect(result?.id).toBe('q-1');
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierQuotesRepo.restoreSnapshotQuote(
      'q-x',
      {
        supplierId: 's-1',
        supplierName: 'Acme',
        clientId: null,
        clientName: null,
        paymentTerms: 'net30',
        status: 'draft',
        expirationDate: '2026-06-01',
        notes: null,
      },
      testDb,
    );
    expect(result).toBeNull();
  });
});
