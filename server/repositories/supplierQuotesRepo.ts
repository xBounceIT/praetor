import { and, asc, desc, eq, getTableColumns, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows, runAtomically } from '../db/drizzle.ts';
import { customerOfferItems } from '../db/schema/customerOfferItems.ts';
import { quoteItems } from '../db/schema/quotes.ts';
import { saleItems } from '../db/schema/sales.ts';
import { supplierQuoteItems, supplierQuotes } from '../db/schema/supplierQuotes.ts';
import { supplierSales } from '../db/schema/supplierSales.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { type DurationUnit, normalizeDurationUnit } from '../utils/duration-unit.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';
import {
  effectiveSupplierQuoteStatusFromDate,
  isTerminalQuoteStatus,
} from '../utils/quote-status.ts';
import {
  deriveSupplierLinePricing,
  normalizeSupplierUnitPrice,
} from '../utils/supplier-quote-pricing.ts';

export type SupplierQuote = {
  id: string;
  description: string | null;
  supplierId: string;
  supplierName: string;
  clientId: string | null;
  clientName: string | null;
  paymentTerms: string | null;
  status: string;
  expirationDate: string | null;
  communicationChannelId: string;
  communicationChannelName: string;
  linkedOrderId: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  // The client quote (if any) that links to this supplier quote via the 1-to-1
  // quotes.linked_supplier_quote_id FK (issue #779). The supplier quote's visible status is
  // FULLY DERIVED from this chain: the linked quote's status/expiration, and — when an offer was
  // created from that quote — the offer's status/expiration. All fields are null when unlinked.
  linkedClientQuoteId: string | null;
  linkedClientQuoteStatus: string | null;
  linkedClientQuoteExpiration: string | null;
  linkedOfferStatus: string | null;
  linkedOfferExpiration: string | null;
};

// The outer supplier_quotes.id, qualified to the OUTER table for use inside the correlated
// subqueries below. Hand-qualified on purpose: `${supplierQuotes.id}` renders as a BARE "id"
// because the outer query is join-less (Drizzle omits the table prefix), which then (a) shadows
// to the subquery's own inner table id — a silently wrong correlation — and (b) is AMBIGUOUS in
// the offer subqueries that join two id-bearing tables (customer_offers + quotes), aborting the
// whole list query with "column reference \"id\" is ambiguous". The outer table is always
// selected unaliased as "supplier_quotes" (see listAll/findById/lockEffectiveStatusById), so the
// explicit reference is stable. Do NOT replace with ${supplierQuotes.id}.
const outerSupplierQuoteId = sql`${sql.identifier('supplier_quotes')}.${sql.identifier('id')}`;

// The client quote that most-advances this supplier quote, resolved through PRODUCT-LINE sourcing
// (quote_items.supplier_quote_id) — issue #779 follow-up: the 1:1 quotes.linked_supplier_quote_id
// header link was removed as redundant with the per-line sourcing, so a supplier quote now follows
// the furthest-progressed client document whose lines use it. NULL when no client quote sources
// this supplier quote. The downstream offer is still that chosen quote's offer
// (customer_offers.linked_quote_id), so the derived-status chain (effectiveSupplierQuoteStatus)
// is unchanged — only the quote it follows changed.
// "Most-advanced sourcing quote wins" ordering, shared by the scalar subquery (single-row paths)
// and the list LATERAL below so the CASE lives in one place. Ranked by the CHAINED effective
// status the row would ultimately project (mirroring effectiveSupplierQuoteStatus), NOT the raw
// quote status: when a candidate has an offer, the projection follows the OFFER, so ranking on
// cq.status alone would let an accepted quote whose offer is denied/expired (a dead chain)
// outrank a live sent/offer quote and wrongly freeze the supplier quote in multi-quote sourcing.
// Mapping per candidate, terminal-first then expiration overlay (like effectiveQuoteStatus):
//   accepted 6 > offer 5 > sent 4 > draft/unknown 3 > expired 2 > denied 1
// (dead-ends — denied, expired — never outrank a live document; expired sits above denied because
// extending the date can revive it). Legacy spellings rank with their canonical equivalents
// (confirmed/approved→accepted, received→sent, rejected→denied). Requires the candidate's offer
// joined as `co` and the sourced candidate expiry joined as `sourcing_candidate`. Tiebreak:
// most-recently-updated, then id.
const sourcingRankOrderBy = sql`
  CASE
    WHEN co.id IS NOT NULL THEN
      CASE
        WHEN co.status IN ('accepted', 'confirmed', 'approved') THEN 6
        WHEN co.status IN ('denied', 'rejected') THEN 1
        WHEN co.expiration_date < CURRENT_DATE THEN 2
        ELSE 5
      END
    ELSE
      CASE
        WHEN cq.status IN ('accepted', 'confirmed', 'approved') THEN 6
        WHEN cq.status IN ('denied', 'rejected') THEN 1
        WHEN COALESCE("sourcing_candidate"."expiration_date", cq.expiration_date) < CURRENT_DATE THEN 2
        WHEN cq.status = 'offer' THEN 5
        WHEN cq.status IN ('sent', 'received') THEN 4
        ELSE 3
      END
  END DESC,
  cq.updated_at DESC,
  cq.id`;

