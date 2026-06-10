import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveSupplierQuoteStatus } from '../../utils/quote-status.ts';
import {
  dateOffsetDays,
  extractTopLevelTuples,
  parseInsertValuesBlocks,
  parseSelectValuesBlocks,
  unquote,
} from './seedSqlParsing.ts';

// Coherence guard for the #779 LINE-SOURCED demo linkage (PR #812 follow-up). Supplier-quote
// statuses are fully derived; the demo no longer carries the 1-to-1 quotes.linked_supplier_quote_id
// header link, so each supplier quote's visible status now comes from the client quote whose LINES
// source it (quote_items.supplier_quote_id) plus that quote's offer chain. These assertions parse
// seed.sql statically (no DB) and recompute effectiveSupplierQuoteStatus for every demo supplier
// quote, so a future reseed that breaks the sourcing or the margins fails here.

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

const isPastOffset = (cell: string | undefined): boolean => {
  const offset = dateOffsetDays(cell);
  return offset !== null && offset < 0;
};

// cq id -> { status, isPastExpiration }
const quotes = new Map(
  parseInsertValuesBlocks(SEED_SQL, 'quotes').map((row) => [
    row.id,
    { status: row.status, expired: isPastOffset(row.expiration_date) },
  ]),
);

// cq id -> the offer linked to it (each demo quote has at most one)
const offersByQuote = new Map(
  parseInsertValuesBlocks(SEED_SQL, 'customer_offers').map((row) => [
    row.linked_quote_id,
    { status: row.status, expired: isPastOffset(row.expiration_date) },
  ]),
);

// sq id -> own expiration past?
const supplierExpired = new Map(
  parseInsertValuesBlocks(SEED_SQL, 'supplier_quotes').map((row) => [
    row.id,
    isPastOffset(row.expiration_date),
  ]),
);

// supplier_quote_item id -> current net cost (unit_price)
const supplierItemCost = new Map(
  parseSelectValuesBlocks(SEED_SQL, 'supplier_quote_items')[0].rows.map((row) => [
    row.id,
    Number(row.unit_price),
  ]),
);

// quote_items id -> { quoteId, sale } (sale = the line's own unit price, the margin numerator)
const quoteItems = new Map(
  parseSelectValuesBlocks(SEED_SQL, 'quote_items')[0].rows.map((row) => [
    row.id,
    { quoteId: row.quote_id, sale: Number(row.unit_price) },
  ]),
);

type Sourcing = {
  cqiId: string;
  supplierQuoteId: string;
  supplierItemId: string;
  supplierName: string;
  snapshot: number;
};

// Parse both `UPDATE quote_items` sourcing statements the seed runs after the inserts:
// the bulk `... FROM (VALUES ...) AS v(...)` block and the single editable stale-data demo.
const parseSourcing = (sql: string): Sourcing[] => {
  const rows: Sourcing[] = [];

  const bulk = sql.match(
    /UPDATE quote_items AS qi SET[\s\S]*?FROM \(VALUES([\s\S]*?)\)\s*AS v\(([^)]*)\)/,
  );
  if (bulk) {
    const cols = bulk[2].split(',').map((c) => c.trim());
    for (const tuple of extractTopLevelTuples(bulk[1])) {
      const cell = (name: string) => unquote(tuple[cols.indexOf(name)]);
      rows.push({
        cqiId: cell('cqi_id'),
        supplierQuoteId: cell('sq_id'),
        supplierItemId: cell('sqi_id'),
        supplierName: cell('supplier_name'),
        snapshot: Number(cell('unit_price')),
      });
    }
  }

  const single = sql.match(
    /UPDATE quote_items SET\s+supplier_quote_id = '([^']+)',\s+supplier_quote_item_id = '([^']+)',\s+supplier_quote_supplier_name = '([^']+)',\s+supplier_quote_unit_price = ([\d.]+)\s+WHERE id = '([^']+)'/,
  );
  if (single) {
    rows.push({
      cqiId: single[5],
      supplierQuoteId: single[1],
      supplierItemId: single[2],
      supplierName: single[3],
      snapshot: Number(single[4]),
    });
  }

  return rows;
};

const sourcing = parseSourcing(SEED_SQL);

