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
//    expirationDate, communicationChannelId, notes, createdAt, updatedAt, communicationChannelName]
// `listAll` adds the linkedOrderId correlated subquery after communicationChannelName.
const QUOTE_BASE: readonly unknown[] = [
  'q-1',
  's-1',
  'Acme',
  null,
  null,
  'net30',
  'draft',
  '2026-06-01',
  'qcc_email',
  null,
  new Date(1735689600000),
  new Date(1735689700000),
  'Email',
];

const quoteRow = (overrides: Record<number, unknown> = {}) => makeRow(QUOTE_BASE, overrides);

// listAll's projection appends linkedOrderId (13), then the reverse-lookup
// linkedClientQuoteId/status/expiration and linked offer status/expiration (14-18).
const QUOTE_LIST_BASE: readonly unknown[] = [...QUOTE_BASE, null, null, null, null, null, null];

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
    exec.enqueue({ rows: [quoteListRow({ 13: 'so-1' })] });
    const result = await supplierQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('FROM supplier_sales');
    expect(sql).toContain('ss.linked_quote_id');
    expect(sql).toContain('order by "supplier_quotes"."created_at" desc');
    expect(result[0].linkedOrderId).toBe('so-1');
    expect(result[0].expirationDate).toBe('2026-06-01');
  });

  test('resolves the linking client quote id and status via line-sourcing reverse lookup', async () => {
    exec.enqueue({ rows: [quoteListRow({ 14: 'cq-7', 15: 'sent' })] });
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
    expect(
      (sql.match(/when co\.status in \('accepted', 'confirmed', 'approved'\) then 6/g) ?? [])
        .length,
    ).toBe(1);
  });

  test('ranks sourcing candidates by the CHAINED effective status, offer included', async () => {
    // Multi-quote sourcing (PR #812 round 9): the projection follows the chosen quote's OFFER, so
    // the rank must too — on raw cq.status an accepted quote whose offer is denied/expired (a dead
    // chain) would outrank a live sent quote and wrongly freeze the supplier quote. The rank joins
    // each candidate's offer and applies terminal-first / expiration-overlay before the live
    // pipeline; dead-ends (denied, expired) rank below every live state.
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    // The candidate's own offer is joined inside the ranked subquery for the rank to read.
    expect(sql).toContain('left join customer_offers co on co.linked_quote_id = cq.id');
    // Offer branch: terminal first, then offer expiration, else a live offer chain ranks 5.
    expect(sql).toContain("when co.status in ('denied', 'rejected') then 1");
    expect(sql).toContain('when co.expiration_date < current_date then 2');
    // Quote branch fallback for offer-less candidates still ranks the quote pipeline.
    expect(sql).toContain("when cq.status in ('sent', 'received') then 4");
    expect(sql).toContain(
      'when coalesce("sourcing_candidate"."expiration_date", cq.expiration_date) < current_date then 2',
    );
  });

  test('offer-only sourced lines count as sourcing candidates (#812 round 16)', async () => {
    // An offer can add a fresh sourced line that exists only in customer_offer_items; the
    // candidate predicate maps it back to the offer's linked quote so the supplier quote stops
    // projecting unlinked draft (and sourceable) and follows the offer chain.
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('join customer_offer_items coi on coi.offer_id = co2.id');
    expect(sql).toContain('co2.linked_quote_id = cq.id');
    expect(sql).toContain('coi.supplier_quote_id = "supplier_quotes"."id"');
  });

  test('legacy item-only sourced lines count as candidates too (#812 round 18)', async () => {
    // Mirrors isSourcedByClientDocuments: rows that carry only supplier_quote_item_id (null
    // denormalized supplier_quote_id) still source the quote via item membership.
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('qi.supplier_quote_item_id in (');
    expect(sql).toContain(
      'select sqi.id from supplier_quote_items sqi where sqi.quote_id = "supplier_quotes"."id"',
    );
    expect(sql).toContain(
      'coi.supplier_quote_item_id in (\n          select sqi.id from supplier_quote_items sqi where sqi.quote_id = "supplier_quotes"."id"',
    );
  });

  test('expand-phase null candidate rows resolve through the quote default candidate', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('qcand.id = coalesce(\n    qi.candidate_id');
    expect(sql).toContain('from quote_candidates default_candidate');
    expect(sql).toContain('default_candidate.quote_id = qi.quote_id');
    expect(sql).toContain('order by default_candidate.position, default_candidate.id');
  });

  test('uses the sourcing candidates expiration instead of the mirrored parent date', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql.toLowerCase();

    expect(sql).toContain('select max(qcand.expiration_date) as expiration_date');
    expect(sql).toContain("qcand.state <> 'discarded'");
    expect(sql).toContain(
      'coalesce(\n  "sourcing_candidate"."expiration_date",\n  cq.expiration_date\n) as expiration_date',
    );
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

describe('findBlockingExpirationsByIds / findEarliestExpirationByIds', () => {
  // Row shape mirrors the select order: [id, expirationDate, linkedClientQuoteStatus,
  // linkedClientQuoteExpiration, linkedOfferStatus, linkedOfferExpiration]. The terminal-exclusion
  // runs in JS via the canonical effectiveSupplierQuoteStatusFromDate, so it is behavior-testable.
  test('excludes terminal-effective supplier quotes from the earliest-blocking date (#812)', async () => {
    // sq A derives accepted through another accepted client document → frozen, never expired; its
    // past date must NOT block. sq B's chain is live (sent) → its past date blocks.
    exec.enqueue({
      rows: [
        ['sq-a', '2000-01-02', 'accepted', null, null, null],
        ['sq-b', '2000-01-05', 'sent', '2999-12-31', null, null],
      ],
    });
    expect(await supplierQuotesRepo.findEarliestExpirationByIds(['sq-a', 'sq-b'], testDb)).toBe(
      '2000-01-05',
    );
    // The per-id read resolves the chain (quotes + offer subqueries), not a raw MIN.
    const sqlText = exec.calls[0].sql.toLowerCase();
    expect(sqlText).not.toContain('min(');
    expect(sqlText).toContain('o.linked_quote_id');
  });

  test('maps only the effectively-expirable ids (the list flag reads this per quote)', async () => {
    exec.enqueue({
      rows: [
        ['sq-a', '2000-01-02', 'accepted', null, null, null],
        ['sq-b', '2000-01-05', 'sent', '2999-12-31', null, null],
      ],
    });
    const blocking = await supplierQuotesRepo.findBlockingExpirationsByIds(
      ['sq-a', 'sq-b'],
      testDb,
    );
    expect(blocking.get('sq-a')).toBeUndefined();
    expect(blocking.get('sq-b')).toBe('2000-01-05');
  });

  test('returns null when every sourced supplier quote is terminal-effective', async () => {
    // Legacy accepted spelling on the quote chain; the other chain ends in a denied offer.
    exec.enqueue({
      rows: [
        ['sq-a', '2000-01-02', 'confirmed', null, null, null],
        ['sq-b', '2000-01-03', 'accepted', null, 'denied', null],
      ],
    });
    expect(
      await supplierQuotesRepo.findEarliestExpirationByIds(['sq-a', 'sq-b'], testDb),
    ).toBeNull();
  });

  test('a live offer chain stays counted (base is "offer", non-terminal)', async () => {
    exec.enqueue({ rows: [['sq-a', '2000-01-02', 'accepted', null, 'sent', '2999-12-31']] });
    expect(await supplierQuotesRepo.findEarliestExpirationByIds(['sq-a'], testDb)).toBe(
      '2000-01-02',
    );
  });

  test('an unsourced supplier quote (draft) stays counted', async () => {
    exec.enqueue({ rows: [['sq-a', '2000-01-02', null, null, null, null]] });
    expect(await supplierQuotesRepo.findEarliestExpirationByIds(['sq-a'], testDb)).toBe(
      '2000-01-02',
    );
  });

  test('empty/blank id list short-circuits without a query', async () => {
    expect(await supplierQuotesRepo.findEarliestExpirationByIds([], testDb)).toBeNull();
    expect(await supplierQuotesRepo.findEarliestExpirationByIds([''], testDb)).toBeNull();
    expect(exec.calls.length).toBe(0);
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
    expect(sql).toContain('"id" = $7');
    expect(exec.calls[0].params).toHaveLength(7);
    expect(exec.calls[0].params[5]).toBe('hi'); // notes
    expect(exec.calls[0].params[6]).toBe('q-1'); // where id
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

describe('findSourcedItemIds', () => {
  // Three parallel DISTINCT probes in call order: quote_items, customer_offer_items, sale_items —
  // each restricted to supplier_quote_item_id values belonging to this quote's items.
  test('unions the referenced item ids across the three client tables', async () => {
    exec.enqueue({ rows: [['sqi-1']] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [['sqi-2'], [null]] });
    const result = await supplierQuotesRepo.findSourcedItemIds('q-1', testDb);
    expect(result).toEqual(new Set(['sqi-1', 'sqi-2']));
    const sqlTexts = exec.calls.map((c) => c.sql.toLowerCase());
    expect(sqlTexts[0]).toContain('"quote_items"');
    expect(sqlTexts[1]).toContain('"customer_offer_items"');
    expect(sqlTexts[2]).toContain('"sale_items"');
    for (const sqlText of sqlTexts) {
      expect(sqlText).toContain('distinct');
      expect(sqlText).toContain('"supplier_quote_item_id" in (select');
    }
    expect(exec.calls[0].params).toContain('q-1');
  });

  test('empty set when nothing references the items', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.findSourcedItemIds('q-1', testDb)).toEqual(new Set());
  });
});

describe('upsertItems', () => {
  const baseItem = {
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
  };

  test('updates kept rows in place, deletes absent rows, inserts new ones (user report after #812)', async () => {
    exec.enqueue({ rows: [['sqi-a'], ['sqi-b']] }); // existing ids
    exec.enqueue({ rows: [] }); // DELETE id NOT IN (kept)
    exec.enqueue({ rows: [] }); // UPDATE sqi-a in place
    exec.enqueue({ rows: [itemRow({ 0: 'sqi-new' })] }); // INSERT new ... RETURNING
    exec.enqueue({ rows: [itemRow({ 0: 'sqi-a' }), itemRow({ 0: 'sqi-new' })] }); // re-read
    const result = await supplierQuotesRepo.upsertItems(
      'q-1',
      [
        { ...baseItem, id: 'sqi-a', unitPrice: 9, listPrice: 9 },
        { ...baseItem, id: 'sqi-new', productName: 'B' },
      ],
      testDb,
    );
    expect(exec.calls).toHaveLength(5);
    const sqlTexts = exec.calls.map((c) => c.sql.toLowerCase());
    expect(sqlTexts[0]).toContain('select');
    expect(exec.calls[0].params).toEqual(['q-1']);
    expect(sqlTexts[1]).toContain('delete from "supplier_quote_items"');
    expect(sqlTexts[1]).toContain('not in');
    expect(exec.calls[1].params).toEqual(expect.arrayContaining(['q-1', 'sqi-a', 'sqi-new']));
    expect(sqlTexts[2]).toContain('update "supplier_quote_items" set');
    // The in-place UPDATE must not touch created_at: it drives the items' display order, and
    // identity preservation is the whole point of the upsert.
    expect(sqlTexts[2]).not.toContain('created_at');
    expect(exec.calls[2].params).toEqual(expect.arrayContaining(['sqi-a', 'q-1']));
    expect(sqlTexts[3]).toContain('insert into "supplier_quote_items"');
    expect(exec.calls[3].params[0]).toBe('sqi-new');
    expect(result.map((i) => i.id)).toEqual(['sqi-a', 'sqi-new']);
  });

  test('skips the INSERT when every incoming item already exists', async () => {
    exec.enqueue({ rows: [['sqi-a']] }); // existing ids
    exec.enqueue({ rows: [] }); // DELETE id NOT IN (kept)
    exec.enqueue({ rows: [] }); // UPDATE sqi-a
    exec.enqueue({ rows: [itemRow({ 0: 'sqi-a' })] }); // re-read
    const result = await supplierQuotesRepo.upsertItems(
      'q-1',
      [{ ...baseItem, id: 'sqi-a' }],
      testDb,
    );
    expect(exec.calls).toHaveLength(4);
    const sqlTexts = exec.calls.map((c) => c.sql.toLowerCase());
    expect(sqlTexts.some((s) => s.includes('insert into'))).toBe(false);
    expect(result.map((i) => i.id)).toEqual(['sqi-a']);
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

  // Row shape mirrors the select order: [itemId, quoteId, supplierName, productId, unitPrice,
  // expirationDate, linkedOrderId, linkedClientQuoteStatus, linkedClientQuoteExpiration,
  // linkedOfferStatus, linkedOfferExpiration].
  test('maps row fields into snapshot shape with netCost mirroring unitPrice', async () => {
    exec.enqueue({
      rows: [['sqi-1', 'sq-1', 'Acme', 'p-1', '12.5', '2999-12-31', null, null, null, null, null]],
    });
    const result = await supplierQuotesRepo.getQuoteItemSnapshots(['sqi-1'], testDb);
    expect(result.get('sqi-1')).toEqual({
      supplierQuoteId: 'sq-1',
      supplierName: 'Acme',
      productId: 'p-1',
      unitPrice: 12.5,
      netCost: 12.5,
      // Unsourced live quote → derived draft, no linked order → offered for NEW sourcing.
      sourceable: true,
    });
  });

  test('marks frozen/order-locked/expired quotes as NOT sourceable (#812 round 15)', async () => {
    exec.enqueue({
      rows: [
        // Accepted chain → derived accepted (frozen).
        ['sqi-a', 'sq-a', 'Acme', null, '10', '2999-12-31', null, 'accepted', null, null, null],
        // Order-locked, even though the chain is live.
        [
          'sqi-b',
          'sq-b',
          'Acme',
          null,
          '10',
          '2999-12-31',
          'so-1',
          'sent',
          '2999-12-31',
          null,
          null,
        ],
        // Own expiration past on a live chain → derived expired.
        ['sqi-c', 'sq-c', 'Acme', null, '10', '2000-01-01', null, null, null, null, null],
        // Draft-derived, unlocked, live → sourceable.
        ['sqi-d', 'sq-d', 'Acme', null, '10', '2999-12-31', null, null, null, null, null],
      ],
    });
    const result = await supplierQuotesRepo.getQuoteItemSnapshots(
      ['sqi-a', 'sqi-b', 'sqi-c', 'sqi-d'],
      testDb,
    );
    expect(result.get('sqi-a')?.sourceable).toBe(false);
    expect(result.get('sqi-b')?.sourceable).toBe(false);
    expect(result.get('sqi-c')?.sourceable).toBe(false);
    expect(result.get('sqi-d')?.sourceable).toBe(true);
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

  test('preserves the client-authored unit cost when scale-2 list price cannot reproduce it exactly', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.syncItemPricing(
      'q-1',
      [{ itemId: 'sqi-1', quantity: 150, unitCost: 32.09, discountPercent: 15 }],
      testDb,
    );

    // 32.09 / 0.85 rounds to listPrice 37.75, whose exact discounted value is 32.0875.
    // The bidirectional sync must keep the client-authored 32.09 authoritative; otherwise the
    // client snapshot is stale immediately after the atomic save.
    expect(exec.calls[0].params).toEqual(
      expect.arrayContaining(['150', '32.09', '37.75', '15', 'sqi-1']),
    );
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
        communicationChannelId: 'qcc_email',
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
        communicationChannelId: 'qcc_email',
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
        communicationChannelId: 'qcc_email',
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
        communicationChannelId: 'qcc_email',
        notes: null,
      },
      testDb,
    );
    expect(result).toBeNull();
  });
});