// Resolve the latest expiry among non-discarded candidates whose own lines source this supplier
// quote. MAX preserves family semantics when several active variants source the same document:
// the chain expires only after every relevant candidate expires. The parent date is only a
// rolling-deploy fallback for offer-only sourcing or legacy rows without a candidate.
const sourcingCandidateExpirationLateral = sql`LATERAL (
  SELECT MAX(qcand.expiration_date) AS expiration_date
  FROM quote_items qi
  JOIN quote_candidates qcand ON qcand.id = COALESCE(
    qi.candidate_id,
    (
      SELECT default_candidate.id
      FROM quote_candidates default_candidate
      WHERE default_candidate.quote_id = qi.quote_id
      ORDER BY default_candidate.position, default_candidate.id
      LIMIT 1
    )
  )
  WHERE qi.quote_id = cq.id AND qcand.quote_id = qi.quote_id AND qcand.state <> 'discarded' AND (
    qi.supplier_quote_id = ${outerSupplierQuoteId}
    OR qi.supplier_quote_item_id IN (
      SELECT sqi.id FROM supplier_quote_items sqi WHERE sqi.quote_id = ${outerSupplierQuoteId}
    )
  )
) "sourcing_candidate"`;

const effectiveSourcingCandidateExpiration = sql`COALESCE(
  "sourcing_candidate"."expiration_date",
  cq.expiration_date
)`;

// A quote is a sourcing CANDIDATE when its own lines source this supplier quote OR when its
// offer's lines do (#812 round 16): an offer can add a fresh sourced line that exists only in
// customer_offer_items, and offers always hang off a quote (linked_quote_id NOT NULL), so mapping
// the offer line back to its quote lets the existing quote→offer chain projection apply unchanged.
// Like isSourcedByClientDocuments, each branch also accepts LEGACY rows that carry only the
// supplier_quote_item_id (null denormalized supplier_quote_id) via item membership (#812 round
// 18) — otherwise those sourced quotes would keep displaying as unlinked draft.
const sourcingCandidatePredicate = sql`(
    "sourcing_candidate"."expiration_date" IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM customer_offers co2
      JOIN customer_offer_items coi ON coi.offer_id = co2.id
      WHERE co2.linked_quote_id = cq.id AND (
        coi.supplier_quote_id = ${outerSupplierQuoteId}
        OR coi.supplier_quote_item_id IN (
          SELECT sqi.id FROM supplier_quote_items sqi WHERE sqi.quote_id = ${outerSupplierQuoteId}
        )
      )
    )
  )`;

const chosenClientQuoteId = sql<string | null>`(
  SELECT cq.id FROM quotes cq
  LEFT JOIN customer_offers co ON co.linked_quote_id = cq.id
  LEFT JOIN ${sourcingCandidateExpirationLateral} ON true
  WHERE ${sourcingCandidatePredicate}
  ORDER BY ${sourcingRankOrderBy}
  LIMIT 1
)`;

// Same chosen-quote resolution as `chosenClientQuoteId`, but as a LEFT JOIN LATERAL that the list
// query (listAll) joins ONCE per supplier-quote row — then reads id/status/expiration off "chosen"
// and the downstream offer off "chosen_offer". This replaces inlining the scalar subquery 5× in
// the SELECT (Drizzle interpolates the `sql` fragment textually, so Postgres would otherwise
// re-run the ranked quote_items scan once per derived column, per row). The single-row paths
// (findById, lockEffectiveStatusById) keep the scalar subqueries: the 5× cost is negligible for
// one row, and lockEffectiveStatusById's `FOR UPDATE` must not lock the joined quotes/offers rows.
const chosenClientQuoteLateral = sql`LATERAL (
  SELECT cq.id, cq.status, ${effectiveSourcingCandidateExpiration} AS expiration_date
  FROM quotes cq
  LEFT JOIN customer_offers co ON co.linked_quote_id = cq.id
  LEFT JOIN ${sourcingCandidateExpirationLateral} ON true
  WHERE ${sourcingCandidatePredicate}
  ORDER BY ${sourcingRankOrderBy}
  LIMIT 1
) "chosen"`;

// Derived-status columns for the list projection, read straight off the LATERAL join above
// (customer_offers is unique on linked_quote_id, so the join yields ≤1 offer — equivalent to the
// scalar subqueries' LIMIT 1). ::text so the driver returns 'YYYY-MM-DD' strings, not Date objects.
const lateralDerivedColumns = {
  linkedClientQuoteId: sql<string | null>`"chosen"."id"`,
  linkedClientQuoteStatus: sql<string | null>`"chosen"."status"`,
  linkedClientQuoteExpiration: sql<string | null>`"chosen"."expiration_date"::text`,
  linkedOfferStatus: sql<string | null>`"chosen_offer"."status"`,
  linkedOfferExpiration: sql<string | null>`"chosen_offer"."expiration_date"::text`,
};
const chosenOfferJoin = sql`"customer_offers" "chosen_offer"`;
const chosenOfferJoinOn = sql`"chosen_offer"."linked_quote_id" = "chosen"."id"`;

