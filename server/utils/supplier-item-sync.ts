import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DbExecutor } from '../db/drizzle.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import { logAudit } from './audit.ts';
import { requestHasPermission } from './permissions.ts';
import { effectiveSupplierQuoteStatusFromDate, isFrozenEffectiveStatus } from './quote-status.ts';
import { replyError } from './replyError.ts';
import { snapshotSupplierQuotePreState } from './supplier-quote-version.ts';

// One client line's supplier-relevant fields, as both the quote and offer routes normalize them.
export type ClientLineSyncInput = {
  supplierQuoteItemId: string | null;
  quantity: number;
  // The line's live unit cost for supplier-sourced lines — what the supplier item must become.
  supplierQuoteUnitPrice: number | null;
};

// The document's PREVIOUS stored lines. Keyed by supplierQuoteItemId below: offer items get
// fresh row ids on every replaceItems write, so the supplier link is the only correlation key
// that is stable across saves on both routes.
export type PreviousClientLine = ClientLineSyncInput;

// One entry per supplier quote the sync rewrote; the routes log these AFTER the transaction
// commits — logAudit writes through the global pool, so an in-tx call would survive a rollback
// and record mutations that never happened.
export type SupplierItemSyncAudit = { supplierQuoteId: string; sourceAction: string };

// Raised instead of writing when the sync would violate a supplier-quote invariant; the routes
// map it onto their replyError envelope (the transaction rolls back, so the client document
// write is rejected together with the supplier write — never half-applied).
export class SupplierItemSyncError extends Error {
  readonly statusCode: 403 | 409;
  readonly secondaryLabel: string;
  readonly supplierQuoteId: string | null;

  constructor(
    statusCode: 403 | 409,
    secondaryLabel: string,
    supplierQuoteId: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'SupplierItemSyncError';
    this.statusCode = statusCode;
    this.secondaryLabel = secondaryLabel;
    this.supplierQuoteId = supplierQuoteId;
  }
}

// Maps the sync error onto the routes' replyError envelope — shared so the two PUT routes
// (client quotes/offers) can't drift apart on the contract for the identical shared failure.
export const replySupplierItemSyncError = (
  request: FastifyRequest,
  reply: FastifyReply,
  err: SupplierItemSyncError,
  entity: { entityType: 'client_quote' | 'client_offer'; entityId: string },
) =>
  replyError(request, reply, {
    statusCode: err.statusCode,
    message: err.message,
    action: `${entity.entityType}.update.${err.statusCode === 403 ? 'forbidden' : 'conflict'}`,
    entityType: entity.entityType,
    entityId: entity.entityId,
    details: {
      secondaryLabel: err.secondaryLabel,
      targetLabel: err.supplierQuoteId ?? undefined,
    },
  });

// Logs the audit entries returned by the sync. Call AFTER the transaction commits — logAudit
// writes through the global pool, so an in-tx call would survive a rollback and record
// mutations that never happened.
export const logSupplierItemSyncAudits = async (
  request: FastifyRequest,
  audits: SupplierItemSyncAudit[],
): Promise<void> => {
  for (const sync of audits) {
    await logAudit({
      request,
      action: 'supplier_quote.updated',
      entityType: 'supplier_quote',
      entityId: sync.supplierQuoteId,
      details: {
        targetLabel: sync.supplierQuoteId,
        secondaryLabel: 'synced_from_client_line',
        changedFields: ['items'],
        reason: sync.sourceAction,
      },
    });
  }
};

