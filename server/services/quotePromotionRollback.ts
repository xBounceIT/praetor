import type { DbExecutor } from '../db/drizzle.ts';
import * as clientOffersRepo from '../repositories/clientOffersRepo.ts';
import * as clientQuotesRepo from '../repositories/clientQuotesRepo.ts';
import * as quoteCandidatesRepo from '../repositories/quoteCandidatesRepo.ts';
import * as quoteVersionsRepo from '../repositories/quoteVersionsRepo.ts';
import { effectiveQuoteStatusFromDate } from '../utils/quote-status.ts';

export class QuotePromotionRollbackError extends Error {
  constructor(
    message: string,
    readonly secondaryLabel: string,
  ) {
    super(message);
    this.name = 'QuotePromotionRollbackError';
  }
}

type RollbackQuotePromotionInput = {
  quoteId: string;
  offerId: string;
  createdByUserId: string | null;
  rejectExpiredOffer?: boolean;
};

export const rollbackQuotePromotion = async (
  input: RollbackQuotePromotionInput,
  tx: DbExecutor,
): Promise<void> => {
  const quote = await clientQuotesRepo.lockCurrentById(input.quoteId, tx);
  if (!quote) {
    throw new QuotePromotionRollbackError('Quote not found', 'quote_missing');
  }
  if (quote.status !== 'offer') {
    throw new QuotePromotionRollbackError(
      'Only a promoted quote can be rolled back',
      'quote_not_promoted',
    );
  }

  const offer = await clientOffersRepo.lockExistingById(input.offerId, tx);
  if (!offer) {
    throw new QuotePromotionRollbackError('Linked offer not found', 'linked_offer_missing');
  }
  if (
    offer.linkedQuoteId !== input.quoteId ||
    !offer.linkedQuoteCandidateId ||
    offer.status !== 'draft'
  ) {
    throw new QuotePromotionRollbackError(
      'Cannot roll back a quote whose linked offer is no longer a candidate draft',
      'linked_offer_not_draft',
    );
  }
  if (
    input.rejectExpiredOffer &&
    effectiveQuoteStatusFromDate(offer.status, offer.expirationDate) === 'expired'
  ) {
    throw new QuotePromotionRollbackError(
      'Expired offers are read-only and cannot be deleted; extend the expiration date instead',
      'expired_read_only',
    );
  }
  if (await clientOffersRepo.findLinkedSaleId(input.offerId, tx)) {
    throw new QuotePromotionRollbackError(
      'Cannot roll back a quote whose linked offer already has a sale order',
      'linked_offer_has_sale_order',
    );
  }

  const [preState, candidates] = await Promise.all([
    clientQuotesRepo.findFullForSnapshot(input.quoteId, tx),
    quoteCandidatesRepo.listForQuote(input.quoteId, tx),
  ]);
  const selected = candidates.find((candidate) => candidate.state === 'selected');
  if (!preState || !selected || selected.id !== offer.linkedQuoteCandidateId) {
    throw new QuotePromotionRollbackError(
      'The selected candidate no longer matches the linked offer',
      'selected_candidate_mismatch',
    );
  }

  await quoteVersionsRepo.insert(
    {
      quoteId: input.quoteId,
      snapshot: quoteVersionsRepo.buildSnapshot(preState.quote, preState.items, candidates),
      reason: 'update',
      createdByUserId: input.createdByUserId,
    },
    tx,
  );
  await clientOffersRepo.deleteById(input.offerId, tx);
  await quoteCandidatesRepo.reactivateAll(input.quoteId, tx);
  await clientQuotesRepo.update(
    input.quoteId,
    {
      status: 'draft',
      paymentTerms: selected.paymentTerms,
      discount: selected.discount,
      discountType: selected.discountType,
      expirationDate: selected.expirationDate,
      communicationChannelId: selected.communicationChannelId,
      notes: selected.notes,
    },
    tx,
  );
};