const linkedClientQuoteIdSubquery = chosenClientQuoteId;
const linkedClientQuoteStatusSubquery = sql<string | null>`(
  SELECT q.status FROM quotes q WHERE q.id = ${chosenClientQuoteId} LIMIT 1
)`;
// Resolve the same ranked quote as chosenClientQuoteId, but project the matched candidate-family
// expiration instead of the mirrored parent date. ::text keeps the wire value as YYYY-MM-DD.
const linkedClientQuoteExpirationSubquery = sql<string | null>`(
  SELECT ${effectiveSourcingCandidateExpiration}::text
  FROM quotes cq
  LEFT JOIN customer_offers co ON co.linked_quote_id = cq.id
  LEFT JOIN ${sourcingCandidateExpirationLateral} ON true
  WHERE ${sourcingCandidatePredicate}
  ORDER BY ${sourcingRankOrderBy}
  LIMIT 1
)`;
const linkedOfferStatusSubquery = sql<string | null>`(
  SELECT o.status FROM customer_offers o WHERE o.linked_quote_id = ${chosenClientQuoteId} LIMIT 1
)`;
const linkedOfferExpirationSubquery = sql<string | null>`(
  SELECT o.expiration_date::text FROM customer_offers o
  WHERE o.linked_quote_id = ${chosenClientQuoteId} LIMIT 1
)`;

const communicationChannelNameSubquery = sql<string>`(
  SELECT qcc.name
  FROM quote_communication_channels qcc
  WHERE qcc.id = "supplier_quotes"."communication_channel_id"
  LIMIT 1
)`;

export type SupplierQuoteItem = {
  id: string;
  quoteId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  listPrice: number;
  discountPercent: number;
  unitPrice: number;
  note: string | null;
  unitType: string;
  durationMonths: number;
  durationUnit: DurationUnit;
};

type QuoteRow = typeof supplierQuotes.$inferSelect & {
  linkedOrderId?: string | null;
  communicationChannelName: string;
  linkedClientQuoteId?: string | null;
  linkedClientQuoteStatus?: string | null;
  linkedClientQuoteExpiration?: string | null;
  linkedOfferStatus?: string | null;
  linkedOfferExpiration?: string | null;
};

const mapQuote = (row: QuoteRow): SupplierQuote => ({
  id: row.id,
  description: row.description,
  supplierId: row.supplierId,
  supplierName: row.supplierName,
  clientId: row.clientId ?? null,
  clientName: row.clientName ?? null,
  paymentTerms: row.paymentTerms,
  status: row.status,
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'supplierQuote.expirationDate'),
  communicationChannelId: row.communicationChannelId,
  communicationChannelName: row.communicationChannelName,
  linkedOrderId: row.linkedOrderId ?? null,
  notes: row.notes,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
  linkedClientQuoteId: row.linkedClientQuoteId ?? null,
  linkedClientQuoteStatus: row.linkedClientQuoteStatus ?? null,
  linkedClientQuoteExpiration: row.linkedClientQuoteExpiration ?? null,
  linkedOfferStatus: row.linkedOfferStatus ?? null,
  linkedOfferExpiration: row.linkedOfferExpiration ?? null,
});

