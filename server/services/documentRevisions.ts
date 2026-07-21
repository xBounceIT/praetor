import type { DbExecutor } from '../db/drizzle.ts';
import * as clientOffersRepo from '../repositories/clientOffersRepo.ts';
import * as clientQuotesRepo from '../repositories/clientQuotesRepo.ts';
import * as offerVersionsRepo from '../repositories/offerVersionsRepo.ts';
import * as quoteCandidatesRepo from '../repositories/quoteCandidatesRepo.ts';
import * as quoteVersionsRepo from '../repositories/quoteVersionsRepo.ts';
import * as revisionCodeTemplateRepo from '../repositories/revisionCodeTemplateRepo.ts';
import * as revisionsRepo from '../repositories/revisionsRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import * as supplierQuoteVersionsRepo from '../repositories/supplierQuoteVersionsRepo.ts';
import { effectiveSupplierQuoteStatusFromDate } from '../utils/quote-status.ts';
import { renderRevisionCode } from '../utils/revision-codes.ts';

export type AllocatedRevision = { revisionNumber: number; revisionCode: string };
export type SupplierRevisionState = Map<string, string>;

const effectiveLockedSupplierStatus = (
  locked: NonNullable<Awaited<ReturnType<typeof supplierQuotesRepo.lockEffectiveStatusById>>>,
) =>
  effectiveSupplierQuoteStatusFromDate({
    expirationDate: locked.expirationDate,
    linkedClientStatus: locked.linkedClientStatus,
    linkedClientQuoteExpiration: locked.linkedClientQuoteExpiration,
    linkedOfferStatus: locked.linkedOfferStatus,
    linkedOfferExpiration: locked.linkedOfferExpiration,
  });

export const lockSupplierRevisionStates = async (
  supplierQuoteIds: string[],
  exec: DbExecutor,
): Promise<SupplierRevisionState> => {
  const states = new Map<string, string>();
  for (const id of [...new Set(supplierQuoteIds)].sort()) {
    const locked = await supplierQuotesRepo.lockEffectiveStatusById(id, exec);
    if (locked) states.set(id, effectiveLockedSupplierStatus(locked));
  }
  return states;
};

export const createDerivedSupplierRevisions = async (
  previousStates: SupplierRevisionState,
  createdByUserId: string | null,
  exec: DbExecutor,
): Promise<void> => {
  for (const [quoteId, previousStatus] of previousStates) {
    if (previousStatus !== 'draft') continue;
    const current = await supplierQuotesRepo.lockEffectiveStatusById(quoteId, exec);
    if (current && effectiveLockedSupplierStatus(current) === 'sent') {
      await createSupplierQuoteRevisionIfChanged(quoteId, createdByUserId, exec);
    }
  }
};

const serialize = (value: unknown) => JSON.stringify(value);

export const nextRevisionNumber = (reservedMaximum: number) => reservedMaximum + 1;

const canonicalQuote = (snapshot: quoteVersionsRepo.QuoteVersionSnapshot) => {
  const normalized = quoteVersionsRepo.normalizeSnapshot(snapshot);
  const candidateIndex = new Map(
    normalized.candidates.map((candidate, index) => [candidate.id, index]),
  );
  const quote = normalized.quote;
  return {
    quote: {
      clientId: quote.clientId,
      clientName: quote.clientName,
      paymentTerms: quote.paymentTerms,
      discount: quote.discount,
      discountType: quote.discountType,
      expirationDate: quote.expirationDate,
      communicationChannelId: quote.communicationChannelId,
      notes: quote.notes,
    },
    candidates: normalized.candidates.map((candidate) => ({
      name: candidate.name,
      position: candidate.position,
      state: candidate.state,
      paymentTerms: candidate.paymentTerms,
      discount: candidate.discount,
      discountType: candidate.discountType,
      expirationDate: candidate.expirationDate,
      communicationChannelId: candidate.communicationChannelId,
      notes: candidate.notes,
    })),
    items: normalized.items.map((item) => ({
      candidate: candidateIndex.get(item.candidateId) ?? -1,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      productCost: item.productCost,
      productMolPercentage: item.productMolPercentage,
      supplierQuoteId: item.supplierQuoteId,
      supplierQuoteItemId: item.supplierQuoteItemId,
      supplierQuoteSupplierName: item.supplierQuoteSupplierName,
      supplierQuoteUnitPrice: item.supplierQuoteUnitPrice,
      discount: item.discount,
      note: item.note,
      unitType: item.unitType,
      durationMonths: item.durationMonths,
      durationUnit: item.durationUnit,
    })),
  };
};

