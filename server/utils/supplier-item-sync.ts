import type { FastifyRequest } from 'fastify';
import type { DbExecutor } from '../db/drizzle.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import * as supplierQuoteVersionsRepo from '../repositories/supplierQuoteVersionsRepo.ts';
import { logAudit } from './audit.ts';

// One client line's supplier-relevant fields, as both the quote and offer routes normalize them.
export type ClientLineSyncInput = {
  supplierQuoteItemId: string | null;
  quantity: number;
  // The line's live unit cost for supplier-sourced lines — what the supplier item must become.
  supplierQuoteUnitPrice: number | null;
};

// Bidirectional sync, client → supplier direction (issue #779): when an editable client quote or
// offer saves lines that reference supplier quote items, the edits to quantity and unit cost are
// retroactively pushed onto those supplier items. The cost write keeps the item's stored
// "discount to us" meaningful by recomputing the list price so that
// listPrice × (1 − discount/100) equals the new cost. Supplier quotes that already have a linked
// ORDER are skipped entirely — their procurement pricing is final (the UI locks those lines too).
// Each touched supplier quote gets a pre-state version snapshot and an audit entry. Must run
// inside the caller's transaction so the client write and the supplier sync commit atomically.
export const syncSupplierItemsFromClientLines = async (
  request: FastifyRequest,
  sourceAction: string,
  lines: ClientLineSyncInput[],
  tx: DbExecutor,
): Promise<void> => {
  const wanted = new Map<string, { quantity: number; cost: number }>();
  for (const line of lines) {
    if (!line.supplierQuoteItemId || line.supplierQuoteUnitPrice === null) continue;
    wanted.set(line.supplierQuoteItemId, {
      quantity: Number(line.quantity) || 0,
      cost: Number(line.supplierQuoteUnitPrice),
    });
  }
  if (wanted.size === 0) return;

  const items = await supplierQuotesRepo.findItemsByIds(Array.from(wanted.keys()), tx);
  const changedByQuote = new Map<string, supplierQuotesRepo.SupplierItemSyncPatch[]>();
  for (const item of items) {
    const target = wanted.get(item.id);
    if (!target) continue;
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

  for (const [quoteId, patches] of changedByQuote) {
    const linkedOrderId = await supplierQuotesRepo.findLinkedOrderId(quoteId, tx);
    if (linkedOrderId) continue;
    const pre = await supplierQuotesRepo.findFullForSnapshot(quoteId, tx);
    if (pre) {
      await supplierQuoteVersionsRepo.insert(
        {
          quoteId,
          snapshot: supplierQuoteVersionsRepo.buildSnapshot(pre.quote, pre.items),
          reason: 'update',
          createdByUserId: request.user?.id ?? null,
        },
        tx,
      );
    }
    await supplierQuotesRepo.syncItemPricing(quoteId, patches, tx);
    await logAudit({
      request,
      action: 'supplier_quote.updated',
      entityType: 'supplier_quote',
      entityId: quoteId,
      details: {
        targetLabel: quoteId,
        secondaryLabel: 'synced_from_client_line',
        changedFields: ['items'],
        reason: sourceAction,
      },
    });
  }
};