const mapItem = (row: typeof supplierQuoteItems.$inferSelect): SupplierQuoteItem => ({
  id: row.id,
  quoteId: row.quoteId,
  productId: row.productId,
  productName: row.productName,
  quantity: parseDbNumber(row.quantity, 0),
  listPrice: parseDbNumber(row.listPrice, 0),
  discountPercent: parseDbNumber(row.discountPercent, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  note: row.note,
  unitType: row.unitType ?? 'unit',
  durationMonths: row.durationMonths ?? 1,
  durationUnit: normalizeDurationUnit(row.durationUnit),
});

export const listAll = async (exec: DbExecutor = db): Promise<SupplierQuote[]> => {
  const rows = await exec
    .select({
      ...getTableColumns(supplierQuotes),
      communicationChannelName: communicationChannelNameSubquery,
      linkedOrderId: sql<string | null>`(
        SELECT ss.id FROM supplier_sales ss
        WHERE ss.linked_quote_id = ${outerSupplierQuoteId}
        LIMIT 1
      )`,
      // Appended after linkedOrderId so positional row fixtures keep their indices (repo tests).
      // Resolved via the LATERAL join below — the chosen-quote ranking runs ONCE per row, not once
      // per derived column.
      ...lateralDerivedColumns,
    })
    .from(supplierQuotes)
    .leftJoin(chosenClientQuoteLateral, sql`true`)
    .leftJoin(chosenOfferJoin, chosenOfferJoinOn)
    .orderBy(desc(supplierQuotes.createdAt));
  return rows.map(mapQuote);
};

export const listAllItems = async (exec: DbExecutor = db): Promise<SupplierQuoteItem[]> => {
  const rows = await exec
    .select()
    .from(supplierQuoteItems)
    .orderBy(asc(supplierQuoteItems.createdAt), asc(supplierQuoteItems.id));
  return rows.map(mapItem);
};

export const findById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<SupplierQuote | null> => {
  const rows = await exec
    .select({
      ...getTableColumns(supplierQuotes),
      communicationChannelName: communicationChannelNameSubquery,
      linkedClientQuoteId: linkedClientQuoteIdSubquery,
      linkedClientQuoteStatus: linkedClientQuoteStatusSubquery,
      linkedClientQuoteExpiration: linkedClientQuoteExpirationSubquery,
      linkedOfferStatus: linkedOfferStatusSubquery,
      linkedOfferExpiration: linkedOfferExpirationSubquery,
    })
    .from(supplierQuotes)
    .where(eq(supplierQuotes.id, id));
  return rows[0] ? mapQuote(rows[0]) : null;
};

// Per-id BLOCKING expirations among the given supplier quotes (the ones client quotes source via
// their lines): supplier-quote id → its own expiration date, EXCLUDING quotes whose chained
// EFFECTIVE status is terminal (#812 rounds 10-11). A terminal-effective (accepted/denied) supplier
// quote is frozen and never shows as Expired — e.g. it derives `accepted` through another accepted
// client document — so its past date must neither block progression (the guard) nor light the
// client-side `linkedSupplierQuoteExpired` indicator (the list/response flag); both read this.
// Each row's effective status is computed with the same chain columns findById materializes and
// the canonical effectiveSupplierQuoteStatusFromDate (no SQL re-implementation that could drift).
export const findBlockingExpirationsByIds = async (
  ids: string[],
  exec: DbExecutor = db,
): Promise<Map<string, string>> => {
  const blocking = new Map<string, string>();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return blocking;
  const rows = await exec
    .select({
      id: supplierQuotes.id,
      expirationDate: supplierQuotes.expirationDate,
      linkedClientQuoteStatus: linkedClientQuoteStatusSubquery,
      linkedClientQuoteExpiration: linkedClientQuoteExpirationSubquery,
      linkedOfferStatus: linkedOfferStatusSubquery,
      linkedOfferExpiration: linkedOfferExpirationSubquery,
    })
    .from(supplierQuotes)
    .where(inArray(supplierQuotes.id, uniqueIds));
  for (const row of rows) {
    const expirationDate = normalizeNullableDateOnly(
      row.expirationDate,
      'supplierQuote.expirationDate',
    );
    if (!expirationDate) continue;
    const effective = effectiveSupplierQuoteStatusFromDate({
      expirationDate,
      linkedClientStatus: row.linkedClientQuoteStatus,
      linkedClientQuoteExpiration: row.linkedClientQuoteExpiration,
      linkedOfferStatus: row.linkedOfferStatus,
      linkedOfferExpiration: row.linkedOfferExpiration,
    });
    // Terminal-effective (accepted/denied) is frozen — never expired, never blocks. The derived
    // `expired` itself is NOT terminal (isTerminalQuoteStatus floors it), so it stays counted.
    if (isTerminalQuoteStatus(effective)) continue;
    blocking.set(row.id, expirationDate);
  }
  return blocking;
};

// Earliest of the blocking expirations above — what the client-quotes progression/restore guards
// and the single-document response flag key on. Null when the id list is empty or every sourced
// supplier quote is terminal-frozen or has no expiration.
export const findEarliestExpirationByIds = async (
  ids: string[],
  exec: DbExecutor = db,
): Promise<string | null> => {
  let earliest: string | null = null;
  for (const date of (await findBlockingExpirationsByIds(ids, exec)).values()) {
    if (!earliest || date < earliest) earliest = date;
  }
  return earliest;
};

export const existsById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec
    .select({ id: supplierQuotes.id })
    .from(supplierQuotes)
    .where(eq(supplierQuotes.id, id));
  return rows.length > 0;
};

// Client-document synchronization (or a duplicate that retains its synced cost) can intentionally
// make unit_price authoritative even when it differs from the scale-2 list-price/discount formula.
// Limit the durable marker lookup to the snapshot timestamp so later syncs cannot rewrite the
// provenance of an older version. Version FKs follow quote-id renames while snapshot.quote.id
// keeps the former id, providing the aliases needed to find markers written before a rename.
export const hasClientSyncedCosts = async (
  quoteId: string,
  atOrBeforeMs: number,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await executeRows<{ exists: boolean }>(
    exec,
    sql`SELECT EXISTS (
      SELECT 1
      FROM audit_logs
      WHERE (
          (action = ${'supplier_quote.updated'}
            AND details ->> 'secondaryLabel' = ${'synced_from_client_line'})
          OR (action = ${'supplier_quote.created'}
            AND details ->> 'reason' = ${'client_synced_cost_preserved'})
        )
        AND entity_type = ${'supplier_quote'}
        AND (
          entity_id = ${quoteId}
          OR entity_id IN (
            SELECT snapshot -> 'quote' ->> 'id'
            FROM supplier_quote_versions
            WHERE quote_id = ${quoteId}
          )
        )
        AND created_at <= ${new Date(atOrBeforeMs)}
    ) AS "exists"`,
  );
  return rows[0]?.exists === true;
};

