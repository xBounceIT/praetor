import type { DbExecutor } from '../db/drizzle.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import * as supplierQuoteVersionsRepo from '../repositories/supplierQuoteVersionsRepo.ts';

// Pre-state version snapshot shared by the supplier-quotes routes and the client→supplier item
// sync (issue #779) — one envelope (snapshot builder, reason, createdByUserId) so version
// histories restore identically no matter which write path minted them.
export const snapshotSupplierQuotePreState = async (
  quoteId: string,
  reason: supplierQuoteVersionsRepo.SupplierQuoteVersionReason,
  createdByUserId: string | null,
  tx: DbExecutor,
): Promise<void> => {
  const pre = await supplierQuotesRepo.findFullForSnapshot(quoteId, tx);
  if (!pre) return;
  await supplierQuoteVersionsRepo.insert(
    {
      quoteId,
      snapshot: supplierQuoteVersionsRepo.buildSnapshot(pre.quote, pre.items),
      reason,
      createdByUserId,
    },
    tx,
  );
};
