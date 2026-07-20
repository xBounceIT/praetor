import type { DbExecutor } from '../db/drizzle.ts';
import * as clientOffersRepo from '../repositories/clientOffersRepo.ts';
import * as clientQuotesRepo from '../repositories/clientQuotesRepo.ts';
import * as offerVersionsRepo from '../repositories/offerVersionsRepo.ts';
import * as quoteCandidatesRepo from '../repositories/quoteCandidatesRepo.ts';
import * as quoteVersionsRepo from '../repositories/quoteVersionsRepo.ts';
import type {
  OfferRevision,
  QuoteRevision,
  SupplierQuoteRevision,
} from '../repositories/revisionsRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import * as supplierQuoteVersionsRepo from '../repositories/supplierQuoteVersionsRepo.ts';
import { isTerminalQuoteStatus } from '../utils/quote-status.ts';

export class RevisionRestoreConflict extends Error {
  constructor(
    message: string,
    public readonly secondaryLabel: string,
  ) {
    super(message);
  }
}

export const restoreQuoteRevision = async (
  quoteId: string,
  revision: QuoteRevision,
  createdByUserId: string | null,
  tx: DbExecutor,
) => {
  const locked = await clientQuotesRepo.lockCurrentById(quoteId, tx);
  if (!locked) return null;
  if (isTerminalQuoteStatus(locked.status)) {
    throw new RevisionRestoreConflict(
      'Accepted or rejected quotes are read-only',
      'terminal_read_only',
    );
  }
  if (
    (await clientOffersRepo.findExistingForQuote(quoteId, tx)) ||
    (await clientQuotesRepo.findAnyLinkedSale(quoteId, tx))
  ) {
    throw new RevisionRestoreConflict(
      'Cannot restore a quote with an existing offer or sale order',
      'downstream_document_exists',
    );
  }
  const [current, currentCandidates] = await Promise.all([
    clientQuotesRepo.findFullForSnapshot(quoteId, tx),
    quoteCandidatesRepo.listForQuote(quoteId, tx),
  ]);
  if (!current) return null;
  const snapshot = quoteVersionsRepo.normalizeSnapshot(revision.snapshot);
  if (snapshot.candidates.length === 0) {
    throw new RevisionRestoreConflict(
      'Snapshot candidate family is empty',
      'snapshot_candidates_missing',
    );
  }
  const candidateIds = new Set(snapshot.candidates.map((candidate) => candidate.id));
  if (
    snapshot.candidates.some(
      (candidate) => !candidate.expirationDate || !candidate.communicationChannelId,
    ) ||
    snapshot.items.some((item) => !candidateIds.has(item.candidateId))
  ) {
    throw new RevisionRestoreConflict('Snapshot candidate data is incomplete', 'snapshot_invalid');
  }
  await quoteVersionsRepo.insert(
    {
      quoteId,
      snapshot: quoteVersionsRepo.buildSnapshot(current.quote, current.items, currentCandidates),
      reason: 'restore',
      createdByUserId,
    },
    tx,
  );

  const header = snapshot.quote;
  const restored = await clientQuotesRepo.restoreSnapshotQuote(
    quoteId,
    {
      clientId: header.clientId,
      clientName: header.clientName,
      paymentTerms: header.paymentTerms ?? 'immediate',
      discount: header.discount,
      discountType: header.discountType,
      status: 'draft',
      expirationDate: header.expirationDate ?? '',
      communicationChannelId: header.communicationChannelId ?? '',
      notes: header.notes,
    },
    tx,
  );
  if (!restored) return null;

  await quoteCandidatesRepo.deleteAllForQuote(quoteId, tx);
  for (const candidate of snapshot.candidates) {
    await quoteCandidatesRepo.insert(
      {
        id: candidate.id,
        quoteId,
        name: candidate.name,
        position: candidate.position,
        state: 'active',
        paymentTerms: candidate.paymentTerms,
        discount: candidate.discount,
        discountType: candidate.discountType,
        expirationDate: candidate.expirationDate,
        communicationChannelId: candidate.communicationChannelId,
        notes: candidate.notes,
      },
      tx,
    );
    const items = snapshot.items
      .filter((item) => item.candidateId === candidate.id)
      .map((item, position) => ({ ...item, position }));
    await clientQuotesRepo.replaceItems(quoteId, items, tx, candidate.id);
  }
  return clientQuotesRepo.findById(quoteId, tx);
};