// SELECT ... FOR UPDATE (must be called inside a transaction) that also resolves the linked
// client quote's status, so callers
// (supplier-order create / clients-order supplier auto-create) can decide "is this supplier quote
// effectively accepted?" — mirror the linked client status, override with `expired` from the
// supplier quote's OWN expiration — atomically under the row lock (issue #779). The scalar
// subquery on `quotes` is unaffected by FOR UPDATE (only the supplier_quotes row is locked).
export const lockEffectiveStatusById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{
  expirationDate: string | null;
  linkedClientStatus: string | null;
  linkedClientQuoteExpiration: string | null;
  linkedOfferStatus: string | null;
  linkedOfferExpiration: string | null;
} | null> => {
  const rows = await exec
    .select({
      expirationDate: supplierQuotes.expirationDate,
      linkedClientStatus: linkedClientQuoteStatusSubquery,
      linkedClientQuoteExpiration: linkedClientQuoteExpirationSubquery,
      linkedOfferStatus: linkedOfferStatusSubquery,
      linkedOfferExpiration: linkedOfferExpirationSubquery,
    })
    .from(supplierQuotes)
    .where(eq(supplierQuotes.id, id))
    .for('update');
  if (!rows[0]) return null;
  return {
    expirationDate: normalizeNullableDateOnly(
      rows[0].expirationDate,
      'supplierQuote.expirationDate',
    ),
    linkedClientStatus: rows[0].linkedClientStatus ?? null,
    linkedClientQuoteExpiration: rows[0].linkedClientQuoteExpiration ?? null,
    linkedOfferStatus: rows[0].linkedOfferStatus ?? null,
    linkedOfferExpiration: rows[0].linkedOfferExpiration ?? null,
  };
};

export const findItemsForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> => {
  const rows = await exec
    .select()
    .from(supplierQuoteItems)
    .where(eq(supplierQuoteItems.quoteId, quoteId))
    .orderBy(asc(supplierQuoteItems.createdAt), asc(supplierQuoteItems.id));
  return rows.map(mapItem);
};

// Skips the linked-order subquery used by `listAll` because snapshots store on-row data only;
// the order-link join is reconstructed on read, not frozen into history.
export const findFullForSnapshot = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ quote: SupplierQuote; items: SupplierQuoteItem[] } | null> => {
  const quoteRows = await exec
    .select({
      ...getTableColumns(supplierQuotes),
      communicationChannelName: communicationChannelNameSubquery,
    })
    .from(supplierQuotes)
    .where(eq(supplierQuotes.id, id))
    .limit(1);
  if (quoteRows.length === 0) return null;
  const items = await findItemsForQuote(id, exec);
  return { quote: mapQuote(quoteRows[0]), items };
};

export const findLinkedOrderId = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ id: supplierSales.id })
    .from(supplierSales)
    .where(eq(supplierSales.linkedQuoteId, quoteId))
    .limit(1);
  return rows[0]?.id ?? null;
};

// Whether any client document line (quote, offer, or client-order item) still sources this
// supplier quote. There is deliberately NO FK behind these columns — the link is a soft
// snapshot reference — so the DELETE route must enforce referential safety itself (issue #779):
// deleting a sourced quote would strand the client lines with dead supplierQuoteItemIds and
// 400 their next edit. Checks both the denormalized supplier_quote_id and (for legacy rows
// that only carry the item id) membership in the quote's items.
export const isSourcedByClientDocuments = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const itemIdsSubquery = exec
    .select({ id: supplierQuoteItems.id })
    .from(supplierQuoteItems)
    .where(eq(supplierQuoteItems.quoteId, quoteId));
  const [quoteRefs, offerRefs, orderRefs] = await Promise.all([
    exec
      .select({ id: quoteItems.id })
      .from(quoteItems)
      .where(
        or(
          eq(quoteItems.supplierQuoteId, quoteId),
          inArray(quoteItems.supplierQuoteItemId, itemIdsSubquery),
        ),
      )
      .limit(1),
    exec
      .select({ id: customerOfferItems.id })
      .from(customerOfferItems)
      .where(
        or(
          eq(customerOfferItems.supplierQuoteId, quoteId),
          inArray(customerOfferItems.supplierQuoteItemId, itemIdsSubquery),
        ),
      )
      .limit(1),
    exec
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(
        or(
          eq(saleItems.supplierQuoteId, quoteId),
          inArray(saleItems.supplierQuoteItemId, itemIdsSubquery),
        ),
      )
      .limit(1),
  ]);
  return quoteRefs.length > 0 || offerRefs.length > 0 || orderRefs.length > 0;
};

// The subset of this quote's item ids that client document lines (quote, offer, or client-order
// items) reference via supplier_quote_item_id. Finer-grained companion to
// isSourcedByClientDocuments for the PUT items path (user report after #812): an in-place item
// UPDATE keeps the id and strands nothing, so only deleting — or repointing the product of — one
// of THESE items needs to be refused. Quote-level-only references (supplier_quote_id with a null
// item id) never break on item edits, so they are deliberately out of scope here.
export const findSourcedItemIds = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<Set<string>> => {
  const itemIdsSubquery = exec
    .select({ id: supplierQuoteItems.id })
    .from(supplierQuoteItems)
    .where(eq(supplierQuoteItems.quoteId, quoteId));
  const [quoteRefs, offerRefs, orderRefs] = await Promise.all([
    exec
      .selectDistinct({ itemId: quoteItems.supplierQuoteItemId })
      .from(quoteItems)
      .where(inArray(quoteItems.supplierQuoteItemId, itemIdsSubquery)),
    exec
      .selectDistinct({ itemId: customerOfferItems.supplierQuoteItemId })
      .from(customerOfferItems)
      .where(inArray(customerOfferItems.supplierQuoteItemId, itemIdsSubquery)),
    exec
      .selectDistinct({ itemId: saleItems.supplierQuoteItemId })
      .from(saleItems)
      .where(inArray(saleItems.supplierQuoteItemId, itemIdsSubquery)),
  ]);
  const ids = new Set<string>();
  for (const row of [...quoteRefs, ...offerRefs, ...orderRefs]) {
    if (row.itemId) ids.add(row.itemId);
  }
  return ids;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: supplierQuotes.id })
    .from(supplierQuotes)
    .where(and(eq(supplierQuotes.id, newId), ne(supplierQuotes.id, currentId)));
  return rows.length > 0;
};