const canonicalOffer = (snapshot: offerVersionsRepo.OfferVersionSnapshot) => ({
  offer: {
    linkedQuoteId: snapshot.offer.linkedQuoteId,
    linkedQuoteCandidateId: snapshot.offer.linkedQuoteCandidateId ?? null,
    clientId: snapshot.offer.clientId,
    clientName: snapshot.offer.clientName,
    paymentTerms: snapshot.offer.paymentTerms,
    discount: snapshot.offer.discount,
    discountType: snapshot.offer.discountType,
    deliveryDate: snapshot.offer.deliveryDate,
    expirationDate: snapshot.offer.expirationDate,
    notes: snapshot.offer.notes,
  },
  items: snapshot.items.map(({ id: _id, offerId: _offerId, ...item }) => item),
});

const canonicalSupplierQuote = (
  snapshot: supplierQuoteVersionsRepo.SupplierQuoteVersionSnapshot,
) => ({
  quote: {
    supplierId: snapshot.quote.supplierId,
    supplierName: snapshot.quote.supplierName,
    clientId: snapshot.quote.clientId,
    clientName: snapshot.quote.clientName,
    paymentTerms: snapshot.quote.paymentTerms,
    expirationDate: snapshot.quote.expirationDate,
    communicationChannelId: snapshot.quote.communicationChannelId,
    notes: snapshot.quote.notes,
  },
  items: snapshot.items.map(({ id: _id, quoteId: _quoteId, ...item }) => item),
});

export const quoteRevisionContentEqual = (
  left: quoteVersionsRepo.QuoteVersionSnapshot,
  right: quoteVersionsRepo.QuoteVersionSnapshot,
) => serialize(canonicalQuote(left)) === serialize(canonicalQuote(right));

export const offerRevisionContentEqual = (
  left: offerVersionsRepo.OfferVersionSnapshot,
  right: offerVersionsRepo.OfferVersionSnapshot,
) => serialize(canonicalOffer(left)) === serialize(canonicalOffer(right));

export const supplierQuoteRevisionContentEqual = (
  left: supplierQuoteVersionsRepo.SupplierQuoteVersionSnapshot,
  right: supplierQuoteVersionsRepo.SupplierQuoteVersionSnapshot,
) => serialize(canonicalSupplierQuote(left)) === serialize(canonicalSupplierQuote(right));

const allocate = async (currentNumber: number, exec: DbExecutor) => {
  const revisionNumber = nextRevisionNumber(currentNumber);
  const config = await revisionCodeTemplateRepo.get(exec);
  return { revisionNumber, revisionCode: renderRevisionCode(config, revisionNumber) };
};

export const createQuoteRevisionIfChanged = async (
  quoteId: string,
  createdByUserId: string | null,
  exec: DbExecutor,
): Promise<AllocatedRevision | null> => {
  const [current, candidates, latest] = await Promise.all([
    clientQuotesRepo.findFullForSnapshot(quoteId, exec),
    quoteCandidatesRepo.listForQuote(quoteId, exec),
    revisionsRepo.latestQuote(quoteId, exec),
  ]);
  if (!current) return null;
  const snapshot = quoteVersionsRepo.buildSnapshot(current.quote, current.items, candidates);
  if (latest && quoteRevisionContentEqual(latest.snapshot, snapshot)) {
    return null;
  }
  const allocated = await allocate(current.quote.revisionNumber, exec);
  await revisionsRepo.insertQuoteAndAdvance(
    { objectId: quoteId, ...allocated, snapshot, createdByUserId },
    exec,
  );
  return allocated;
};

export const createOfferRevisionIfChanged = async (
  offerId: string,
  createdByUserId: string | null,
  exec: DbExecutor,
): Promise<AllocatedRevision | null> => {
  const [current, latest] = await Promise.all([
    clientOffersRepo.findFullForSnapshot(offerId, exec),
    revisionsRepo.latestOffer(offerId, exec),
  ]);
  if (!current) return null;
  const snapshot = offerVersionsRepo.buildSnapshot(current.offer, current.items);
  if (latest && offerRevisionContentEqual(latest.snapshot, snapshot)) {
    return null;
  }
  const allocated = await allocate(current.offer.revisionNumber, exec);
  await revisionsRepo.insertOfferAndAdvance(
    { objectId: offerId, ...allocated, snapshot, createdByUserId },
    exec,
  );
  return allocated;
};

export const createSupplierQuoteRevisionIfChanged = async (
  quoteId: string,
  createdByUserId: string | null,
  exec: DbExecutor,
): Promise<AllocatedRevision | null> => {
  const [current, latest] = await Promise.all([
    supplierQuotesRepo.findFullForSnapshot(quoteId, exec),
    revisionsRepo.latestSupplierQuote(quoteId, exec),
  ]);
  if (!current) return null;
  const snapshot = supplierQuoteVersionsRepo.buildSnapshot(current.quote, current.items);
  if (latest && supplierQuoteRevisionContentEqual(latest.snapshot, snapshot)) {
    return null;
  }
  const allocated = await allocate(current.quote.revisionNumber, exec);
  await revisionsRepo.insertSupplierQuoteAndAdvance(
    { objectId: quoteId, ...allocated, snapshot, createdByUserId },
    exec,
  );
  return allocated;
};