export const restoreOfferRevision = async (
  offerId: string,
  revision: OfferRevision,
  createdByUserId: string | null,
  tx: DbExecutor,
) => {
  const locked = await clientOffersRepo.lockExistingById(offerId, tx);
  if (!locked) return null;
  if (locked.status === 'accepted' || locked.status === 'denied') {
    throw new RevisionRestoreConflict(
      'Accepted or denied offers cannot be restored into draft',
      'terminal_read_only',
    );
  }
  if (await clientOffersRepo.findLinkedSaleId(offerId, tx)) {
    throw new RevisionRestoreConflict(
      'Cannot restore an offer with an existing sale order',
      'sale_order_exists',
    );
  }
  const current = await clientOffersRepo.findFullForSnapshot(offerId, tx);
  if (!current) return null;
  if (!revision.snapshot.offer.expirationDate) {
    throw new RevisionRestoreConflict(
      'Snapshot expiration date is missing',
      'snapshot_expiration_missing',
    );
  }
  await offerVersionsRepo.insert(
    {
      offerId,
      snapshot: offerVersionsRepo.buildSnapshot(current.offer, current.items),
      reason: 'restore',
      createdByUserId,
    },
    tx,
  );
  const header = revision.snapshot.offer;
  const restored = await clientOffersRepo.restoreSnapshotOffer(
    offerId,
    {
      clientId: header.clientId,
      clientName: header.clientName,
      paymentTerms: header.paymentTerms ?? 'immediate',
      discount: header.discount,
      discountType: header.discountType,
      status: 'draft',
      deliveryDate: header.deliveryDate,
      expirationDate: header.expirationDate ?? '',
      notes: header.notes,
    },
    tx,
  );
  if (!restored) return null;
  await clientOffersRepo.replaceItems(
    offerId,
    revision.snapshot.items.map((item) => ({ ...item })),
    tx,
  );
  return (await clientOffersRepo.findFullForSnapshot(offerId, tx))?.offer ?? null;
};

export const restoreSupplierQuoteRevision = async (
  quoteId: string,
  revision: SupplierQuoteRevision,
  createdByUserId: string | null,
  tx: DbExecutor,
) => {
  if (!(await supplierQuotesRepo.lockEffectiveStatusById(quoteId, tx))) return null;
  if (await supplierQuotesRepo.findLinkedOrderId(quoteId, tx)) {
    throw new RevisionRestoreConflict(
      'Cannot restore a supplier quote with an existing order',
      'supplier_order_exists',
    );
  }
  const current = await supplierQuotesRepo.findFullForSnapshot(quoteId, tx);
  if (!current) return null;
  if (!revision.snapshot.quote.expirationDate || !revision.snapshot.quote.communicationChannelId) {
    throw new RevisionRestoreConflict(
      'Snapshot expiration date or communication channel is missing',
      'snapshot_invalid',
    );
  }
  const sourcedIds = await supplierQuotesRepo.findSourcedItemIds(quoteId, tx);
  const currentById = new Map(current.items.map((item) => [item.id, item]));
  const targetById = new Map(revision.snapshot.items.map((item) => [item.id, item]));
  for (const sourcedId of sourcedIds) {
    const existing = currentById.get(sourcedId);
    const target = targetById.get(sourcedId);
    if (!existing || !target || existing.productId !== target.productId) {
      throw new RevisionRestoreConflict(
        'Cannot remove or repoint supplier quote items used by client documents',
        'sourced_item_changed',
      );
    }
  }
  await supplierQuoteVersionsRepo.insert(
    {
      quoteId,
      snapshot: supplierQuoteVersionsRepo.buildSnapshot(current.quote, current.items),
      reason: 'restore',
      createdByUserId,
    },
    tx,
  );
  const header = revision.snapshot.quote;
  const restored = await supplierQuotesRepo.restoreSnapshotQuote(
    quoteId,
    {
      supplierId: header.supplierId,
      supplierName: header.supplierName,
      clientId: header.clientId,
      clientName: header.clientName,
      paymentTerms: header.paymentTerms ?? 'immediate',
      status: 'draft',
      expirationDate: header.expirationDate ?? '',
      communicationChannelId: header.communicationChannelId ?? '',
      notes: header.notes,
    },
    tx,
  );
  if (!restored) return null;
  await supplierQuotesRepo.upsertItems(
    quoteId,
    revision.snapshot.items.map((item) => ({ ...item })),
    tx,
  );
  return supplierQuotesRepo.findById(quoteId, tx);
};