// Bidirectional sync, client → supplier direction (issue #779): when an editable client quote or
// offer saves lines that reference supplier quote items, GENUINE edits to quantity and unit cost
// are retroactively pushed onto those supplier items. "Genuine" means BOTH of:
//   - the link existed before this save (a freshly picked link starts from server-resolved
//     supplier values and never writes back — pushing the client's copy would let a stale
//     browser cache revert newer supplier pricing), and
//   - quantity/cost differ from the line's own previous stored values (a re-save of a stale
//     snapshot — e.g. a notes-only edit while the "old info" chip is showing — must not revert
//     direct supplier-side edits).
// The cost write keeps the item's stored "discount to us" meaningful by recomputing the list
// price so that listPrice × (1 − discount/100) equals the new cost. Guards mirror the
// supplier-quotes PUT freeze: order-locked and frozen (accepted/denied/expired) supplier quotes
// are content-read-only and raise a 409 instead of silently diverging; live states
// (draft/sent/offer) accept the sync — the linked client document is the source of truth while
// the pipeline is open. The write also requires the supplier-quote update permission: the
// client-document grant alone must not smuggle supplier-quote write capability.
// Each touched supplier quote gets a pre-state version snapshot; audit entries are returned for
// the caller to log AFTER commit. Must run inside the caller's transaction so the client write
// and the supplier sync commit atomically.
export const syncSupplierItemsFromClientLines = async (
  request: FastifyRequest,
  sourceAction: string,
  lines: ClientLineSyncInput[],
  previousLines: PreviousClientLine[],
  tx: DbExecutor,
): Promise<SupplierItemSyncAudit[]> => {
  // ALL previous lines per link (not just the first): a document can hold several lines sourcing
  // the same supplier item with different stored quantities/costs, and row ids are regenerated on
  // every save, so values are the only way to tell "this line is unchanged". Comparing against
  // just the first previous row turned a notes-only re-save of the second line into a phantom
  // genuine edit — wrongly pushing its values onto the supplier item or tripping the
  // permission/read-only guards (#812 round 21).
  const prevsByLink = new Map<string, PreviousClientLine[]>();
  for (const prev of previousLines) {
    if (!prev.supplierQuoteItemId || prev.supplierQuoteUnitPrice === null) continue;
    const list = prevsByLink.get(prev.supplierQuoteItemId);
    if (list) list.push(prev);
    else prevsByLink.set(prev.supplierQuoteItemId, [prev]);
  }

  const wanted = new Map<string, { quantity: number; cost: number }>();
  for (const line of lines) {
    if (!line.supplierQuoteItemId || line.supplierQuoteUnitPrice === null) continue;
    const prevs = prevsByLink.get(line.supplierQuoteItemId);
    if (!prevs) continue;
    const target = {
      quantity: Number(line.quantity) || 0,
      cost: Number(line.supplierQuoteUnitPrice),
    };
    // Unchanged if ANY previous line with this link carries exactly these values.
    if (
      prevs.some(
        (prev) => prev.quantity === target.quantity && prev.supplierQuoteUnitPrice === target.cost,
      )
    )
      continue;
    const queued = wanted.get(line.supplierQuoteItemId);
    if (queued) {
      // Two lines sourcing the same supplier item with diverging edits cannot both win; a silent
      // last-write would leave the loser permanently flagged stale and ping-pong on every save.
      if (queued.quantity !== target.quantity || queued.cost !== target.cost) {
        throw new SupplierItemSyncError(
          409,
          'conflicting_line_edits',
          null,
          `Two lines reference supplier quote item "${line.supplierQuoteItemId}" with different quantities or costs`,
        );
      }
      continue;
    }
    wanted.set(line.supplierQuoteItemId, target);
  }
  if (wanted.size === 0) return [];

  const items = await supplierQuotesRepo.findItemsByIds(Array.from(wanted.keys()), tx);
  const changedByQuote = new Map<string, supplierQuotesRepo.SupplierItemSyncPatch[]>();
  for (const item of items) {
    const target = wanted.get(item.id);
    if (!target) continue;
    // Already current (e.g. the save follows an "old info" refresh-pull) — no write needed, so
    // the freeze guards below must not fire either.
    if (item.quantity === target.quantity && item.unitPrice === target.cost) continue;
    const patches = changedByQuote.get(item.quoteId) ?? [];
    patches.push({
      itemId: item.id,
      quantity: target.quantity,
      unitCost: target.cost,
      discountPercent: item.discountPercent,
    });
    changedByQuote.set(item.quoteId, patches);
  }
  if (changedByQuote.size === 0) return [];

  if (!requestHasPermission(request, 'sales.supplier_quotes.update')) {
    throw new SupplierItemSyncError(
      403,
      'supplier_quote_permission_required',
      null,
      'Editing supplier-sourced line quantities or costs requires supplier quote update permission',
    );
  }

  const audits: SupplierItemSyncAudit[] = [];
  for (const [quoteId, patches] of changedByQuote) {
    // SELECT ... FOR UPDATE: serializes with the supplier-order creation paths, which lock the
    // same row before deciding the quote is order-free — a plain read here would let a
    // concurrent order creation and this sync both commit (order-locked quote whose pricing no
    // longer matches the order).
    const lock = await supplierQuotesRepo.lockEffectiveStatusById(quoteId, tx);
    if (!lock) continue; // quote deleted concurrently — its items are gone with it
    const linkedOrderId = await supplierQuotesRepo.findLinkedOrderId(quoteId, tx);
    if (linkedOrderId) {
      throw new SupplierItemSyncError(
        409,
        'order_exists',
        quoteId,
        `Supplier quote "${quoteId}" pricing is final (an order exists); sourced line quantities and costs cannot change`,
      );
    }
    const effectiveStatus = effectiveSupplierQuoteStatusFromDate(lock);
    if (isFrozenEffectiveStatus(effectiveStatus)) {
      throw new SupplierItemSyncError(
        409,
        'supplier_quote_read_only',
        quoteId,
        `Supplier quote "${quoteId}" is ${effectiveStatus} and read-only; sourced line quantities and costs cannot change`,
      );
    }
    await snapshotSupplierQuotePreState(quoteId, 'update', request.user?.id ?? null, tx);
    await supplierQuotesRepo.syncItemPricing(quoteId, patches, tx);
    audits.push({ supplierQuoteId: quoteId, sourceAction });
  }
  return audits;
};