// The status each demo supplier quote must DERIVE under line sourcing (mirrors the seed comment).
const EXPECTED_STATUS: Record<string, string> = {
  dm_sq_01: 'draft', // sourced by nobody → selectable in the client-quote dialog
  dm_sq_02: 'sent',
  dm_sq_03: 'accepted',
  dm_sq_04: 'offer',
  dm_sq_05: 'offer',
  dm_sq_06: 'accepted',
  dm_sq_07: 'accepted',
  dm_sq_08: 'denied',
  dm_sq_09: 'denied',
  dm_sq_10: 'expired', // sourced by nobody, own expiration past
  dm_sq_11: 'accepted',
  dm_sq_12: 'accepted',
  dm_sq_13: 'accepted',
  dm_sq_14: 'accepted',
};

// Mirror supplierQuotesRepo's "most-advanced sourcing quote wins" rank.
const rank = (status: string): number => {
  switch (status) {
    case 'accepted':
    case 'confirmed':
      return 5;
    case 'offer':
      return 4;
    case 'sent':
    case 'received':
      return 3;
    case 'denied':
    case 'rejected':
      return 1;
    default:
      return 2;
  }
};

const sourcingFor = (supplierQuoteId: string) =>
  sourcing.filter((row) => row.supplierQuoteId === supplierQuoteId);

describe('seed.sql line-sourced supplier-quote linkage (#779 / PR #812)', () => {
  test('parses the demo sourcing rows', () => {
    // 11 bulk rows + 1 editable stale-data row = 12 sourced demo client lines.
    expect(sourcing.length).toBe(12);
    for (const row of sourcing) {
      expect(quoteItems.has(row.cqiId)).toBe(true);
      expect(supplierItemCost.has(row.supplierItemId)).toBe(true);
    }
  });

  test('every demo supplier quote derives its documented status from line sourcing', () => {
    for (const [supplierQuoteId, expected] of Object.entries(EXPECTED_STATUS)) {
      const sources = sourcingFor(supplierQuoteId);
      // Distinct client quotes whose lines source this supplier quote.
      const sourcingQuoteIds = [
        ...new Set(sources.map((row) => quoteItems.get(row.cqiId)?.quoteId).filter(Boolean)),
      ] as string[];

      const chosenQuoteId = sourcingQuoteIds
        .map((id) => ({ id, status: quotes.get(id)?.status ?? '' }))
        .sort((a, b) => rank(b.status) - rank(a.status))[0]?.id;
      const chosen = chosenQuoteId ? quotes.get(chosenQuoteId) : undefined;
      const offer = chosenQuoteId ? offersByQuote.get(chosenQuoteId) : undefined;

      const derived = effectiveSupplierQuoteStatus({
        linkedClientStatus: chosen ? chosen.status : null,
        isPastOwnExpiration: supplierExpired.get(supplierQuoteId) ?? false,
        isPastLinkedQuoteExpiration: chosen?.expired ?? false,
        linkedOfferStatus: offer ? offer.status : null,
        isPastLinkedOfferExpiration: offer?.expired ?? false,
      });

      expect(`${supplierQuoteId}=${derived}`).toBe(`${supplierQuoteId}=${expected}`);
    }
  });

  test('dm_sq_01 (draft picker candidate) and dm_sq_10 (expired) are sourced by nobody', () => {
    expect(sourcingFor('dm_sq_01')).toEqual([]);
    expect(sourcingFor('dm_sq_10')).toEqual([]);
  });

  test('every sourced line keeps a positive margin (snapshot net cost below its sale price)', () => {
    for (const row of sourcing) {
      const line = quoteItems.get(row.cqiId);
      expect(line).toBeDefined();
      expect(row.snapshot).toBeLessThan(line?.sale ?? 0);
    }
  });

  test('snapshots match the live supplier net cost, except the one editable stale-data demo', () => {
    for (const row of sourcing) {
      const live = supplierItemCost.get(row.supplierItemId) ?? 0;
      if (row.cqiId === 'dm_cqi_03') {
        // dm_cq_02 is sent (editable) → its line intentionally lags so the refresh chip shows.
        expect(row.snapshot).toBeLessThan(live);
      } else {
        // Read-only (accepted/denied) quotes never show the chip, but the snapshot still mirrors
        // the live cost so nothing looks stale if the quote is ever reopened editable.
        expect(row.snapshot).toBe(live);
      }
    }
  });

  test('each sourced line records the supplier name of the quote it sources', () => {
    const supplierNameByQuote = new Map(
      parseInsertValuesBlocks(SEED_SQL, 'supplier_quotes').map((r) => [r.id, r.supplier_name]),
    );
    for (const row of sourcing) {
      const expectedName = supplierNameByQuote.get(row.supplierQuoteId);
      expect(expectedName).toBeDefined();
      expect(row.supplierName).toBe(expectedName as string);
    }
  });
});