export type NewSupplierQuote = {
  id: string;
  description?: string | null;
  supplierId: string;
  supplierName: string;
  clientId: string | null;
  clientName: string | null;
  paymentTerms: string;
  status: string;
  expirationDate: string;
  communicationChannelId: string;
  notes: string | null;
};

export const create = async (
  input: NewSupplierQuote,
  exec: DbExecutor = db,
): Promise<SupplierQuote> => {
  const [row] = await exec
    .insert(supplierQuotes)
    .values({
      id: input.id,
      description: input.description ?? null,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      clientId: input.clientId,
      clientName: input.clientName,
      paymentTerms: input.paymentTerms,
      status: input.status,
      expirationDate: input.expirationDate,
      communicationChannelId: input.communicationChannelId,
      notes: input.notes,
    })
    .returning();
  return (await findById(row.id, exec)) ?? mapQuote({ ...row, communicationChannelName: '' });
};

export type SupplierQuoteUpdate = {
  description?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  // clientId/clientName accept an explicit `null` to clear the customer link. Unlike the
  // COALESCE-guarded fields above, `undefined` means "leave untouched" while `null` writes a
  // NULL — the optional association in issue #759 must be removable, not just settable.
  clientId?: string | null;
  clientName?: string | null;
  paymentTerms?: string;
  // No `status`: the stored column is vestigial under the fully-derived model (issue #779) — the
  // routes never patch it, and a writable field here would invite a caller to desync it.
  expirationDate?: string | null;
  communicationChannelId?: string | null;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: SupplierQuoteUpdate,
  exec: DbExecutor = db,
): Promise<SupplierQuote | null> => {
  // Empty patch → fall back to SELECT so the row (and updated_at) is left untouched.
  // Matches pre-Drizzle behavior; without this guard, an empty PUT would bump updated_at
  // and create a misleading audit trail.
  if (!Object.values(patch).some((v) => v !== undefined)) {
    return findById(id, exec);
  }
  const [row] = await exec
    .update(supplierQuotes)
    .set({
      description:
        patch.description === undefined ? sql`${supplierQuotes.description}` : patch.description,
      supplierId: sql`COALESCE(${patch.supplierId ?? null}, ${supplierQuotes.supplierId})`,
      supplierName: sql`COALESCE(${patch.supplierName ?? null}, ${supplierQuotes.supplierName})`,
      // Direct write (not COALESCE) so an explicit null clears the link; `undefined` keeps it.
      clientId: patch.clientId === undefined ? sql`${supplierQuotes.clientId}` : patch.clientId,
      clientName:
        patch.clientName === undefined ? sql`${supplierQuotes.clientName}` : patch.clientName,
      paymentTerms: sql`COALESCE(${patch.paymentTerms ?? null}, ${supplierQuotes.paymentTerms})`,
      expirationDate: sql`COALESCE(${patch.expirationDate ?? null}::date, ${supplierQuotes.expirationDate})`,
      communicationChannelId: sql`COALESCE(${patch.communicationChannelId ?? null}, ${supplierQuotes.communicationChannelId})`,
      notes: sql`COALESCE(${patch.notes ?? null}, ${supplierQuotes.notes})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(supplierQuotes.id, id))
    .returning();
  return row ? await findById(row.id, exec) : null;
};

// Separate from update() so generic patches can't mutate the PK (issue #621). Relies on
// ON UPDATE CASCADE on every incoming FK; see server/test/db/renamablePkFkCascade.test.ts.
export const rename = async (
  currentId: string,
  newId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuote | null> => {
  const [row] = await exec
    .update(supplierQuotes)
    .set({ id: newId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(supplierQuotes.id, currentId))
    .returning();
  return row ? await findById(row.id, exec) : null;
};

export type SupplierQuoteRestoreFields = {
  description?: string | null;
  supplierId: string;
  supplierName: string;
  clientId: string | null;
  clientName: string | null;
  paymentTerms: string;
  status: string;
  expirationDate: string;
  communicationChannelId: string;
  notes: string | null;
};

export const restoreSnapshotQuote = async (
  id: string,
  snapshot: SupplierQuoteRestoreFields,
  exec: DbExecutor = db,
): Promise<SupplierQuote | null> => {
  const description = Object.hasOwn(snapshot, 'description')
    ? { description: snapshot.description ?? null }
    : {};
  const [row] = await exec
    .update(supplierQuotes)
    .set({
      ...description,
      supplierId: snapshot.supplierId,
      supplierName: snapshot.supplierName,
      clientId: snapshot.clientId,
      clientName: snapshot.clientName,
      paymentTerms: snapshot.paymentTerms,
      status: snapshot.status,
      expirationDate: snapshot.expirationDate,
      communicationChannelId: snapshot.communicationChannelId,
      notes: snapshot.notes,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(supplierQuotes.id, id))
    .returning();
  return row ? await findById(row.id, exec) : null;
};

export const deleteById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ supplierName: string } | null> => {
  const rows = await exec
    .delete(supplierQuotes)
    .where(eq(supplierQuotes.id, id))
    .returning({ supplierName: supplierQuotes.supplierName });
  if (!rows[0]) return null;
  return { supplierName: rows[0].supplierName };
};

export const deleteByIdWithAttachmentStoredNames = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ supplierName: string; attachmentStoredNames: string[] } | null> => {
  const rows = await executeRows<{
    supplierName: string;
    attachmentStoredNames: string[] | null;
  }>(
    exec,
    sql`
      WITH attachments AS (
        SELECT COALESCE(array_agg(stored_name ORDER BY created_at DESC), ARRAY[]::text[]) AS stored_names
        FROM supplier_quote_attachments
        WHERE quote_id = ${id}
      ),
      deleted AS (
        DELETE FROM supplier_quotes
        WHERE id = ${id}
        RETURNING supplier_name
      )
      SELECT
        deleted.supplier_name AS "supplierName",
        attachments.stored_names AS "attachmentStoredNames"
      FROM deleted
      CROSS JOIN attachments
    `,
  );
  const row = rows[0];
  return row
    ? { supplierName: row.supplierName, attachmentStoredNames: row.attachmentStoredNames ?? [] }
    : null;
};

export type NewSupplierQuoteItem = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  listPrice: number;
  discountPercent: number;
  unitPrice: number;
  note: string | null;
  unitType: string;
  durationMonths: number;
  durationUnit: DurationUnit;
};

export type QuoteItemSnapshot = {
  supplierQuoteId: string;
  supplierName: string;
  productId: string | null;
  unitPrice: number;
  netCost: number;
  // Whether the parent supplier quote is currently offered for NEW sourcing (the same rule the
  // UI pickers apply): derived effective status `draft` and no linked supplier order. Routes use
  // this to reject FRESHLY-picked links from a stale tab / raw API client (#812 round 15) while
  // retained links — and conversion-inherited ones — keep re-saving regardless.
  sourceable: boolean;
};

/**
 * Resolves per-item snapshots used by the client-quotes/offers/orders routes to lock in
 * supplier-quote pricing at the moment a client document is created/updated. Deliberately NOT
 * status-filtered (issue #779 derived model — see the inline comment on the query): the only
 * way an id misses is that the supplier quote item no longer exists. Eligibility for NEW
 * sourcing is surfaced separately via `sourceable` so routes can gate fresh links without
 * breaking retained or conversion-inherited ones.
 */
export const getQuoteItemSnapshots = async (
  itemIds: string[],
  exec: DbExecutor = db,
): Promise<Map<string, QuoteItemSnapshot>> => {
  const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)));
  const snapshots = new Map<string, QuoteItemSnapshot>();
  if (uniqueIds.length === 0) return snapshots;

  const rows = await exec
    .select({
      itemId: supplierQuoteItems.id,
      quoteId: supplierQuotes.id,
      supplierName: supplierQuotes.supplierName,
      productId: supplierQuoteItems.productId,
      unitPrice: supplierQuoteItems.unitPrice,
      expirationDate: supplierQuotes.expirationDate,
      linkedOrderId: sql<string | null>`(
        SELECT ss.id FROM supplier_sales ss
        WHERE ss.linked_quote_id = ${outerSupplierQuoteId} LIMIT 1
      )`,
      linkedClientQuoteStatus: linkedClientQuoteStatusSubquery,
      linkedClientQuoteExpiration: linkedClientQuoteExpirationSubquery,
      linkedOfferStatus: linkedOfferStatusSubquery,
      linkedOfferExpiration: linkedOfferExpirationSubquery,
    })
    .from(supplierQuoteItems)
    .innerJoin(supplierQuotes, eq(supplierQuotes.id, supplierQuoteItems.quoteId))
    // No status filter (issue #779 derived model): supplier quotes start as draft and progress
    // only with the client document that uses them, so sourcing must work from draft quotes —
    // and re-saving a client quote whose supplier quote has since progressed must not 400. The
    // views gate which quotes are offered for NEW sourcing; `sourceable` mirrors that gate for
    // the routes' fresh-link checks.
    .where(inArray(supplierQuoteItems.id, uniqueIds));

  for (const row of rows) {
    const unitPrice = parseDbNumber(row.unitPrice, 0);
    const effective = effectiveSupplierQuoteStatusFromDate({
      expirationDate: normalizeNullableDateOnly(row.expirationDate, 'supplierQuote.expirationDate'),
      linkedClientStatus: row.linkedClientQuoteStatus,
      linkedClientQuoteExpiration: row.linkedClientQuoteExpiration,
      linkedOfferStatus: row.linkedOfferStatus,
      linkedOfferExpiration: row.linkedOfferExpiration,
    });
    snapshots.set(row.itemId, {
      supplierQuoteId: row.quoteId,
      supplierName: row.supplierName,
      productId: row.productId,
      unitPrice,
      netCost: unitPrice,
      sourceable: effective === 'draft' && row.linkedOrderId === null,
    });
  }
  return snapshots;
};

export const findItemsByIds = async (
  ids: string[],
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> => {
  if (ids.length === 0) return [];
  const rows = await exec
    .select()
    .from(supplierQuoteItems)
    .where(inArray(supplierQuoteItems.id, ids));
  return rows.map(mapItem);
};

export type SupplierItemSyncPatch = {
  itemId: string;
  quantity: number;
  unitCost: number;
  discountPercent: number;
};

// Client-driven pricing sync (issue #779, client → supplier direction): writes the new quantity
// and authoritative unit cost, recomputing the scale-2 list price so the stored "discount to us"
// remains as close as that scale permits. A 100% discount cannot express a non-zero cost, so it
// resets to 0 with listPrice = cost. Bumps the parent quote's updated_at like any content edit.
export const syncItemPricing = async (
  quoteId: string,
  patches: SupplierItemSyncPatch[],
  exec: DbExecutor = db,
): Promise<void> => {
  await Promise.all(
    patches.map((patch) => {
      const keepDiscount = patch.discountPercent < 100;
      const discountPercent = keepDiscount ? patch.discountPercent : 0;
      const listPrice = keepDiscount
        ? patch.unitCost / (1 - patch.discountPercent / 100)
        : patch.unitCost;
      const pricing = deriveSupplierLinePricing(listPrice, discountPercent);
      return exec
        .update(supplierQuoteItems)
        .set({
          quantity: numericForDb(patch.quantity),
          // Preserve the client-authored cost at supplier-unit scale. Re-deriving it from a
          // scale-2 list price could shift it (32.09 / 85% -> 37.75 -> 32.0875) and make the
          // client snapshot stale immediately after this atomic bidirectional sync.
          unitPrice: numericForDb(normalizeSupplierUnitPrice(patch.unitCost)),
          listPrice: numericForDb(pricing.listPrice),
          discountPercent: numericForDb(pricing.discountPercent),
        })
        .where(eq(supplierQuoteItems.id, patch.itemId));
    }),
  );
  await exec
    .update(supplierQuotes)
    .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(supplierQuotes.id, quoteId));
};

export const insertItems = async (
  quoteId: string,
  items: NewSupplierQuoteItem[],
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> => {
  if (items.length === 0) return [];
  const rows = await exec
    .insert(supplierQuoteItems)
    .values(
      items.map((item) => ({
        id: item.id,
        quoteId,
        productId: item.productId,
        productName: item.productName,
        quantity: numericForDb(item.quantity),
        listPrice: numericForDb(item.listPrice),
        discountPercent: numericForDb(item.discountPercent),
        unitPrice: numericForDb(item.unitPrice),
        note: item.note,
        unitType: item.unitType,
        // Duration applies to every line type (issue #775); 'na' marks a line that never multiplies
        // and is gated through effectiveDurationMonths, so the value is persisted verbatim here.
        durationMonths: item.durationMonths ?? 1,
        durationUnit: item.durationUnit ?? 'months',
      })),
    )
    .returning();
  return rows.map(mapItem);
};

export const replaceItems = async (
  quoteId: string,
  items: NewSupplierQuoteItem[],
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> =>
  runAtomically(exec, async (tx) => {
    await tx.delete(supplierQuoteItems).where(eq(supplierQuoteItems.quoteId, quoteId));
    return insertItems(quoteId, items, tx);
  });

// Identity-preserving counterpart of replaceItems for the PUT route (user report after #812):
// items whose id already belongs to this quote are UPDATED in place — keeping the id intact for
// the client lines' soft supplier_quote_item_id references AND keeping created_at, which drives
// the items' display order — while the rest of the payload is inserted fresh and persisted rows
// absent from the payload are deleted. The route refuses the delete for referenced ids before
// calling this; ids from other quotes (or duplicates) must be re-minted by the caller.
export const upsertItems = async (
  quoteId: string,
  items: NewSupplierQuoteItem[],
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> =>
  runAtomically(exec, async (tx) => {
    const existingRows = await tx
      .select({ id: supplierQuoteItems.id })
      .from(supplierQuoteItems)
      .where(eq(supplierQuoteItems.quoteId, quoteId));
    const existingIds = new Set(existingRows.map((row) => row.id));
    const incomingIds = items.map((item) => item.id);
    if (incomingIds.length > 0) {
      await tx
        .delete(supplierQuoteItems)
        .where(
          and(
            eq(supplierQuoteItems.quoteId, quoteId),
            notInArray(supplierQuoteItems.id, incomingIds),
          ),
        );
    }
    const inserts: NewSupplierQuoteItem[] = [];
    const updateWrites = items.flatMap((item) => {
      if (!existingIds.has(item.id)) {
        inserts.push(item);
        return [];
      }
      return [
        tx
          .update(supplierQuoteItems)
          .set({
            productId: item.productId,
            productName: item.productName,
            quantity: numericForDb(item.quantity),
            listPrice: numericForDb(item.listPrice),
            discountPercent: numericForDb(item.discountPercent),
            unitPrice: numericForDb(item.unitPrice),
            note: item.note,
            unitType: item.unitType,
            durationMonths: item.durationMonths ?? 1,
            durationUnit: item.durationUnit ?? 'months',
          })
          .where(and(eq(supplierQuoteItems.id, item.id), eq(supplierQuoteItems.quoteId, quoteId))),
      ];
    });
    await Promise.all(updateWrites);
    if (inserts.length > 0) await insertItems(quoteId, inserts, tx);
    return findItemsForQuote(quoteId, tx);
  });
