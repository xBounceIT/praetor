import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type DbExecutor, withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as clientOffersRepo from '../repositories/clientOffersRepo.ts';
import * as clientQuotesRepo from '../repositories/clientQuotesRepo.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import * as productsRepo from '../repositories/productsRepo.ts';
import * as quoteCandidatesRepo from '../repositories/quoteCandidatesRepo.ts';
import * as quoteCommunicationChannelsRepo from '../repositories/quoteCommunicationChannelsRepo.ts';
import * as quoteVersionsRepo from '../repositories/quoteVersionsRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import { clientOfferSchema } from '../schemas/clientOffers.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import {
  createDocumentDiscountConstraint,
  documentDiscountTypeSchema,
  documentDiscountValueSchema,
  updateDocumentDiscountConstraint,
} from '../schemas/documentDiscount.ts';
import {
  allocateDocumentCode,
  reserveDocumentCodeCounterFromCode,
} from '../services/documentCodes.ts';
import {
  QuotePromotionRollbackError,
  rollbackQuotePromotion,
} from '../services/quotePromotionRollback.ts';
import { logAudit } from '../utils/audit.ts';
import {
  calculateClientLineMol,
  withCalculatedClientLineMol,
} from '../utils/client-line-pricing.ts';
import { isPastLocalDate } from '../utils/date.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { replyDocumentCodeCollision } from '../utils/document-code-replies.ts';
import { type DurationUnit, effectiveDurationMonths } from '../utils/duration-unit.ts';
import { getDocumentDiscountAmount } from '../utils/invoice-math.ts';
import { normalizeNullableString } from '../utils/normalize.ts';
import { generatePrefixedId, ITEM_ID_PREFIXES } from '../utils/order-ids.ts';
import {
  canTransitionClientQuote,
  effectiveQuoteStatusFromDate,
  isTerminalQuoteStatus,
  normalizeQuoteStatus,
  parseQuoteStatusInput,
  type QuotePipelineStatus,
} from '../utils/quote-status.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import {
  logSupplierItemSyncAudits,
  type PreviousClientLine,
  replySupplierItemSyncError,
  type SupplierItemSyncAudit,
  SupplierItemSyncError,
  syncSupplierItemsFromClientLines,
} from '../utils/supplier-item-sync.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';
import {
  badRequest,
  optionalDateString,
  optionalDurationMonths,
  optionalDurationUnit,
  optionalLocalizedDocumentDiscount,
  optionalLocalizedNonNegativeNumber,
  optionalLocalizedNumber,
  optionalLocalizedPercentage,
  optionalNonEmptyString,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  parseLocalizedPositiveNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

const MAX_CANDIDATE_NAME_LENGTH = 100;

type IncomingQuoteItem = {
  id?: string;
  productId: string | null;
  productName: string;
  supplierQuoteItemId?: string | null;
  quantity: number;
  unitPrice: number;
  productCost: number | null;
  productMolPercentage: number | null;
  // The line's live unit cost for supplier-sourced lines — client-authoritative on edits of an
  // existing link (issue #779 bidirectional sync); server-resolved on new links.
  supplierQuoteUnitPrice?: number | null;
  // Pick-time supplier values (request-only, never persisted): the genuine-edit baseline for a
  // FRESH link — the editor stamps them when the link is picked/refreshed, so a quantity/cost
  // edited before the first save is recognized as a deliberate edit (kept on the line and pushed
  // onto the supplier item) instead of being overwritten by the server snapshot.
  supplierQuoteBaseQuantity?: number | null;
  supplierQuoteBaseUnitPrice?: number | null;
  discount: number;
  note?: string | null;
  unitType?: UnitType;
  durationMonths: number;
  durationUnit: DurationUnit;
};

type QuoteItemSnapshot = {
  productCost: number;
  productMolPercentage: number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
};

type ResolvedQuoteItem = IncomingQuoteItem & QuoteItemSnapshot;

const indexExistingQuoteItems = (
  snapshots: clientQuotesRepo.ExistingQuoteItemSnapshot[],
  candidateId?: string,
): Map<string, IncomingQuoteItem & QuoteItemSnapshot> => {
  const indexed = new Map<string, IncomingQuoteItem & QuoteItemSnapshot>();
  for (const snapshot of snapshots) {
    if (candidateId !== undefined && snapshot.candidateId !== candidateId) continue;
    indexed.set(snapshot.id, {
      id: snapshot.id,
      productId: snapshot.productId,
      productName: '',
      quantity: snapshot.quantity,
      unitPrice: 0,
      discount: 0,
      // These placeholders only support the cost/MOL retained-line comparison; duration and
      // the remaining commercial fields always come from the submitted candidate line.
      durationMonths: 1,
      durationUnit: 'months',
      productCost: snapshot.productCost,
      productMolPercentage: snapshot.productMolPercentage,
      supplierQuoteId: snapshot.supplierQuoteId,
      supplierQuoteItemId: snapshot.supplierQuoteItemId,
      supplierQuoteSupplierName: snapshot.supplierQuoteSupplierName,
      supplierQuoteUnitPrice: snapshot.supplierQuoteUnitPrice,
      unitType: snapshot.unitType,
    });
  }
  return indexed;
};

const isCandidateFamilyExpired = (
  candidates: quoteCandidatesRepo.QuoteCandidate[],
  fallbackExpired: boolean,
): boolean => {
  const activeCandidates = candidates.filter((candidate) => candidate.state === 'active');
  return activeCandidates.length > 0
    ? activeCandidates.every(
        (candidate) =>
          typeof candidate.expirationDate === 'string' && isPastLocalDate(candidate.expirationDate),
      )
    : fallbackExpired;
};

const effectiveCandidateFamilyStatus = (
  status: string,
  expirationDate: string | null,
  candidates: Array<{ state: string; expirationDate: string }>,
) => {
  const normalizedStatus = normalizeQuoteStatus(status);
  if (isTerminalQuoteStatus(status)) return normalizedStatus;

  const activeCandidates = candidates.filter((candidate) => candidate.state === 'active');
  if (activeCandidates.length > 0) {
    return activeCandidates.every((candidate) => isPastLocalDate(candidate.expirationDate))
      ? 'expired'
      : normalizedStatus;
  }

  // A promoted family has only selected/discarded candidates: its offer owns expiry from here.
  if (candidates.some((candidate) => candidate.state === 'selected')) return normalizedStatus;

  // Expand-phase fallback for legacy rows that have not received their candidate yet.
  return effectiveQuoteStatusFromDate(status, expirationDate);
};

class LinkedOfferRollbackError extends Error {
  constructor(
    message: string,
    readonly secondaryLabel: string,
  ) {
    super(message);
  }
}

const replyAutoOfferUniqueViolation = async (
  request: FastifyRequest,
  reply: FastifyReply,
  dup: ReturnType<typeof getUniqueViolation>,
  args: {
    action: string;
    quoteId: string;
    offerId?: string;
  },
): Promise<FastifyReply | null> => {
  if (!dup) return null;
  if (
    dup.constraint === 'customer_offers_pkey' ||
    (args.offerId && dup.detail?.includes(`(${args.offerId})`))
  ) {
    return replyError(request, reply, {
      statusCode: 409,
      message: 'Offer ID already exists',
      action: args.action,
      entityType: 'client_offer',
      details: { secondaryLabel: 'duplicate_offer_id' },
    });
  }
  if (
    dup.constraint === 'idx_customer_offers_linked_quote_id' ||
    dup.detail?.includes('(linked_quote_id)')
  ) {
    return replyError(request, reply, {
      statusCode: 409,
      message: 'An offer already exists for this quote',
      action: args.action,
      entityType: 'client_quote',
      entityId: args.quoteId,
      details: { secondaryLabel: 'duplicate_offer_for_quote' },
    });
  }
  return null;
};

const normalizeQuoteItems = (
  items: unknown[],
): { ok: true; items: IncomingQuoteItem[] } | { ok: false; message: string } => {
  const result: IncomingQuoteItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const itemSupplierQuoteItemId = normalizeNullableString(item.supplierQuoteItemId);
    const productIdValue = typeof item.productId === 'string' ? item.productId.trim() : '';
    if (!productIdValue && !itemSupplierQuoteItemId) {
      return {
        ok: false,
        message: `items[${i}].productId is required when no supplierQuoteItemId is provided`,
      };
    }

    const productNameResult = requireNonEmptyString(item.productName, `items[${i}].productName`);
    if (!productNameResult.ok) return { ok: false, message: productNameResult.message };
    const quantityResult = parseLocalizedPositiveNumber(item.quantity, `items[${i}].quantity`);
    if (!quantityResult.ok) return { ok: false, message: quantityResult.message };
    const unitPriceResult = parseLocalizedNonNegativeNumber(
      item.unitPrice,
      `items[${i}].unitPrice`,
    );
    if (!unitPriceResult.ok) return { ok: false, message: unitPriceResult.message };
    const itemDiscountResult = optionalLocalizedPercentage(item.discount, `items[${i}].discount`);
    if (!itemDiscountResult.ok) return { ok: false, message: itemDiscountResult.message };
    const productCostResult = optionalLocalizedNonNegativeNumber(
      item.productCost,
      `items[${i}].productCost`,
    );
    if (!productCostResult.ok) return { ok: false, message: productCostResult.message };
    const productMolPercentageResult = optionalLocalizedNumber(
      item.productMolPercentage,
      `items[${i}].productMolPercentage`,
    );
    if (!productMolPercentageResult.ok) {
      return { ok: false, message: productMolPercentageResult.message };
    }
    const supplierQuoteUnitPriceResult = optionalLocalizedNonNegativeNumber(
      item.supplierQuoteUnitPrice,
      `items[${i}].supplierQuoteUnitPrice`,
    );
    if (!supplierQuoteUnitPriceResult.ok) {
      return { ok: false, message: supplierQuoteUnitPriceResult.message };
    }
    const supplierQuoteBaseQuantityResult = optionalLocalizedNonNegativeNumber(
      item.supplierQuoteBaseQuantity,
      `items[${i}].supplierQuoteBaseQuantity`,
    );
    if (!supplierQuoteBaseQuantityResult.ok) {
      return { ok: false, message: supplierQuoteBaseQuantityResult.message };
    }
    const supplierQuoteBaseUnitPriceResult = optionalLocalizedNonNegativeNumber(
      item.supplierQuoteBaseUnitPrice,
      `items[${i}].supplierQuoteBaseUnitPrice`,
    );
    if (!supplierQuoteBaseUnitPriceResult.ok) {
      return { ok: false, message: supplierQuoteBaseUnitPriceResult.message };
    }
    // Duration in months: a positive whole number, defaulting to 1 (one-off line item).
    const durationMonthsResult = optionalDurationMonths(
      item.durationMonths,
      `items[${i}].durationMonths`,
    );
    if (!durationMonthsResult.ok) return { ok: false, message: durationMonthsResult.message };
    const durationUnitResult = optionalDurationUnit(item.durationUnit, `items[${i}].durationUnit`);
    if (!durationUnitResult.ok) return { ok: false, message: durationUnitResult.message };
    const unitType = normalizeUnitType(item.unitType);
    const durationMonths = durationMonthsResult.value ?? 1;
    const durationUnit = durationUnitResult.value ?? 'months';
    result.push({
      id: normalizeNullableString(item.id) ?? undefined,
      productId: productIdValue,
      productName: productNameResult.value,
      supplierQuoteItemId: itemSupplierQuoteItemId,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      productCost: productCostResult.value,
      productMolPercentage: productMolPercentageResult.value,
      supplierQuoteUnitPrice: supplierQuoteUnitPriceResult.value,
      supplierQuoteBaseQuantity: supplierQuoteBaseQuantityResult.value,
      supplierQuoteBaseUnitPrice: supplierQuoteBaseUnitPriceResult.value,
      discount: itemDiscountResult.value || 0,
      note: normalizeNullableString(item.note),
      unitType,
      durationMonths,
      durationUnit,
    });
  }
  return { ok: true, items: result };
};

const calculateQuoteTotals = (
  items: Array<{
    quantity: number;
    unitPrice: number;
    discount?: number;
    durationMonths?: number;
    durationUnit?: string;
  }>,
  globalDiscount: number,
  discountType: 'percentage' | 'currency' = 'percentage',
) => {
  const normalizedGlobalDiscount = Number.isFinite(globalDiscount) ? globalDiscount : 0;
  let subtotal = 0;

  for (const item of items) {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    const itemDiscount = Number(item.discount ?? 0);
    const durationMonths = Number(item.durationMonths ?? 1);
    if (
      !Number.isFinite(quantity) ||
      !Number.isFinite(unitPrice) ||
      !Number.isFinite(itemDiscount) ||
      !Number.isFinite(durationMonths)
    ) {
      return {
        total: Number.NaN,
        subtotal: Number.NaN,
      };
    }
    // Duration multiplies the line revenue (issue #757), except 'na' lines which never multiply
    // (issue #775); a non-positive value falls back to 1 so it can't zero out the gate.
    const effectiveMonths = effectiveDurationMonths(item.durationUnit, durationMonths);
    const lineSubtotal = quantity * unitPrice * effectiveMonths;
    const lineDiscount = lineSubtotal * (itemDiscount / 100);
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
  }

  const discountAmount = getDocumentDiscountAmount(
    subtotal,
    normalizedGlobalDiscount,
    discountType,
  );
  const total = subtotal - discountAmount;
  return { total, subtotal };
};

const resolveQuoteItemSnapshots = async (
  items: IncomingQuoteItem[],
  existingItemsById?: Map<string, IncomingQuoteItem & QuoteItemSnapshot>,
): Promise<ResolvedQuoteItem[]> => {
  const itemsNeedingRecalc = items.filter((item) => {
    if (!existingItemsById || !item.id) return true;
    const existingItem = existingItemsById.get(item.id);
    if (!existingItem) return true;
    return (
      existingItem.productId !== item.productId ||
      normalizeNullableString(existingItem.supplierQuoteItemId) !==
        normalizeNullableString(item.supplierQuoteItemId) ||
      (item.productCost !== null && item.productCost !== existingItem.productCost)
    );
  });

  const supplierQuoteSnapshots = await supplierQuotesRepo.getQuoteItemSnapshots(
    itemsNeedingRecalc
      .map((item) => normalizeNullableString(item.supplierQuoteItemId))
      .filter((id): id is string => id !== null),
  );

  const productIds = new Set<string>();
  for (const item of itemsNeedingRecalc) {
    if (item.productId) {
      productIds.add(item.productId);
    }
  }
  for (const supplierQuoteSnapshot of supplierQuoteSnapshots.values()) {
    if (supplierQuoteSnapshot.productId) {
      productIds.add(supplierQuoteSnapshot.productId);
    }
  }
  const productSnapshots = await productsRepo.getSnapshots(Array.from(productIds));

  const resolvedItems: ResolvedQuoteItem[] = [];
  for (const item of items) {
    const normalizedSupplierQuoteItemId = normalizeNullableString(item.supplierQuoteItemId);
    let resolvedProductId = item.productId;
    const existingItem = existingItemsById && item.id ? existingItemsById.get(item.id) : undefined;

    if (existingItemsById && item.id) {
      const isUnchanged =
        existingItem &&
        existingItem.productId === item.productId &&
        normalizeNullableString(existingItem.supplierQuoteItemId) ===
          normalizedSupplierQuoteItemId &&
        (item.productCost === null || item.productCost === existingItem.productCost);
      if (existingItem && isUnchanged) {
        const supplierQuoteUnitPrice =
          item.supplierQuoteUnitPrice ?? existingItem.supplierQuoteUnitPrice ?? null;
        resolvedItems.push(
          withCalculatedClientLineMol({
            ...item,
            supplierQuoteItemId: normalizedSupplierQuoteItemId,
            productCost: existingItem.productCost,
            productMolPercentage: existingItem.productMolPercentage ?? null,
            supplierQuoteId: existingItem.supplierQuoteId ?? null,
            supplierQuoteSupplierName: existingItem.supplierQuoteSupplierName ?? null,
            // Client-authoritative for an existing link (issue #779 bidirectional sync): a cost
            // edit on a supplier-sourced line lands here, and is then pushed back onto the
            // supplier item after the write. Absent → keep the stored snapshot.
            supplierQuoteUnitPrice,
          }),
        );
        continue;
      }
    }

    let supplierQuoteId: string | null = null;
    let supplierQuoteSupplierName: string | null = null;
    let supplierQuoteUnitPrice: number | null = null;

    if (normalizedSupplierQuoteItemId) {
      const supplierQuoteSnapshot = supplierQuoteSnapshots.get(normalizedSupplierQuoteItemId);
      if (!supplierQuoteSnapshot) {
        throw new Error(
          `supplierQuoteItemId "${normalizedSupplierQuoteItemId}" does not reference an existing supplier quote item`,
        );
      }
      if (!resolvedProductId && supplierQuoteSnapshot.productId !== null) {
        resolvedProductId = supplierQuoteSnapshot.productId;
      }
      if (
        resolvedProductId &&
        supplierQuoteSnapshot.productId !== resolvedProductId &&
        supplierQuoteSnapshot.productId !== null
      ) {
        throw new Error(
          `supplierQuoteItemId "${normalizedSupplierQuoteItemId}" does not match productId "${resolvedProductId}"`,
        );
      }
      const isRetainedLink =
        existingItem &&
        normalizeNullableString(existingItem.supplierQuoteItemId) === normalizedSupplierQuoteItemId;
      // A FRESHLY-picked link must reference a quote the picker would offer (derived draft, no
      // linked supplier order) — a stale tab or raw API client could otherwise newly source a
      // frozen/order-locked quote, persisting a line the editor immediately locks and the sync
      // rejects (#812 round 15). Retained links re-save regardless: the quote legitimately
      // progresses after sourcing. (Quotes have no conversion-inherited links — offers do, and
      // their resolver exempts them via the linked quote.)
      if (!isRetainedLink && supplierQuoteSnapshot.sourceable === false) {
        throw new Error(
          `supplierQuoteItemId "${normalizedSupplierQuoteItemId}" references a supplier quote that is no longer available for new sourcing`,
        );
      }
      supplierQuoteId = supplierQuoteSnapshot.supplierQuoteId;
      supplierQuoteSupplierName = supplierQuoteSnapshot.supplierName;
      supplierQuoteUnitPrice = supplierQuoteSnapshot.netCost;
      // Same link RETAINED but other snapshot inputs changed (e.g. product/cost/MOL): the
      // client's live cost still wins (#779 bidirectional sync — it is pushed back onto the
      // supplier item after the write).
      if (isRetainedLink && item.supplierQuoteUnitPrice != null) {
        supplierQuoteUnitPrice = item.supplierQuoteUnitPrice;
      } else if (
        !isRetainedLink &&
        item.supplierQuoteUnitPrice != null &&
        item.supplierQuoteBaseUnitPrice != null &&
        item.supplierQuoteUnitPrice !== item.supplierQuoteBaseUnitPrice
      ) {
        // A FRESHLY-picked link whose cost was deliberately edited away from the pick-time
        // baseline (user report after #812): keep the edit on the line — the sync pushes it onto
        // the supplier item in the same transaction. An untouched cost (== baseline) keeps the
        // server snapshot instead, so a stale browser can't revert newer supplier pricing it
        // never saw.
        supplierQuoteUnitPrice = item.supplierQuoteUnitPrice;
      }
    }

    const productSnapshot = resolvedProductId ? productSnapshots.get(resolvedProductId) : undefined;
    if (!productSnapshot && !normalizedSupplierQuoteItemId) {
      throw new Error(`items productId "${resolvedProductId}" is invalid`);
    }

    const allowManualProductCost = !normalizedSupplierQuoteItemId;
    const productCost =
      allowManualProductCost && item.productCost !== null
        ? item.productCost
        : (productSnapshot?.productCost ?? 0);
    resolvedItems.push(
      withCalculatedClientLineMol({
        ...item,
        productId: resolvedProductId,
        supplierQuoteItemId: normalizedSupplierQuoteItemId,
        productCost,
        productMolPercentage: item.productMolPercentage,
        supplierQuoteId,
        supplierQuoteSupplierName,
        supplierQuoteUnitPrice,
      }),
    );
  }

  return resolvedItems;
};

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const quoteItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    quoteId: { type: 'string' },
    candidateId: { type: 'string' },
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: ['number', 'null'] },
    supplierQuoteId: { type: ['string', 'null'] },
    supplierQuoteItemId: { type: ['string', 'null'] },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    discount: { type: 'number', minimum: 0, maximum: 100 },
    note: { type: ['string', 'null'] },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
  },
  required: [
    'id',
    'quoteId',
    'candidateId',
    'productId',
    'productName',
    'quantity',
    'unitPrice',
    'productCost',
    'discount',
  ],
} as const;

const quoteCandidateSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    quoteId: { type: 'string' },
    name: { type: 'string' },
    position: { type: 'number' },
    state: { type: 'string', enum: ['active', 'selected', 'discarded'] },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    expirationDate: { type: 'string', format: 'date' },
    communicationChannelId: { type: 'string' },
    communicationChannelName: { type: 'string' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: quoteItemSchema },
    isExpired: { type: 'boolean' },
    linkedSupplierQuoteExpired: { type: 'boolean' },
  },
  required: ['id', 'quoteId', 'name', 'position', 'state', 'items', 'expirationDate'],
} as const;

const quoteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedOfferId: { type: ['string', 'null'] },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string' },
    expirationDate: { type: ['string', 'null'], format: 'date' },
    communicationChannelId: { type: 'string' },
    communicationChannelName: { type: 'string' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: quoteItemSchema },
    candidates: { type: 'array', items: quoteCandidateSchema },
    selectedCandidateId: { type: ['string', 'null'] },
    isExpired: { type: 'boolean' },
    // Issue #779: the effective status folds in the derived `expired` overlay.
    // `linkedSupplierQuoteExpired` is true when any supplier quote the lines SOURCE is past its
    // expiration (drives the client progression guard); `linkedSupplierQuoteId` is the vestigial
    // 1-to-1 header column (no longer written — the link is line-sourced now), kept for back-compat.
    effectiveStatus: {
      type: 'string',
      enum: ['draft', 'sent', 'offer', 'accepted', 'denied', 'expired'],
    },
    linkedSupplierQuoteId: { type: ['string', 'null'] },
    linkedSupplierQuoteExpired: { type: 'boolean' },
  },
  required: [
    'id',
    'clientId',
    'clientName',
    'discount',
    'discountType',
    'status',
    'communicationChannelId',
    'communicationChannelName',
    'createdAt',
    'updatedAt',
    'items',
    'candidates',
    'isExpired',
    'effectiveStatus',
    'linkedSupplierQuoteExpired',
  ],
} as const;

const quoteItemBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    supplierQuoteItemId: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    // Nullable so Ajv does not fold an unavailable client snapshot into 0. The resolver replaces
    // this request value with the MOL derived from the authoritative cost and sale price.
    productMolPercentage: {
      type: ['number', 'null'],
    },
    // The line's live unit cost for supplier-sourced lines — client-authoritative on edits of an
    // existing link (issue #779 bidirectional sync).
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    // Pick-time supplier values (never persisted): the genuine-edit baseline that lets a FRESH
    // link's quantity/cost edits survive the save and push onto the supplier item.
    supplierQuoteBaseQuantity: { type: ['number', 'null'] },
    supplierQuoteBaseUnitPrice: { type: ['number', 'null'] },
    discount: { type: 'number', minimum: 0, maximum: 100 },
    note: { type: 'string' },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
  },
  // unitType is required: it drives per-unit pricing (a 'days' line bills at 8x the hourly rate)
  // and is stored on every line, so the API must not silently default the unit. Mirrors invoices'
  // required unitOfMeasure.
  required: ['productId', 'productName', 'quantity', 'unitPrice', 'unitType'],
} as const;

const quoteCandidateBodySchema = {
  type: 'object',
  allOf: [createDocumentDiscountConstraint],
  properties: {
    id: { type: 'string' },
    name: { type: 'string', maxLength: MAX_CANDIDATE_NAME_LENGTH },
    items: { type: 'array', items: quoteItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: documentDiscountValueSchema,
    discountType: documentDiscountTypeSchema,
    expirationDate: { type: 'string', format: 'date' },
    communicationChannelId: { type: 'string' },
    notes: { type: ['string', 'null'] },
  },
  required: ['name', 'items', 'expirationDate', 'communicationChannelId'],
} as const;

const quoteCreateBodySchema = {
  type: 'object',
  allOf: [createDocumentDiscountConstraint],
  properties: {
    id: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: quoteItemBodySchema },
    candidates: { type: 'array', items: quoteCandidateBodySchema },
    paymentTerms: { type: 'string' },
    discount: documentDiscountValueSchema,
    discountType: documentDiscountTypeSchema,
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    communicationChannelId: { type: 'string' },
    notes: { type: 'string' },
  },
  // Coordinated v2 contract: frontend and backend ship together, so the legacy flat create body is
  // intentionally not maintained in parallel. `items` remains response/update compatibility only.
  required: ['clientId', 'clientName', 'candidates'],
} as const;

const quoteUpdateBodySchema = {
  type: 'object',
  allOf: [updateDocumentDiscountConstraint],
  properties: {
    id: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: quoteItemBodySchema },
    candidates: { type: 'array', items: quoteCandidateBodySchema },
    paymentTerms: { type: 'string' },
    discount: documentDiscountValueSchema,
    discountType: documentDiscountTypeSchema,
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    communicationChannelId: { type: 'string' },
    notes: { type: 'string' },
  },
} as const;

const buildItemsForInsert = (items: ResolvedQuoteItem[]): clientQuotesRepo.NewClientQuoteItem[] =>
  items.map((item, position) => ({
    id: generatePrefixedId(ITEM_ID_PREFIXES.clientQuoteItem),
    position,
    productId: item.productId || null,
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    productCost: item.productCost ?? 0,
    productMolPercentage: item.productMolPercentage ?? null,
    discount: item.discount || 0,
    note: item.note || null,
    supplierQuoteId: item.supplierQuoteId ?? null,
    supplierQuoteItemId: item.supplierQuoteItemId ?? null,
    supplierQuoteSupplierName: item.supplierQuoteSupplierName ?? null,
    supplierQuoteUnitPrice: item.supplierQuoteUnitPrice ?? null,
    unitType: item.unitType ?? 'hours',
    durationMonths: item.durationMonths ?? 1,
    durationUnit: item.durationUnit ?? 'months',
  }));

const resolveCommunicationChannel = async (
  rawChannelId: unknown,
  reply: FastifyReply,
  options: { required: boolean },
): Promise<{ id: string; name: string } | null> => {
  if (!options.required && rawChannelId === undefined) return null;

  const channelIdResult = requireNonEmptyString(rawChannelId, 'communicationChannelId');
  if (!channelIdResult.ok) {
    badRequest(reply, channelIdResult.message);
    return null;
  }

  const channel = await quoteCommunicationChannelsRepo.findById(channelIdResult.value);
  if (!channel) {
    badRequest(reply, 'communicationChannelId does not reference an existing channel');
    return null;
  }
  return channel;
};

const buildOfferItemsFromQuoteItems = (
  items: clientQuotesRepo.ClientQuoteItem[],
): clientOffersRepo.NewClientOfferItem[] =>
  items.map((item) => ({
    id: generatePrefixedId(ITEM_ID_PREFIXES.clientOfferItem),
    productId: item.productId || null,
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    productCost: item.productCost,
    productMolPercentage: calculateClientLineMol(item),
    discount: item.discount,
    note: item.note,
    supplierQuoteId: item.supplierQuoteId,
    supplierQuoteItemId: item.supplierQuoteItemId,
    supplierQuoteSupplierName: item.supplierQuoteSupplierName,
    supplierQuoteUnitPrice: item.supplierQuoteUnitPrice,
    unitType: item.unitType,
    durationMonths: item.durationMonths,
    durationUnit: item.durationUnit,
  }));

type PreparedCandidate = {
  id?: string;
  name: string;
  paymentTerms: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  expirationDate: string;
  communicationChannelId: string;
  notes: string | null;
  items: ResolvedQuoteItem[];
};

const sameNullableValue = <T>(left: T | null | undefined, right: T | null | undefined) =>
  (left ?? null) === (right ?? null);

const isSameCandidateItem = (
  submitted: ResolvedQuoteItem,
  existing: clientQuotesRepo.ClientQuoteItem,
): boolean =>
  submitted.id === existing.id &&
  (submitted.productId || '') === existing.productId &&
  submitted.productName === existing.productName &&
  submitted.quantity === existing.quantity &&
  submitted.unitPrice === existing.unitPrice &&
  submitted.productCost === existing.productCost &&
  // MOL is derived from the effective cost and unitPrice. Ignore a stale stored snapshot here so
  // extending an expired candidate remains an expiration-only edit after this invariant changed.
  sameNullableValue(submitted.supplierQuoteId, existing.supplierQuoteId) &&
  sameNullableValue(submitted.supplierQuoteItemId, existing.supplierQuoteItemId) &&
  sameNullableValue(submitted.supplierQuoteSupplierName, existing.supplierQuoteSupplierName) &&
  sameNullableValue(submitted.supplierQuoteUnitPrice, existing.supplierQuoteUnitPrice) &&
  submitted.discount === existing.discount &&
  sameNullableValue(submitted.note, existing.note) &&
  submitted.unitType === existing.unitType &&
  submitted.durationMonths === existing.durationMonths &&
  submitted.durationUnit === existing.durationUnit;

const isExpirationOnlyCandidateFamilyUpdate = (args: {
  quoteId: string;
  nextQuoteId: string;
  parent: clientQuotesRepo.ClientQuote;
  clientId: string;
  clientName: string;
  requestedStatus: string;
  submittedCandidates: PreparedCandidate[];
  existingCandidates: quoteCandidatesRepo.QuoteCandidate[];
  existingItems: clientQuotesRepo.ClientQuoteItem[];
}): boolean => {
  if (
    args.nextQuoteId !== args.quoteId ||
    args.parent.clientId !== args.clientId ||
    args.parent.clientName !== args.clientName ||
    normalizeQuoteStatus(args.parent.status) !== normalizeQuoteStatus(args.requestedStatus) ||
    args.submittedCandidates.every((candidate) => isPastLocalDate(candidate.expirationDate))
  ) {
    return false;
  }

  const existingActive = args.existingCandidates.filter(
    (candidate) => candidate.state === 'active',
  );
  if (existingActive.length !== args.submittedCandidates.length) return false;
  const existingActiveById = new Map(existingActive.map((candidate) => [candidate.id, candidate]));
  const existingItemsByCandidateId = new Map<string, clientQuotesRepo.ClientQuoteItem[]>();
  for (const item of args.existingItems) {
    const candidateItems = existingItemsByCandidateId.get(item.candidateId) ?? [];
    candidateItems.push(item);
    existingItemsByCandidateId.set(item.candidateId, candidateItems);
  }

  let extended = false;
  for (let index = 0; index < args.submittedCandidates.length; index++) {
    const submitted = args.submittedCandidates[index];
    const existing = submitted.id ? existingActiveById.get(submitted.id) : undefined;
    if (
      !existing ||
      existing.position !== index ||
      existing.name !== submitted.name ||
      existing.paymentTerms !== submitted.paymentTerms ||
      existing.discount !== submitted.discount ||
      existing.discountType !== submitted.discountType ||
      existing.communicationChannelId !== submitted.communicationChannelId ||
      !sameNullableValue(existing.notes, submitted.notes) ||
      submitted.expirationDate < existing.expirationDate
    ) {
      return false;
    }
    extended ||= submitted.expirationDate > existing.expirationDate;

    const existingCandidateItems = existingItemsByCandidateId.get(existing.id) ?? [];
    if (
      existingCandidateItems.length !== submitted.items.length ||
      submitted.items.some(
        (item, itemIndex) => !isSameCandidateItem(item, existingCandidateItems[itemIndex]),
      )
    ) {
      return false;
    }
  }

  return extended;
};

const prepareCandidateBody = async (
  raw: unknown,
  index: number,
  reply: FastifyReply,
  existingSnapshots?: clientQuotesRepo.ExistingQuoteItemSnapshot[],
): Promise<PreparedCandidate | null> => {
  if (!raw || typeof raw !== 'object') {
    badRequest(reply, 'candidates[' + index + '] must be an object');
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const nameResult = requireNonEmptyString(candidate.name, 'candidates[' + index + '].name');
  if (!nameResult.ok) {
    badRequest(reply, nameResult.message);
    return null;
  }
  if (!Array.isArray(candidate.items) || candidate.items.length === 0) {
    badRequest(reply, 'candidates[' + index + '].items must be a non-empty array');
    return null;
  }
  const itemResult = normalizeQuoteItems(candidate.items);
  if (!itemResult.ok) {
    badRequest(reply, itemResult.message);
    return null;
  }
  const candidateId =
    typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : undefined;
  const foreignItem = itemResult.items.find(
    (item) =>
      item.id &&
      existingSnapshots?.some(
        (snapshot) => snapshot.id === item.id && snapshot.candidateId !== candidateId,
      ),
  );
  if (foreignItem) {
    badRequest(reply, `items id "${foreignItem.id}" does not belong to candidate "${candidateId}"`);
    return null;
  }
  const expirationResult = parseDateString(
    candidate.expirationDate,
    'candidates[' + index + '].expirationDate',
  );
  if (!expirationResult.ok) {
    badRequest(reply, expirationResult.message);
    return null;
  }
  const channel = await resolveCommunicationChannel(candidate.communicationChannelId, reply, {
    required: true,
  });
  if (!channel) return null;
  const discountType = candidate.discountType === 'currency' ? 'currency' : 'percentage';
  const discountResult = optionalLocalizedDocumentDiscount(
    candidate.discount,
    discountType,
    'candidates[' + index + '].discount',
  );
  if (!discountResult.ok) {
    badRequest(reply, discountResult.message);
    return null;
  }
  const discount = discountResult.value ?? 0;
  const existingItemsById =
    existingSnapshots && candidateId
      ? indexExistingQuoteItems(existingSnapshots, candidateId)
      : undefined;
  let resolvedItems: ResolvedQuoteItem[];
  try {
    resolvedItems = await resolveQuoteItemSnapshots(itemResult.items, existingItemsById);
  } catch (error) {
    badRequest(reply, (error as Error).message);
    return null;
  }
  const totals = calculateQuoteTotals(resolvedItems, discount, discountType);
  if (!Number.isFinite(totals.total) || totals.total <= 0) {
    badRequest(reply, 'candidates[' + index + '].total must be greater than 0');
    return null;
  }
  return {
    id: candidateId,
    name: nameResult.value,
    paymentTerms:
      typeof candidate.paymentTerms === 'string' && candidate.paymentTerms
        ? candidate.paymentTerms
        : 'immediate',
    discount,
    discountType,
    expirationDate: expirationResult.value,
    communicationChannelId: channel.id,
    notes: typeof candidate.notes === 'string' ? candidate.notes : null,
    items: resolvedItems,
  };
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  // Builds the response payload with the derived #779 fields. `sourcedExpiration` must be the
  // STATUS-AWARE earliest blocking expiration among the supplier quotes the quote SOURCES via its
  // lines (supplierQuotesRepo.findEarliestExpirationByIds / findBlockingExpirationsByIds —
  // terminal-frozen sourced quotes excluded). NOT the quote row's raw-MIN
  // linkedSupplierQuoteExpiration: the UI disables Sent/Offer/Accepted off the flag below, so a
  // raw past date on a terminal-frozen (never-expired) sourced supplier quote would block
  // client-side a transition the server allows (#812 round 11).
  const buildQuoteResponse = (
    quote: clientQuotesRepo.ClientQuote,
    items: clientQuotesRepo.ClientQuoteItem[],
    sourcedExpiration: string | null,
  ) => {
    const effectiveStatus = effectiveQuoteStatusFromDate(quote.status, quote.expirationDate);
    const normalizedItems = items.map((item) => ({
      ...item,
      candidateId: item.candidateId || item.quoteId,
    }));
    const fallbackCandidate = {
      id: quote.id,
      quoteId: quote.id,
      name: 'Variante A',
      position: 0,
      state: quote.status === 'offer' ? ('selected' as const) : ('active' as const),
      paymentTerms: quote.paymentTerms ?? 'immediate',
      discount: quote.discount,
      discountType: quote.discountType,
      expirationDate: quote.expirationDate,
      communicationChannelId: quote.communicationChannelId,
      communicationChannelName: quote.communicationChannelName,
      notes: quote.notes,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
      items: normalizedItems,
    };
    return {
      ...quote,
      items: normalizedItems,
      candidates: [fallbackCandidate],
      selectedCandidateId: quote.status === 'offer' ? quote.id : null,
      // `isExpired` is retained for backward compatibility (existing consumers); it derives from
      // the effective status so terminal accepted/denied never report expired (issue #779).
      // Prefer `effectiveStatus` in new code.
      isExpired: effectiveStatus === 'expired',
      effectiveStatus,
      // Surface the supplier-expired block indicator only while the quote can still progress
      // (terminal accepted/denied quotes are frozen, so the guard never applies) and a sourced
      // supplier quote is actually stale (#779 follow-up: any line-sourced supplier quote past
      // its expiration).
      linkedSupplierQuoteExpired:
        !isTerminalQuoteStatus(quote.status) &&
        !!sourcedExpiration &&
        isPastLocalDate(sourcedExpiration),
    };
  };

  const familyHasBlockingSupplier = (
    quoteStatus: string,
    candidates: Array<{ state: string; linkedSupplierQuoteExpired: boolean }>,
    fallback = false,
  ): boolean => {
    if (isTerminalQuoteStatus(quoteStatus)) return false;
    const selected = candidates.find((candidate) => candidate.state === 'selected');
    const relevant = selected
      ? [selected]
      : candidates.filter((candidate) => candidate.state === 'active');
    return relevant.length > 0
      ? relevant.some((candidate) => candidate.linkedSupplierQuoteExpired)
      : fallback;
  };

  const deleteDraftLinkedOfferForRollback = async (
    offerId: string,
    tx: DbExecutor,
  ): Promise<void> => {
    const offer = await clientOffersRepo.lockExistingById(offerId, tx);
    if (!offer) {
      throw new LinkedOfferRollbackError('Linked offer not found', 'linked_offer_missing');
    }
    if (normalizeQuoteStatus(offer.status) !== 'draft') {
      throw new LinkedOfferRollbackError(
        'Cannot revert quote while the linked offer is no longer draft',
        'linked_offer_not_draft',
      );
    }
    if (await clientOffersRepo.findLinkedSaleId(offerId, tx)) {
      throw new LinkedOfferRollbackError(
        'Cannot revert quote while the linked offer already has a sale order',
        'linked_offer_has_sale_order',
      );
    }
    await clientOffersRepo.deleteById(offerId, tx);
  };

  // Guard: a client quote cannot progress to sent/offer/accepted while any supplier quote it
  // SOURCES via its product lines is expired (issue #779 follow-up — the 1:1 header link was
  // removed, so this keys on the earliest sourced-supplier-quote expiration). Returns true (after
  // sending a 409) when the transition is blocked.
  const blockIfSourcedSupplierExpired = async (
    targetStatus: string,
    sourcedExpiration: string | null,
    quoteId: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> => {
    const target = normalizeQuoteStatus(targetStatus);
    if (target !== 'sent' && target !== 'offer' && target !== 'accepted') return false;
    if (!sourcedExpiration || !isPastLocalDate(sourcedExpiration)) return false;
    await replyError(request, reply, {
      statusCode: 409,
      message:
        'A supplier quote sourced by this quote has expired; extend its validity before progressing this quote',
      action: 'client_quote.update.conflict',
      entityType: 'client_quote',
      entityId: quoteId,
      details: { secondaryLabel: 'linked_supplier_quote_expired' },
    });
    return true;
  };

  const replyExpiredQuoteReadOnly = (
    quoteId: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ) =>
    replyError(request, reply, {
      statusCode: 409,
      message: 'Expired quotes are read-only; extend the expiration date instead',
      action: 'client_quote.update.conflict',
      entityType: 'client_quote',
      entityId: quoteId,
      details: { secondaryLabel: 'expired_read_only', fromValue: 'expired' },
    });

  // Distinct supplier quotes a set of lines sources (issue #779 follow-up). Structurally typed so
  // it serves resolved/normalized request lines AND stored/version-snapshot items alike. LEGACY
  // rows can carry only supplierQuoteItemId (null denormalized supplierQuoteId) — the repo's
  // candidate predicate treats them as real sourcing (#812 round 18), so the expired guards and
  // the response flag must too (#812 round 20): resolve those through the live supplier items.
  // Resolver-stamped request lines always carry supplierQuoteId, so the extra lookup only runs
  // for stored/snapshot rows that actually have item-only links.
  const sourcedSupplierQuoteIds = async (
    lines: ReadonlyArray<{ supplierQuoteId?: string | null; supplierQuoteItemId?: string | null }>,
    exec?: DbExecutor,
  ): Promise<string[]> => {
    const ids = new Set<string>();
    const itemOnlyIds: string[] = [];
    for (const line of lines) {
      if (line.supplierQuoteId) ids.add(line.supplierQuoteId);
      else if (line.supplierQuoteItemId) itemOnlyIds.push(line.supplierQuoteItemId);
    }
    if (itemOnlyIds.length > 0) {
      const snapshots = await supplierQuotesRepo.getQuoteItemSnapshots(itemOnlyIds, exec);
      for (const snapshot of snapshots.values()) ids.add(snapshot.supplierQuoteId);
    }
    return Array.from(ids);
  };

  const loadFamilyResponse = async (quoteId: string, exec?: DbExecutor) => {
    const [quote, candidates, familyItems] = await Promise.all([
      clientQuotesRepo.findById(quoteId, exec),
      quoteCandidatesRepo.listForQuote(quoteId, exec),
      clientQuotesRepo.findItemsForQuote(quoteId, exec),
    ]);
    if (!quote) return null;
    const itemsByCandidate = new Map<string, clientQuotesRepo.ClientQuoteItem[]>();
    for (const item of familyItems) {
      const items = itemsByCandidate.get(item.candidateId);
      if (items) items.push(item);
      else itemsByCandidate.set(item.candidateId, [item]);
    }
    const supplierIdsByCandidate = new Map<string, Set<string>>();
    const itemOnlyCandidateIds = new Map<string, Set<string>>();
    for (const item of familyItems) {
      if (item.supplierQuoteId) {
        const supplierIds = supplierIdsByCandidate.get(item.candidateId);
        if (supplierIds) supplierIds.add(item.supplierQuoteId);
        else supplierIdsByCandidate.set(item.candidateId, new Set([item.supplierQuoteId]));
      } else if (item.supplierQuoteItemId) {
        const candidateIds = itemOnlyCandidateIds.get(item.supplierQuoteItemId);
        if (candidateIds) candidateIds.add(item.candidateId);
        else itemOnlyCandidateIds.set(item.supplierQuoteItemId, new Set([item.candidateId]));
      }
    }
    if (itemOnlyCandidateIds.size > 0) {
      const snapshots = await supplierQuotesRepo.getQuoteItemSnapshots(
        Array.from(itemOnlyCandidateIds.keys()),
        exec,
      );
      for (const [itemId, candidateIds] of itemOnlyCandidateIds) {
        const supplierQuoteId = snapshots.get(itemId)?.supplierQuoteId;
        if (!supplierQuoteId) continue;
        for (const candidateId of candidateIds) {
          const supplierIds = supplierIdsByCandidate.get(candidateId);
          if (supplierIds) supplierIds.add(supplierQuoteId);
          else supplierIdsByCandidate.set(candidateId, new Set([supplierQuoteId]));
        }
      }
    }
    const blockingExpirations = await supplierQuotesRepo.findBlockingExpirationsByIds(
      Array.from(
        new Set(Array.from(supplierIdsByCandidate.values()).flatMap((ids) => Array.from(ids))),
      ),
      exec,
    );
    const enrichedCandidates = candidates.map((candidate) => {
      const supplierIds = supplierIdsByCandidate.get(candidate.id) ?? new Set<string>();
      return {
        ...candidate,
        items: itemsByCandidate.get(candidate.id) ?? [],
        isExpired: isPastLocalDate(candidate.expirationDate),
        linkedSupplierQuoteExpired: Array.from(supplierIds).some((supplierId) => {
          const expiration = blockingExpirations.get(supplierId);
          return Boolean(expiration && isPastLocalDate(expiration));
        }),
      };
    });
    const selected = enrichedCandidates.find((candidate) => candidate.state === 'selected');
    const primary =
      selected ??
      enrichedCandidates.find((candidate) => candidate.state === 'active') ??
      enrichedCandidates[0];
    const familyEffectiveStatus = effectiveCandidateFamilyStatus(
      quote.status,
      quote.expirationDate,
      enrichedCandidates,
    );
    const response = buildQuoteResponse(quote, primary?.items ?? [], null);
    return {
      ...response,
      candidates: enrichedCandidates,
      selectedCandidateId: selected?.id ?? null,
      linkedSupplierQuoteExpired: familyHasBlockingSupplier(
        quote.status,
        enrichedCandidates,
        Array.from(blockingExpirations.values()).some((expiration) => isPastLocalDate(expiration)),
      ),
      isExpired: familyEffectiveStatus === 'expired',
      effectiveStatus: familyEffectiveStatus,
    };
  };

  const snapshotPreState = async (
    quoteId: string,
    reason: quoteVersionsRepo.QuoteVersionReason,
    request: FastifyRequest,
    tx: DbExecutor,
  ) => {
    const [pre, candidates] = await Promise.all([
      clientQuotesRepo.findFullForSnapshot(quoteId, tx),
      quoteCandidatesRepo.listForQuote(quoteId, tx),
    ]);
    if (!pre) return;
    await quoteVersionsRepo.insert(
      {
        quoteId,
        snapshot: quoteVersionsRepo.buildSnapshot(pre.quote, pre.items, candidates),
        reason,
        createdByUserId: request.user?.id ?? null,
      },
      tx,
    );
  };

  const findMissingSnapshotReference = async (
    snapshot: quoteVersionsRepo.QuoteVersionSnapshot,
    exec: DbExecutor,
  ): Promise<string | null> => {
    const clientExists = await clientsRepo.existsById(snapshot.quote.clientId, exec);
    if (!clientExists) {
      return `Snapshot client "${snapshot.quote.clientId}" no longer exists`;
    }

    const productIds = Array.from(
      new Set(
        snapshot.items
          .map((item) => item.productId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    if (productIds.length === 0) return null;

    const products = await productsRepo.getSnapshots(productIds, exec);
    const missingProductId = productIds.find((id) => !products.has(id));
    return missingProductId ? `Snapshot product "${missingProductId}" no longer exists` : null;
  };

  // GET / - List all quotes with their items
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.client_quotes.view'),
      ],
      schema: {
        tags: ['client-quotes'],
        summary: 'List client quotes',
        response: {
          200: { type: 'array', items: quoteSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const [quotes, items, candidates] = await Promise.all([
        clientQuotesRepo.listAll(),
        clientQuotesRepo.listAllItems(),
        quoteCandidatesRepo.listAll(),
      ]);

      const itemsByQuote = new Map<string, clientQuotesRepo.ClientQuoteItem[]>();
      for (const item of items) {
        const list = itemsByQuote.get(item.quoteId);
        if (list) list.push(item);
        else itemsByQuote.set(item.quoteId, [item]);
      }

      const itemsByCandidate = new Map<string, clientQuotesRepo.ClientQuoteItem[]>();
      for (const item of items) {
        const candidateId = item.candidateId || item.quoteId;
        const list = itemsByCandidate.get(candidateId);
        if (list) list.push(item);
        else itemsByCandidate.set(candidateId, [item]);
      }

      const candidatesByQuote = new Map<string, quoteCandidatesRepo.QuoteCandidate[]>();
      for (const candidate of candidates) {
        const list = candidatesByQuote.get(candidate.quoteId);
        if (list) list.push(candidate);
        else candidatesByQuote.set(candidate.quoteId, [candidate]);
      }

      // One batched status-aware read for every sourced supplier quote in the list (#812 round
      // 11): the per-quote flag below must exclude terminal-frozen sourced quotes exactly like the
      // progression guard, so it cannot come from the row's raw-MIN linkedSupplierQuoteExpiration.
      // LEGACY rows may carry only supplierQuoteItemId (#812 rounds 18/20/21): resolve those to
      // their supplier quote ONCE here so the per-quote loop below sees them too — keying the loop
      // on item.supplierQuoteId alone left such rows flagged false while the update guard blocked.
      const itemOnlyIds = items.flatMap((item) =>
        !item.supplierQuoteId && item.supplierQuoteItemId ? [item.supplierQuoteItemId] : [],
      );
      const itemOnlySnapshots =
        itemOnlyIds.length > 0
          ? await supplierQuotesRepo.getQuoteItemSnapshots(itemOnlyIds)
          : new Map<string, supplierQuotesRepo.QuoteItemSnapshot>();
      const resolvedSourcedId = (item: clientQuotesRepo.ClientQuoteItem): string | null =>
        item.supplierQuoteId ??
        (item.supplierQuoteItemId
          ? (itemOnlySnapshots.get(item.supplierQuoteItemId)?.supplierQuoteId ?? null)
          : null);
      const blockingExpirations = await supplierQuotesRepo.findBlockingExpirationsByIds(
        items.map(resolvedSourcedId).filter((id): id is string => id !== null),
      );
      return quotes.map((quote) => {
        const familyCandidates = candidatesByQuote.get(quote.id) ?? [];
        const selectedCandidate = familyCandidates.find(
          (candidate) => candidate.state === 'selected',
        );
        const primaryCandidate =
          selectedCandidate ??
          familyCandidates.find((candidate) => candidate.state === 'active') ??
          familyCandidates[0];
        const quoteItems = primaryCandidate
          ? (itemsByCandidate.get(primaryCandidate.id) ?? itemsByQuote.get(quote.id) ?? [])
          : (itemsByQuote.get(quote.id) ?? []);
        const enrichedCandidates = familyCandidates.map((candidate) => {
          const candidateItems = itemsByCandidate.get(candidate.id) ?? [];
          const supplierExpired = candidateItems.some((item) => {
            const sourcedId = resolvedSourcedId(item);
            const date = sourcedId ? blockingExpirations.get(sourcedId) : undefined;
            return Boolean(date && isPastLocalDate(date));
          });
          return {
            ...candidate,
            items: candidateItems,
            isExpired: isPastLocalDate(candidate.expirationDate),
            linkedSupplierQuoteExpired: supplierExpired,
          };
        });
        const familyEffectiveStatus = effectiveCandidateFamilyStatus(
          quote.status,
          quote.expirationDate,
          enrichedCandidates,
        );
        const primarySupplierExpired = quoteItems.some((item) => {
          const sourcedId = resolvedSourcedId(item);
          const date = sourcedId ? blockingExpirations.get(sourcedId) : undefined;
          return Boolean(date && isPastLocalDate(date));
        });
        const response = buildQuoteResponse(quote, quoteItems, null);
        return {
          ...response,
          candidates: enrichedCandidates,
          selectedCandidateId: selectedCandidate?.id ?? null,
          linkedSupplierQuoteExpired: familyHasBlockingSupplier(
            quote.status,
            enrichedCandidates,
            primarySupplierExpired,
          ),
          isExpired: familyEffectiveStatus === 'expired',
          effectiveStatus: familyEffectiveStatus,
        };
      });
    },
  );

  // POST / - Create quote with items
  fastify.post(
    '/',
    {
      onRequest: [requirePermission('sales.client_quotes.create')],
      schema: {
        tags: ['client-quotes'],
        summary: 'Create client quote',
        body: quoteCreateBodySchema,
        response: {
          201: quoteSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        id: nextId,
        clientId,
        clientName,
        candidates,
        status,
      } = request.body as {
        id?: unknown;
        clientId: unknown;
        clientName: unknown;
        candidates: unknown;
        status?: unknown;
      };

      const nextIdResult = optionalNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);

      if (!Array.isArray(candidates) || candidates.length === 0) {
        return badRequest(reply, 'Candidates must be a non-empty array');
      }
      const preparedCandidates: PreparedCandidate[] = [];
      const normalizedNames = new Set<string>();
      for (let index = 0; index < candidates.length; index++) {
        const prepared = await prepareCandidateBody(candidates[index], index, reply);
        if (!prepared) return;
        const normalizedName = prepared.name.toLocaleLowerCase();
        if (normalizedNames.has(normalizedName)) {
          return badRequest(reply, 'Candidate names must be unique within a quote');
        }
        normalizedNames.add(normalizedName);
        preparedCandidates.push(prepared);
      }

      let initialStatus: QuotePipelineStatus = 'draft';
      if (typeof status === 'string' && status) {
        const parsedStatus = parseQuoteStatusInput(status);
        if (parsedStatus === null) {
          return badRequest(reply, 'status must be one of draft, sent, offer, accepted, denied');
        }
        initialStatus = parsedStatus;
      }
      if (initialStatus === 'offer' || initialStatus === 'accepted') {
        return badRequest(reply, 'Use the candidate promotion endpoint to create an offer');
      }
      if (initialStatus !== 'draft') {
        return badRequest(reply, 'New candidate families must start in draft status');
      }
      const primaryCandidate = preparedCandidates[0];

      try {
        const { quote } = await withDbTransaction(async (tx) => {
          let quoteId: string;
          if (nextIdResult.value) {
            await reserveDocumentCodeCounterFromCode('client_quote', nextIdResult.value, tx);
            quoteId = nextIdResult.value;
          } else {
            quoteId = await allocateDocumentCode('client_quote', { exec: tx });
          }
          const created = await clientQuotesRepo.create(
            {
              id: quoteId,
              clientId: clientIdResult.value,
              clientName: clientNameResult.value,
              paymentTerms: primaryCandidate.paymentTerms,
              discount: primaryCandidate.discount,
              discountType: primaryCandidate.discountType,
              status: initialStatus,
              expirationDate: primaryCandidate.expirationDate,
              communicationChannelId: primaryCandidate.communicationChannelId,
              notes: primaryCandidate.notes,
              // The supplier↔client link is line-sourced now (issue #779 follow-up); the vestigial
              // header column is never populated.
              linkedSupplierQuoteId: null,
            },
            tx,
          );
          const primaryCandidateId = generatePrefixedId('qc');
          await quoteCandidatesRepo.insert(
            {
              id: primaryCandidateId,
              quoteId: created.id,
              name: primaryCandidate.name,
              position: 0,
              state: 'active',
              paymentTerms: created.paymentTerms ?? 'immediate',
              discount: created.discount,
              discountType: created.discountType,
              expirationDate: created.expirationDate ?? primaryCandidate.expirationDate,
              communicationChannelId: created.communicationChannelId,
              notes: created.notes,
            },
            tx,
          );
          await clientQuotesRepo.insertItems(
            created.id,
            buildItemsForInsert(primaryCandidate.items),
            tx,
            primaryCandidateId,
          );
          await Promise.all(
            preparedCandidates.slice(1).map(async (input, offset) => {
              const candidateId = generatePrefixedId('qc');
              await quoteCandidatesRepo.insert(
                {
                  id: candidateId,
                  quoteId: created.id,
                  name: input.name,
                  position: offset + 1,
                  state: 'active',
                  paymentTerms: input.paymentTerms,
                  discount: input.discount,
                  discountType: input.discountType,
                  expirationDate: input.expirationDate,
                  communicationChannelId: input.communicationChannelId,
                  notes: input.notes,
                },
                tx,
              );
              await clientQuotesRepo.insertItems(
                created.id,
                buildItemsForInsert(input.items),
                tx,
                candidateId,
              );
            }),
          );
          return { quote: created };
        });

        await logAudit({
          request,
          action: 'client_quote.created',
          entityType: 'client_quote',
          entityId: quote.id,
          details: {
            targetLabel: quote.id,
            secondaryLabel: clientNameResult.value,
            changedFields: ['communicationChannelId'],
            toValue: primaryCandidate.communicationChannelId,
          },
        });
        return reply.code(201).send(await loadFamilyResponse(quote.id));
      } catch (err) {
        const codeCollision = replyDocumentCodeCollision(
          request,
          reply,
          err,
          'client_quote.create.conflict',
          'client_quote',
        );
        if (codeCollision) return codeCollision;
        const dup = getUniqueViolation(err);
        if (dup && (dup.constraint === 'quotes_pkey' || dup.detail?.includes('(id)'))) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Quote ID already exists',
            action: 'client_quote.create.conflict',
            entityType: 'client_quote',
            details: { secondaryLabel: 'duplicate_id' },
          });
        }
        const autoOfferConflict = await replyAutoOfferUniqueViolation(request, reply, dup, {
          action: 'client_quote.create.conflict',
          quoteId: nextIdResult.value ?? 'auto',
        });
        if (autoOfferConflict) return autoOfferConflict;
        request.log.error({ err }, 'CRITICAL ERROR creating quote');
        return reply.code(500).send({ error: `Internal Server Error: ${(err as Error).message}` });
      }
    },
  );

  // PUT /:id - Update quote
  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('sales.client_quotes.update')],
      schema: {
        tags: ['client-quotes'],
        summary: 'Update client quote',
        params: idParamSchema,
        body: quoteUpdateBodySchema,
        response: {
          200: quoteSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const {
        id: nextId,
        clientId,
        clientName,
        items,
        candidates,
        paymentTerms,
        discount,
        discountType,
        status,
        expirationDate,
        communicationChannelId,
        notes,
      } = request.body as {
        id: unknown;
        clientId: unknown;
        clientName: unknown;
        items: unknown;
        candidates?: unknown;
        paymentTerms: unknown;
        discount: unknown;
        discountType: unknown;
        status: unknown;
        expirationDate: unknown;
        communicationChannelId: unknown;
        notes: unknown;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      // One declared field set, three derived guards (issue #779): `hasNonExpirationContentUpdate`
      // drives the expired read-only rule (everything except the expiration date and status is
      // frozen), `hasNonStatusOrIdUpdates` adds the date field for the terminal read-only rule
      // (transitions and id renames stay allowed), and `isIdOnlyUpdate` further excludes status.
      // Deriving keeps the three in lock-step when a PUT body field is added.
      const hasNonExpirationContentUpdate =
        clientId !== undefined ||
        clientName !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        discount !== undefined ||
        discountType !== undefined ||
        communicationChannelId !== undefined ||
        notes !== undefined;
      const hasNonStatusOrIdUpdates = hasNonExpirationContentUpdate || expirationDate !== undefined;
      const isIdOnlyUpdate =
        nextId !== undefined && status === undefined && !hasNonStatusOrIdUpdates;

      // Independent gate reads, fetched together (one round-trip) and checked in the usual order.
      const [linkedOfferId, current] = await Promise.all([
        clientQuotesRepo.findLinkedOfferId(idResult.value),
        clientQuotesRepo.findCurrent(idResult.value),
      ]);
      if (!current) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Quote not found',
          action: 'client_quote.update.not_found',
          entityType: 'client_quote',
          entityId: idResult.value,
        });
      }
      const currentStatus = current.status;
      const currentEffective = effectiveQuoteStatusFromDate(current.status, current.expirationDate);
      const existingDiscount = current.discount;
      const existingDiscountType = current.discountType;

      if (candidates !== undefined) {
        if (!Array.isArray(candidates) || candidates.length === 0) {
          return badRequest(reply, 'Candidates must be a non-empty array');
        }
        if (
          linkedOfferId ||
          normalizeQuoteStatus(currentStatus) === 'offer' ||
          isTerminalQuoteStatus(currentStatus)
        ) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Candidate families are read-only after promotion or finalization',
            action: 'client_quote.update.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'candidate_family_read_only' },
          });
        }
        if (status === 'offer' || status === 'accepted') {
          return badRequest(reply, 'Use the candidate promotion endpoint to create an offer');
        }
        let candidateFamilyId = idResult.value;
        if (nextId !== undefined) {
          const nextIdResult = requireNonEmptyString(nextId, 'id');
          if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
          candidateFamilyId = nextIdResult.value;
          if (
            candidateFamilyId !== idResult.value &&
            (await clientQuotesRepo.findIdConflict(candidateFamilyId, idResult.value))
          ) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'Quote ID already exists',
              action: 'client_quote.update.conflict',
              entityType: 'client_quote',
              entityId: idResult.value,
              details: { secondaryLabel: 'duplicate_id', toValue: candidateFamilyId },
            });
          }
        }
        const [existingCandidates, existingSnapshots] = await Promise.all([
          quoteCandidatesRepo.listForQuote(idResult.value),
          clientQuotesRepo.findItemSnapshotsForQuote(idResult.value),
        ]);
        const preparedCandidates: PreparedCandidate[] = [];
        const names = new Set<string>();
        for (let index = 0; index < candidates.length; index++) {
          const prepared = await prepareCandidateBody(
            candidates[index],
            index,
            reply,
            existingSnapshots,
          );
          if (!prepared) return;
          const normalizedName = prepared.name.toLocaleLowerCase();
          if (names.has(normalizedName)) {
            return badRequest(reply, 'Candidate names must be unique within a quote');
          }
          names.add(normalizedName);
          preparedCandidates.push(prepared);
        }
        const existingActiveIds = new Set<string>();
        for (const candidate of existingCandidates) {
          if (candidate.state === 'active') existingActiveIds.add(candidate.id);
        }
        const foreignCandidate = preparedCandidates.find(
          (candidate) => candidate.id && !existingActiveIds.has(candidate.id),
        );
        if (foreignCandidate) {
          return badRequest(
            reply,
            `Candidate "${foreignCandidate.id}" does not belong to this quote family`,
          );
        }
        const submittedExistingIds = preparedCandidates
          .map((candidate) => candidate.id)
          .filter((candidateId): candidateId is string => Boolean(candidateId));
        if (currentStatus !== 'draft') {
          const submittedSet = new Set(submittedExistingIds);
          if (
            preparedCandidates.length !== existingActiveIds.size ||
            submittedSet.size !== existingActiveIds.size ||
            Array.from(existingActiveIds).some((candidateId) => !submittedSet.has(candidateId))
          ) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'Candidates can only be added or removed while the quote is in draft status',
              action: 'client_quote.update.conflict',
              entityType: 'client_quote',
              entityId: idResult.value,
              details: { secondaryLabel: 'candidate_composition_locked' },
            });
          }
        }
        const clientIdValue = requireNonEmptyString(clientId, 'clientId');
        if (!clientIdValue.ok) return badRequest(reply, clientIdValue.message);
        const clientNameValue = requireNonEmptyString(clientName, 'clientName');
        if (!clientNameValue.ok) return badRequest(reply, clientNameValue.message);
        let requestedStatus = currentStatus;
        if (status !== undefined) {
          if (typeof status !== 'string' || !status) {
            return badRequest(reply, 'status must be one of draft, sent, offer, accepted, denied');
          }
          const parsedStatus = parseQuoteStatusInput(status);
          if (parsedStatus === null) {
            return badRequest(reply, 'status must be one of draft, sent, offer, accepted, denied');
          }
          if (parsedStatus === 'offer' || parsedStatus === 'accepted') {
            return badRequest(reply, 'Use the candidate promotion endpoint to create an offer');
          }
          requestedStatus = parsedStatus;
        }
        if (
          requestedStatus !== currentStatus &&
          !canTransitionClientQuote(currentStatus, requestedStatus)
        ) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'This status transition is not allowed',
            action: 'client_quote.update.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: {
              secondaryLabel: 'invalid_transition',
              fromValue: currentStatus,
              toValue: requestedStatus,
            },
          });
        }
        if (normalizeQuoteStatus(requestedStatus) === 'sent') {
          const sourcedExpiration = await supplierQuotesRepo.findEarliestExpirationByIds(
            await sourcedSupplierQuoteIds(
              preparedCandidates.flatMap((candidate) => candidate.items),
            ),
          );
          if (
            await blockIfSourcedSupplierExpired(
              requestedStatus,
              sourcedExpiration,
              idResult.value,
              request,
              reply,
            )
          ) {
            return;
          }
        }
        type CandidateFamilySaveResult =
          | { kind: 'not_found' }
          | { kind: 'conflict'; message: string; secondaryLabel: string }
          | { kind: 'success'; parent: clientQuotesRepo.ClientQuote };
        let familyResult: CandidateFamilySaveResult;
        try {
          familyResult = await withDbTransaction(async (tx) => {
            // Serialize family edits with promotion/restore, which lock the same parent first.
            const lockedCurrent = await clientQuotesRepo.lockCurrentById(idResult.value, tx);
            if (!lockedCurrent) return { kind: 'not_found' as const };
            if (
              normalizeQuoteStatus(lockedCurrent.status) !== normalizeQuoteStatus(currentStatus)
            ) {
              return {
                kind: 'conflict' as const,
                message: 'The quote changed while its candidates were being saved',
                secondaryLabel: 'candidate_family_changed',
              };
            }
            const lockedCandidates = await quoteCandidatesRepo.listForQuote(idResult.value, tx);
            const lockedActiveIds = new Set<string>();
            for (const candidate of lockedCandidates) {
              if (candidate.state === 'active') lockedActiveIds.add(candidate.id);
            }
            if (
              lockedActiveIds.size !== existingActiveIds.size ||
              Array.from(existingActiveIds).some((candidateId) => !lockedActiveIds.has(candidateId))
            ) {
              return {
                kind: 'conflict' as const,
                message: 'The candidate family changed while it was being saved',
                secondaryLabel: 'candidate_family_changed',
              };
            }

            const lockedFamilyExpired = isCandidateFamilyExpired(
              lockedCandidates,
              effectiveQuoteStatusFromDate(lockedCurrent.status, lockedCurrent.expirationDate) ===
                'expired',
            );
            if (lockedFamilyExpired) {
              const [lockedParent, lockedItems] = await Promise.all([
                clientQuotesRepo.findById(idResult.value, tx),
                clientQuotesRepo.findItemsForQuote(idResult.value, tx),
              ]);
              if (
                !lockedParent ||
                !isExpirationOnlyCandidateFamilyUpdate({
                  quoteId: idResult.value,
                  nextQuoteId: candidateFamilyId,
                  parent: lockedParent,
                  clientId: clientIdValue.value,
                  clientName: clientNameValue.value,
                  requestedStatus,
                  submittedCandidates: preparedCandidates,
                  existingCandidates: lockedCandidates,
                  existingItems: lockedItems,
                })
              ) {
                return {
                  kind: 'conflict' as const,
                  message: 'Expired quotes are read-only; extend the expiration date instead',
                  secondaryLabel: 'expired_read_only',
                };
              }
            }

            await snapshotPreState(idResult.value, 'update', request, tx);
            const first = preparedCandidates[0];
            const parent = await clientQuotesRepo.update(
              idResult.value,
              {
                clientId: clientIdValue.value,
                clientName: clientNameValue.value,
                paymentTerms: first.paymentTerms,
                discount: first.discount,
                discountType: first.discountType,
                status: requestedStatus,
                expirationDate: first.expirationDate,
                communicationChannelId: first.communicationChannelId,
                notes: first.notes,
              },
              tx,
            );
            if (!parent) return { kind: 'not_found' as const };

            // Apply the final candidate-name set without exposing intermediate uniqueness
            // conflicts (for example A↔B swaps, or A taking the name of a removed B).
            if (currentStatus === 'draft') {
              await quoteCandidatesRepo.deleteMissingActive(
                idResult.value,
                submittedExistingIds,
                tx,
              );
            }
            const submittedNamesById = new Map<string, string>();
            for (const candidate of preparedCandidates) {
              if (candidate.id) submittedNamesById.set(candidate.id, candidate.name);
            }
            const stageNameUpdates: Array<Promise<quoteCandidatesRepo.QuoteCandidate | null>> = [];
            for (const candidate of lockedCandidates) {
              const submittedName = submittedNamesById.get(candidate.id);
              if (
                candidate.state !== 'active' ||
                !submittedName ||
                candidate.name.toLocaleLowerCase() === submittedName.toLocaleLowerCase()
              ) {
                continue;
              }
              stageNameUpdates.push(
                quoteCandidatesRepo.update(
                  idResult.value,
                  candidate.id,
                  {
                    name: generatePrefixedId('qc-stage'),
                    position: candidate.position,
                    paymentTerms: candidate.paymentTerms,
                    discount: candidate.discount,
                    discountType: candidate.discountType,
                    expirationDate: candidate.expirationDate,
                    communicationChannelId: candidate.communicationChannelId,
                    notes: candidate.notes,
                  },
                  tx,
                ),
              );
            }
            const stagedCandidates = await Promise.all(stageNameUpdates);
            if (stagedCandidates.some((candidate) => !candidate)) {
              throw new Error('Candidate disappeared while staging names');
            }

            await Promise.all(
              preparedCandidates.map(async (input, index) => {
                const candidateId =
                  input.id && lockedActiveIds.has(input.id) ? input.id : generatePrefixedId('qc');
                const candidate = lockedActiveIds.has(candidateId)
                  ? await quoteCandidatesRepo.update(
                      idResult.value,
                      candidateId,
                      {
                        name: input.name,
                        position: index,
                        paymentTerms: input.paymentTerms,
                        discount: input.discount,
                        discountType: input.discountType,
                        expirationDate: input.expirationDate,
                        communicationChannelId: input.communicationChannelId,
                        notes: input.notes,
                      },
                      tx,
                    )
                  : await quoteCandidatesRepo.insert(
                      {
                        id: candidateId,
                        quoteId: idResult.value,
                        name: input.name,
                        position: index,
                        state: 'active',
                        paymentTerms: input.paymentTerms,
                        discount: input.discount,
                        discountType: input.discountType,
                        expirationDate: input.expirationDate,
                        communicationChannelId: input.communicationChannelId,
                        notes: input.notes,
                      },
                      tx,
                    );
                if (!candidate) throw new Error('Candidate disappeared during update');
                await clientQuotesRepo.replaceItems(
                  idResult.value,
                  buildItemsForInsert(input.items),
                  tx,
                  candidateId,
                );
                // Draft/sent candidates are intentionally isolated supplier snapshots. Do not push
                // quantity or cost back to the source here: promotion synchronizes only the winner.
              }),
            );
            if (candidateFamilyId !== idResult.value) {
              const renamedParent = await clientQuotesRepo.rename(
                idResult.value,
                candidateFamilyId,
                tx,
              );
              if (!renamedParent) return { kind: 'not_found' as const };
              await reserveDocumentCodeCounterFromCode('client_quote', candidateFamilyId, tx);
              return { kind: 'success' as const, parent: renamedParent };
            }
            return { kind: 'success' as const, parent };
          });
        } catch (error) {
          const codeCollision = replyDocumentCodeCollision(
            request,
            reply,
            error,
            'client_quote.update.conflict',
            'client_quote',
          );
          if (codeCollision) return codeCollision;
          const duplicate = getUniqueViolation(error);
          if (duplicate?.constraint === 'idx_quote_candidates_quote_name_unique') {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'Candidate names must be unique within a quote',
              action: 'client_quote.update.conflict',
              entityType: 'client_quote',
              entityId: idResult.value,
              details: { secondaryLabel: 'duplicate_candidate_name' },
            });
          }
          if (
            duplicate &&
            (duplicate.constraint === 'quotes_pkey' || duplicate.detail?.includes('(id)'))
          ) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'Quote ID already exists',
              action: 'client_quote.update.conflict',
              entityType: 'client_quote',
              entityId: idResult.value,
              details: { secondaryLabel: 'duplicate_id', toValue: candidateFamilyId },
            });
          }
          throw error;
        }
        if (familyResult.kind === 'conflict') {
          return replyError(request, reply, {
            statusCode: 409,
            message: familyResult.message,
            action: 'client_quote.update.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: familyResult.secondaryLabel },
          });
        }
        if (familyResult.kind === 'not_found') {
          return replyError(request, reply, {
            statusCode: 404,
            message: 'Quote not found',
            action: 'client_quote.update.not_found',
            entityType: 'client_quote',
            entityId: idResult.value,
          });
        }
        const didStatusChange =
          normalizeQuoteStatus(requestedStatus) !== normalizeQuoteStatus(currentStatus);
        await logAudit({
          request,
          action: 'client_quote.updated',
          entityType: 'client_quote',
          entityId: familyResult.parent.id,
          details: {
            targetLabel: familyResult.parent.id,
            secondaryLabel: familyResult.parent.clientName,
            fromValue: didStatusChange ? String(currentStatus) : undefined,
            toValue: didStatusChange ? String(requestedStatus) : undefined,
          },
        });
        return loadFamilyResponse(familyResult.parent.id);
      }
      // Terminal (accepted/denied) quotes are frozen — only an id rename is allowed (issue #779;
      // replaces the legacy `confirmed` literal). This guard blocks content/date edits; the
      // status-change freeze is enforced in the statusChanged block below. Mirrors the frontend,
      // which already locks accepted/denied forms.
      if (isTerminalQuoteStatus(currentStatus) && hasNonStatusOrIdUpdates) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Accepted or rejected quotes are read-only',
          action: 'client_quote.update.conflict',
          entityType: 'client_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'terminal_read_only', fromValue: currentStatus },
        });
      }
      // Expired quotes are content-read-only EXCEPT their expiration date — a plain expirationDate
      // write is how a quote leaves `expired` (issue #779). Mirrors the frontend (form locked but the
      // date editable) and the supplier-quote rule; status changes are handled by the freeze below.
      if (currentEffective === 'expired' && hasNonExpirationContentUpdate) {
        return replyExpiredQuoteReadOnly(idResult.value, request, reply);
      }

      let nextIdValue: string | undefined;
      if (nextId !== undefined) {
        const nextIdResult = requireNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (await clientQuotesRepo.findIdConflict(nextIdValue, idResult.value)) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Quote ID already exists',
            action: 'client_quote.update.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'duplicate_id', toValue: nextIdValue },
          });
        }
      }

      let clientIdValue = clientId;
      if (clientId !== undefined) {
        const clientIdResult = optionalNonEmptyString(clientId, 'clientId');
        if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
        clientIdValue = clientIdResult.value;
      }

      let clientNameValue = clientName;
      if (clientName !== undefined) {
        const clientNameResult = optionalNonEmptyString(clientName, 'clientName');
        if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);
        clientNameValue = clientNameResult.value;
      }

      let expirationDateValue = expirationDate;
      if (expirationDate !== undefined) {
        const expirationDateResult = optionalDateString(expirationDate, 'expirationDate');
        if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);
        expirationDateValue = expirationDateResult.value;
      }

      const discountTypeValue: 'currency' | 'percentage' | undefined =
        discountType === undefined
          ? undefined
          : discountType === 'currency'
            ? 'currency'
            : 'percentage';
      const effectiveDiscountType = discountTypeValue ?? existingDiscountType;
      const discountResult = optionalLocalizedDocumentDiscount(
        discount === undefined ? existingDiscount : discount,
        effectiveDiscountType,
        'discount',
      );
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const discountValue = discount === undefined ? undefined : discountResult.value;

      const communicationChannel = await resolveCommunicationChannel(
        communicationChannelId,
        reply,
        {
          required: false,
        },
      );
      if (communicationChannelId !== undefined && !communicationChannel) return;

      const effectiveDiscount = discountValue ?? existingDiscount;

      // Strict write-path parse (issue #779): canonical + known legacy spellings only. Anything
      // else — a typo, or the derived-only `expired` round-tripped from a GET — is a 400 here;
      // normalizeQuoteStatus's draft floor would instead silently demote the quote. `targetStatus`
      // is `const` so its non-null narrowing flows into the `statusChanged` block below (`null`
      // means no status field in the body).
      const targetStatus =
        status === undefined
          ? null
          : parseQuoteStatusInput(typeof status === 'string' ? status : '');
      if (status !== undefined && targetStatus === null) {
        return badRequest(reply, 'status must be one of draft, sent, offer, accepted, denied');
      }
      if (targetStatus === 'offer' || targetStatus === 'accepted') {
        return badRequest(reply, 'Use the candidate promotion endpoint to create an offer');
      }
      // Only enforce the status rules when the status ACTUALLY changes — the edit forms resend the
      // current status on every save, so a no-op resend (e.g. draft→draft, or re-saving an expired
      // quote while extending its date) must not trip the transition/expired/guard checks (#779).
      const statusChanged =
        targetStatus !== null && targetStatus !== normalizeQuoteStatus(current.status);
      const isLinkedOfferRollback =
        Boolean(linkedOfferId) &&
        statusChanged &&
        normalizeQuoteStatus(current.status) === 'offer' &&
        targetStatus === 'draft' &&
        nextIdValue === undefined &&
        !hasNonStatusOrIdUpdates;
      if (isLinkedOfferRollback) {
        return badRequest(
          reply,
          'Use the promotion rollback endpoint to return this quote to draft',
        );
      }
      const isLinkedOfferStatusNoOp =
        Boolean(linkedOfferId) &&
        targetStatus !== null &&
        !statusChanged &&
        nextIdValue === undefined &&
        !hasNonStatusOrIdUpdates;
      if (linkedOfferId && !isIdOnlyUpdate && !isLinkedOfferStatusNoOp) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Quotes become read-only once an offer exists',
          action: 'client_quote.update.conflict',
          entityType: 'client_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'offer_exists' },
        });
      }
      if (statusChanged) {
        // Scaduto freezes manual status changes — a quote leaves `expired` only by extending its
        // expiration date (a plain expirationDate write, no status change).
        if (currentEffective === 'expired') {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Expired quotes cannot change status; extend the expiration date instead',
            action: 'client_quote.update.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'expired_read_only', fromValue: 'expired' },
          });
        }
        // Back-to-draft only from sent/offer (this also rejects accepted/denied → draft).
        if (!canTransitionClientQuote(current.status, targetStatus)) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'This status transition is not allowed',
            action: 'client_quote.update.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: {
              secondaryLabel: 'invalid_transition',
              fromValue: String(current.status),
              toValue: targetStatus,
            },
          });
        }
        // Terminal (accepted/denied) quotes are frozen: any OTHER status change — reopening
        // accepted→sent or denied→offer, or flipping accepted↔denied — would resurrect a finalized
        // quote that downstream offers/orders may already depend on. The content read-only guard
        // above only fires for content/date edits (hasNonStatusOrIdUpdates), so a status-only PUT
        // would otherwise slip through here (canTransitionClientQuote allows any non-draft target;
        // the back-to-draft case is already rejected just above as invalid_transition).
        if (isTerminalQuoteStatus(current.status)) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Accepted or rejected quotes are read-only',
            action: 'client_quote.update.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'terminal_read_only', fromValue: String(current.status) },
          });
        }
        // Reverting to draft is rejected when the quote already spawned sale orders.
        if (
          targetStatus === 'draft' &&
          (await clientQuotesRepo.findAnyLinkedSale(idResult.value))
        ) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Cannot revert quote with existing sale orders',
            action: 'client_quote.update.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'has_linked_sale_orders' },
          });
        }
      }

      let normalizedItems: ResolvedQuoteItem[] | null = null;
      let previousSyncLines: PreviousClientLine[] = [];
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        const itemsResult = normalizeQuoteItems(items);
        if (!itemsResult.ok) return badRequest(reply, itemsResult.message);
        const incomingItems = itemsResult.items;

        const existingSnapshots = await clientQuotesRepo.findItemSnapshotsForQuote(idResult.value);
        const existingItemsById = indexExistingQuoteItems(existingSnapshots);
        // Previous stored lines for the supplier-item sync's genuine-edit diff (issue #779) —
        // the snapshot shape structurally satisfies PreviousClientLine.
        previousSyncLines = existingSnapshots;

        try {
          normalizedItems = await resolveQuoteItemSnapshots(incomingItems, existingItemsById);
        } catch (err) {
          return badRequest(reply, (err as Error).message);
        }

        const effectiveDiscountType = discountTypeValue ?? existingDiscountType;
        const totals = calculateQuoteTotals(
          normalizedItems,
          effectiveDiscount as number,
          effectiveDiscountType,
        );
        if (!Number.isFinite(totals.total) || totals.total <= 0) {
          return badRequest(reply, 'Total must be greater than 0');
        }
      } else if (discount !== undefined) {
        const itemTotals = await clientQuotesRepo.findItemTotals(idResult.value);
        const effectiveDiscountType = discountTypeValue ?? existingDiscountType;
        const totals = calculateQuoteTotals(
          itemTotals,
          effectiveDiscount as number,
          effectiveDiscountType,
        );
        if (!Number.isFinite(totals.total) || totals.total <= 0) {
          return badRequest(reply, 'Total must be greater than 0');
        }
      }

      // A quote can't progress to sent/offer/accepted while a supplier quote it SOURCES via its
      // lines is EFFECTIVELY expired (issue #779 follow-up — line-sourced, no header link). Use the
      // rewritten lines' sourced supplier quotes when items change; on a status-only advance,
      // resolve the CURRENT lines through the same status-aware helper — the gate's
      // linkedSupplierQuoteExpiration is a raw MIN over dates, which would wrongly block on a
      // terminal-frozen (never-expired) sourced supplier quote (#812 round 10). A plain no-op
      // resend (no status/items change) never reaches the guard; its response value is resolved
      // after the write from the stored lines (see buildQuoteResponse below).
      const sourcedExpiration = normalizedItems
        ? await supplierQuotesRepo.findEarliestExpirationByIds(
            await sourcedSupplierQuoteIds(normalizedItems),
          )
        : statusChanged
          ? await supplierQuotesRepo.findEarliestExpirationByIds(
              await sourcedSupplierQuoteIds(
                await clientQuotesRepo.findItemSnapshotsForQuote(idResult.value),
              ),
            )
          : null;
      if (statusChanged || normalizedItems) {
        const effectiveTarget = statusChanged ? targetStatus : current.status;
        if (
          await blockIfSourcedSupplierExpired(
            effectiveTarget,
            sourcedExpiration,
            idResult.value,
            request,
            reply,
          )
        ) {
          return;
        }
      }

      let result: {
        quote: clientQuotesRepo.ClientQuote | null;
        items: clientQuotesRepo.ClientQuoteItem[];
        syncAudits: SupplierItemSyncAudit[];
      };
      try {
        result = await withDbTransaction(async (tx) => {
          // ID-only renames cascade through the FK and don't alter snapshot content, so we
          // skip them to keep the history clean.
          if (!isIdOnlyUpdate) {
            await snapshotPreState(idResult.value, 'update', request, tx);
          }
          let renamedQuote: clientQuotesRepo.ClientQuote | null = null;
          if (nextIdValue && nextIdValue !== idResult.value) {
            renamedQuote = await clientQuotesRepo.rename(idResult.value, nextIdValue, tx);
            if (!renamedQuote) return { quote: null, items: [], syncAudits: [] };
            await reserveDocumentCodeCounterFromCode('client_quote', nextIdValue, tx);
          }
          // id-only renames have nothing left to write — reuse the row returned by rename().
          const quote =
            isIdOnlyUpdate && renamedQuote
              ? renamedQuote
              : await clientQuotesRepo.update(
                  renamedQuote?.id ?? idResult.value,
                  {
                    clientId: (clientIdValue as string | null | undefined) ?? null,
                    clientName: (clientNameValue as string | null | undefined) ?? null,
                    paymentTerms: (paymentTerms as string | null | undefined) ?? null,
                    discount: (discountValue as number | null | undefined) ?? null,
                    discountType: discountTypeValue ?? null,
                    status: targetStatus,
                    expirationDate: (expirationDateValue as string | null | undefined) ?? null,
                    communicationChannelId: communicationChannel?.id ?? null,
                    notes: notes as string | null | undefined,
                    // The supplier↔client link is line-sourced now (issue #779 follow-up); leave
                    // the vestigial header column untouched (undefined ⇒ no write).
                  },
                  tx,
                );
          if (!quote) return { quote: null, items: [], syncAudits: [] };
          if (
            paymentTerms !== undefined ||
            discount !== undefined ||
            discountType !== undefined ||
            expirationDate !== undefined ||
            communicationChannelId !== undefined ||
            notes !== undefined
          ) {
            const familyCandidates = await quoteCandidatesRepo.listForQuote(quote.id, tx);
            const primaryCandidate =
              familyCandidates.find((candidate) => candidate.state === 'selected') ??
              familyCandidates.find((candidate) => candidate.state === 'active') ??
              familyCandidates[0];
            if (primaryCandidate) {
              const updatedCandidate = await quoteCandidatesRepo.update(
                quote.id,
                primaryCandidate.id,
                {
                  name: primaryCandidate.name,
                  position: primaryCandidate.position,
                  paymentTerms:
                    (paymentTerms as string | null | undefined) ?? primaryCandidate.paymentTerms,
                  discount:
                    (discountValue as number | null | undefined) ?? primaryCandidate.discount,
                  discountType: discountTypeValue ?? primaryCandidate.discountType,
                  expirationDate:
                    (expirationDateValue as string | null | undefined) ??
                    primaryCandidate.expirationDate,
                  communicationChannelId:
                    communicationChannel?.id ?? primaryCandidate.communicationChannelId,
                  notes: notes === undefined ? primaryCandidate.notes : (notes as string | null),
                },
                tx,
              );
              if (!updatedCandidate) throw new Error('Primary quote candidate disappeared');
            }
          }
          const items = normalizedItems
            ? await clientQuotesRepo.replaceItems(
                quote.id,
                buildItemsForInsert(normalizedItems),
                tx,
              )
            : await clientQuotesRepo.findItemsForQuote(quote.id, tx);
          // Bidirectional sync (issue #779): push GENUINE client-side edits of supplier-sourced
          // line fields (quantity, unit cost) onto the referenced supplier quote items,
          // atomically with the quote write. The audit entries are logged after commit.
          const syncAudits = normalizedItems
            ? await syncSupplierItemsFromClientLines(
                request,
                'client_quote.update',
                normalizedItems,
                previousSyncLines,
                tx,
              )
            : [];
          return { quote, items, syncAudits };
        });
      } catch (err) {
        // The client→supplier item sync refuses to write frozen/order-locked supplier quotes or
        // to run without the supplier-quote update grant; the tx rolled back, so the quote write
        // was rejected together with the supplier write (issue #779).
        if (err instanceof SupplierItemSyncError) {
          return replySupplierItemSyncError(request, reply, err, {
            entityType: 'client_quote',
            entityId: idResult.value,
          });
        }
        const codeCollision = replyDocumentCodeCollision(
          request,
          reply,
          err,
          'client_quote.update.conflict',
          'client_offer',
        );
        if (codeCollision) return codeCollision;
        const dup = getUniqueViolation(err);
        if (dup && (dup.constraint === 'quotes_pkey' || dup.detail?.includes('(id)'))) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Quote ID already exists',
            action: 'client_quote.update.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'duplicate_id' },
          });
        }
        const autoOfferConflict = await replyAutoOfferUniqueViolation(request, reply, dup, {
          action: 'client_quote.update.conflict',
          quoteId: idResult.value,
        });
        if (autoOfferConflict) return autoOfferConflict;
        if (err instanceof LinkedOfferRollbackError) {
          return replyError(request, reply, {
            statusCode: 409,
            message: err.message,
            action: 'client_quote.update.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: err.secondaryLabel },
          });
        }
        throw err;
      }

      const updatedQuote = result.quote;
      const updatedItems = result.items;
      if (!updatedQuote) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Quote not found',
          action: 'client_quote.update.not_found',
          entityType: 'client_quote',
          entityId: idResult.value,
        });
      }

      const updatedQuoteId = updatedQuote.id;

      await logSupplierItemSyncAudits(request, result.syncAudits);

      // Audit with the CANONICAL target (the value actually written) — the raw body string could
      // log a phantom transition (e.g. accepted → confirmed) that no longer exists in the DB.
      const nextStatus = targetStatus ?? updatedQuote.status;
      const didStatusChange = statusChanged;

      await logAudit({
        request,
        action: 'client_quote.updated',
        entityType: 'client_quote',
        entityId: updatedQuoteId,
        details: {
          targetLabel: updatedQuoteId,
          secondaryLabel: updatedQuote.clientName,
          fromValue: didStatusChange ? String(currentStatus) : undefined,
          toValue: didStatusChange ? String(nextStatus) : undefined,
        },
      });
      if (statusChanged || typeof expirationDateValue === 'string') {
        const familyResponse = await loadFamilyResponse(updatedQuoteId);
        if (familyResponse?.candidates.length) return familyResponse;
      }
      // Items/status branches already hold the status-aware value (it fed the guard); a no-op
      // resend resolves it from the stored lines so the response flag never reads a raw MIN.
      const responseSourcedExpiration =
        normalizedItems || statusChanged
          ? sourcedExpiration
          : await supplierQuotesRepo.findEarliestExpirationByIds(
              await sourcedSupplierQuoteIds(updatedItems),
            );
      return buildQuoteResponse(updatedQuote, updatedItems, responseSourcedExpiration);
    },
  );

  // ---------------------------------------------------------------------------------------
  // Version history
  // Promote one active candidate and archive its siblings.
  fastify.post(
    '/:id/promote',
    {
      onRequest: [requirePermission('sales.client_quotes.update', 'sales.client_offers.create')],
      schema: {
        tags: ['client-quotes'],
        summary: 'Promote a quote candidate to a customer offer',
        params: idParamSchema,
        body: {
          type: 'object',
          properties: { candidateId: { type: 'string' } },
          required: ['candidateId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              quote: quoteSchema,
              offer: clientOfferSchema,
            },
            required: ['quote', 'offer'],
          },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { candidateId } = request.body as { candidateId: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const candidateIdResult = requireNonEmptyString(candidateId, 'candidateId');
      if (!candidateIdResult.ok) return badRequest(reply, candidateIdResult.message);
      const [quote, candidate] = await Promise.all([
        clientQuotesRepo.findById(idResult.value),
        quoteCandidatesRepo.findById(idResult.value, candidateIdResult.value),
      ]);
      if (!quote || !candidate) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Quote or candidate not found',
          action: 'client_quote.promote.not_found',
          entityType: 'client_quote',
          entityId: idResult.value,
        });
      }
      if (normalizeQuoteStatus(quote.status) !== 'sent' || candidate.state !== 'active') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Only an active candidate of a sent quote can be promoted',
          action: 'client_quote.promote.conflict',
          entityType: 'client_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'candidate_not_promotable' },
        });
      }
      if (isPastLocalDate(candidate.expirationDate)) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'The selected candidate has expired',
          action: 'client_quote.promote.conflict',
          entityType: 'client_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'candidate_expired' },
        });
      }
      const candidateItems = await clientQuotesRepo.findItemsForCandidate(
        idResult.value,
        candidate.id,
      );
      const sourcedExpiration = await supplierQuotesRepo.findEarliestExpirationByIds(
        await sourcedSupplierQuoteIds(candidateItems),
      );
      if (sourcedExpiration && isPastLocalDate(sourcedExpiration)) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'A supplier quote sourced by the selected candidate has expired',
          action: 'client_quote.promote.conflict',
          entityType: 'client_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'linked_supplier_quote_expired' },
        });
      }
      try {
        const result = await withDbTransaction(async (tx) => {
          // Candidate-family saves lock parent first, then candidate rows. Keep the same order here
          // so a concurrent save/promotion cannot form a parent↔candidate deadlock.
          const lockedQuote = await clientQuotesRepo.lockCurrentById(idResult.value, tx);
          const lockedCandidate = await quoteCandidatesRepo.lockById(
            idResult.value,
            candidate.id,
            tx,
          );
          if (!lockedQuote || !lockedCandidate) throw new Error('Quote candidate disappeared');
          const currentQuote = await clientQuotesRepo.findById(idResult.value, tx);
          if (!currentQuote) throw new Error('Quote candidate disappeared');
          if (
            normalizeQuoteStatus(lockedQuote.status) !== 'sent' ||
            lockedCandidate.state !== 'active'
          ) {
            throw new LinkedOfferRollbackError(
              'Candidate is no longer promotable',
              'candidate_not_promotable',
            );
          }
          if (isPastLocalDate(lockedCandidate.expirationDate)) {
            throw new LinkedOfferRollbackError(
              'The selected candidate has expired',
              'candidate_expired',
            );
          }
          const lockedDiscountResult = optionalLocalizedDocumentDiscount(
            lockedCandidate.discount,
            lockedCandidate.discountType,
            'discount',
          );
          if (!lockedDiscountResult.ok) {
            throw new LinkedOfferRollbackError(
              lockedDiscountResult.message,
              'candidate_discount_invalid',
            );
          }
          const items = await clientQuotesRepo.findItemsForCandidate(
            idResult.value,
            lockedCandidate.id,
            tx,
          );
          const lockedSourcedExpiration = await supplierQuotesRepo.findEarliestExpirationByIds(
            await sourcedSupplierQuoteIds(items, tx),
            tx,
          );
          if (lockedSourcedExpiration && isPastLocalDate(lockedSourcedExpiration)) {
            throw new LinkedOfferRollbackError(
              'A supplier quote sourced by the selected candidate has expired',
              'linked_supplier_quote_expired',
            );
          }
          const supplierItemIds = Array.from(
            new Set(
              items
                .map((item) => item.supplierQuoteItemId)
                .filter((itemId): itemId is string => Boolean(itemId)),
            ),
          );
          const [, liveSupplierItems] = await Promise.all([
            snapshotPreState(idResult.value, 'update', request, tx),
            supplierQuotesRepo.findItemsByIds(supplierItemIds, tx),
          ]);
          const promotionBaselines: PreviousClientLine[] = liveSupplierItems.map((item) => ({
            supplierQuoteItemId: item.id,
            quantity: item.quantity,
            supplierQuoteUnitPrice: item.unitPrice,
          }));
          const [syncAudits, offerId] = await Promise.all([
            syncSupplierItemsFromClientLines(
              request,
              'client_quote.promote',
              items,
              promotionBaselines,
              tx,
            ),
            allocateDocumentCode('client_offer', {
              exec: tx,
              sourceCode: currentQuote.id,
            }),
          ]);
          const offer = await clientOffersRepo.create(
            {
              id: offerId,
              linkedQuoteId: currentQuote.id,
              linkedQuoteCandidateId: lockedCandidate.id,
              clientId: currentQuote.clientId,
              clientName: currentQuote.clientName,
              paymentTerms: lockedCandidate.paymentTerms,
              discount: lockedCandidate.discount,
              discountType: lockedCandidate.discountType,
              status: 'draft',
              expirationDate: lockedCandidate.expirationDate,
              notes: lockedCandidate.notes,
            },
            tx,
          );
          const offerItems = await clientOffersRepo.insertItems(
            offer.id,
            buildOfferItemsFromQuoteItems(items),
            tx,
          );
          await quoteCandidatesRepo.markPromoted(currentQuote.id, lockedCandidate.id, tx);
          await clientQuotesRepo.update(
            currentQuote.id,
            {
              status: 'offer',
              paymentTerms: lockedCandidate.paymentTerms,
              discount: lockedCandidate.discount,
              discountType: lockedCandidate.discountType,
              expirationDate: lockedCandidate.expirationDate,
              communicationChannelId: lockedCandidate.communicationChannelId,
              notes: lockedCandidate.notes,
            },
            tx,
          );
          return {
            offer: {
              ...offer,
              items: offerItems,
              effectiveStatus: effectiveQuoteStatusFromDate(offer.status, offer.expirationDate),
            },
            promotedCandidateName: lockedCandidate.name,
            syncAudits,
          };
        });
        await Promise.all([
          logSupplierItemSyncAudits(request, result.syncAudits),
          logAudit({
            request,
            action: 'client_quote.candidate_promoted',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: {
              targetLabel: idResult.value,
              secondaryLabel: result.promotedCandidateName,
              toValue: result.offer.id,
            },
          }),
        ]);
        const family = await loadFamilyResponse(idResult.value);
        return { quote: family, offer: result.offer };
      } catch (error) {
        if (error instanceof SupplierItemSyncError) {
          return replySupplierItemSyncError(request, reply, error, {
            entityType: 'client_quote',
            entityId: idResult.value,
          });
        }
        if (error instanceof LinkedOfferRollbackError) {
          return replyError(request, reply, {
            statusCode: 409,
            message: error.message,
            action: 'client_quote.promote.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: error.secondaryLabel },
          });
        }
        const conflict = await replyAutoOfferUniqueViolation(
          request,
          reply,
          getUniqueViolation(error),
          {
            action: 'client_quote.promote.conflict',
            quoteId: idResult.value,
          },
        );
        if (conflict) return conflict;
        throw error;
      }
    },
  );

  // Roll back a draft offer and reactivate every archived candidate.
  fastify.post(
    '/:id/promotion/rollback',
    {
      onRequest: [requirePermission('sales.client_quotes.update', 'sales.client_offers.delete')],
      schema: {
        tags: ['client-quotes'],
        summary: 'Roll back a promoted candidate while the offer is still draft',
        params: idParamSchema,
        response: { 200: quoteSchema, ...standardErrorResponses },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const offerId = await clientQuotesRepo.findLinkedOfferId(idResult.value);
      if (!offerId) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'This quote has no linked offer to roll back',
          action: 'client_quote.promotion_rollback.conflict',
          entityType: 'client_quote',
          entityId: idResult.value,
        });
      }
      try {
        await withDbTransaction((tx) =>
          rollbackQuotePromotion(
            {
              quoteId: idResult.value,
              offerId,
              createdByUserId: request.user?.id ?? null,
            },
            tx,
          ),
        );
        await logAudit({
          request,
          action: 'client_quote.candidate_promotion_rolled_back',
          entityType: 'client_quote',
          entityId: idResult.value,
          details: { targetLabel: idResult.value, fromValue: offerId, toValue: 'draft' },
        });
        return loadFamilyResponse(idResult.value);
      } catch (error) {
        if (error instanceof QuotePromotionRollbackError) {
          return replyError(request, reply, {
            statusCode: 409,
            message: error.message,
            action: 'client_quote.promotion_rollback.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: error.secondaryLabel },
          });
        }
        throw error;
      }
    },
  );

  // ---------------------------------------------------------------------------------------

  const versionParamSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      versionId: { type: 'string' },
    },
    required: ['id', 'versionId'],
  } as const;

  const quoteVersionRowSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      quoteId: { type: 'string' },
      reason: { type: 'string', enum: ['update', 'restore'] },
      createdByUserId: { type: ['string', 'null'] },
      createdAt: { type: 'number' },
    },
    required: ['id', 'quoteId', 'reason', 'createdAt'],
  } as const;

  const quoteVersionSchema = {
    type: 'object',
    properties: { ...quoteVersionRowSchema.properties, snapshot: {} },
    required: [...quoteVersionRowSchema.required, 'snapshot'],
  } as const;

  // GET /:id/versions - List versions for a quote
  fastify.get(
    '/:id/versions',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.client_quotes.view'),
      ],
      schema: {
        tags: ['client-quotes'],
        summary: 'List versions for a client quote',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: quoteVersionRowSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const [exists, versions] = await Promise.all([
        clientQuotesRepo.existsById(idResult.value),
        quoteVersionsRepo.listForQuote(idResult.value),
      ]);
      if (!exists) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Quote not found',
          action: 'client_quote.versions_list.not_found',
          entityType: 'client_quote',
          entityId: idResult.value,
        });
      }
      return versions;
    },
  );

  // GET /:id/versions/:versionId - Get a single version with its snapshot
  fastify.get(
    '/:id/versions/:versionId',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.client_quotes.view'),
      ],
      schema: {
        tags: ['client-quotes'],
        summary: 'Get a single client quote version',
        params: versionParamSchema,
        response: {
          200: quoteVersionSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, versionId } = request.params as { id: string; versionId: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const versionIdResult = requireNonEmptyString(versionId, 'versionId');
      if (!versionIdResult.ok) return badRequest(reply, versionIdResult.message);

      const version = await quoteVersionsRepo.findById(idResult.value, versionIdResult.value);
      if (!version) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Version not found',
          action: 'client_quote.version_get.not_found',
          entityType: 'client_quote',
          entityId: idResult.value,
          details: { secondaryLabel: versionIdResult.value },
        });
      }
      return version;
    },
  );

  // POST /:id/versions/:versionId/restore - Atomic restore (snapshots current first)
  fastify.post(
    '/:id/versions/:versionId/restore',
    {
      onRequest: [requirePermission('sales.client_quotes.update')],
      schema: {
        tags: ['client-quotes'],
        summary: 'Restore a client quote to a prior version',
        params: versionParamSchema,
        response: {
          200: quoteSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, versionId } = request.params as { id: string; versionId: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const versionIdResult = requireNonEmptyString(versionId, 'versionId');
      if (!versionIdResult.ok) return badRequest(reply, versionIdResult.message);

      type RestoreOutcome =
        | {
            ok: false;
            statusCode: 404 | 409;
            message: string;
            action: string;
            secondaryLabel?: string;
          }
        | {
            ok: true;
            quote: clientQuotesRepo.ClientQuote;
            items: clientQuotesRepo.ClientQuoteItem[];
          };

      // Run all gate reads inside the tx and lock the quote row up front. The lock serializes
      // against concurrent offer-create / sale-create paths that also lock this row, closing
      // the TOCTOU window between the linked-offer / linked-sale checks and the restore write.
      let result: RestoreOutcome;
      try {
        result = await withDbTransaction(async (tx) => {
          const current = await clientQuotesRepo.lockCurrentById(idResult.value, tx);
          if (!current) {
            return {
              ok: false,
              statusCode: 404,
              message: 'Quote not found',
              action: 'client_quote.restore.not_found',
            };
          }
          if (isTerminalQuoteStatus(current.status)) {
            return {
              ok: false,
              statusCode: 409,
              message: 'Accepted or rejected quotes are read-only',
              action: 'client_quote.restore.conflict',
              secondaryLabel: 'terminal_read_only',
            };
          }
          // Expired quotes are content-read-only and the ONLY exit is extending the expiration date
          // (the PUT enforces both, issue #779) — a restore would rewrite content, status AND the
          // date in one shot, so it is blocked symmetrically.
          if (effectiveQuoteStatusFromDate(current.status, current.expirationDate) === 'expired') {
            return {
              ok: false,
              statusCode: 409,
              message: 'Expired quotes are read-only; extend the expiration date instead',
              action: 'client_quote.restore.conflict',
              secondaryLabel: 'expired_read_only',
            };
          }

          const [linkedOfferId, nonDraftLinkedSale, version] = await Promise.all([
            clientQuotesRepo.findLinkedOfferId(idResult.value, tx),
            clientQuotesRepo.findNonDraftLinkedSale(idResult.value, tx),
            quoteVersionsRepo.findById(idResult.value, versionIdResult.value, tx),
          ]);

          if (nonDraftLinkedSale) {
            return {
              ok: false,
              statusCode: 409,
              message: 'Restore is only possible when linked sale orders are in draft status',
              action: 'client_quote.restore.conflict',
              secondaryLabel: 'non_draft_linked_sale',
            };
          }
          if (!version) {
            return {
              ok: false,
              statusCode: 404,
              message: 'Version not found',
              action: 'client_quote.restore.not_found',
              secondaryLabel: versionIdResult.value,
            };
          }
          const missingSnapshotReference = await findMissingSnapshotReference(version.snapshot, tx);
          if (missingSnapshotReference) {
            return {
              ok: false,
              statusCode: 409,
              message: missingSnapshotReference,
              action: 'client_quote.restore.conflict',
              secondaryLabel: 'snapshot_reference_missing',
            };
          }
          const rawSnapshotCandidates = version.snapshot.candidates;
          if (rawSnapshotCandidates.length === 0) {
            return {
              ok: false,
              statusCode: 409,
              message: 'Snapshot candidate family is empty',
              action: 'client_quote.restore.conflict',
              secondaryLabel: 'snapshot_candidates_missing',
            };
          }
          const defaultChannel = rawSnapshotCandidates.some(
            (candidate) => !candidate.communicationChannelId,
          )
            ? await quoteCommunicationChannelsRepo.findDefault(tx)
            : null;
          const snapshotCandidates = rawSnapshotCandidates.map((candidate) => ({
            ...candidate,
            communicationChannelId: candidate.communicationChannelId || defaultChannel?.id || '',
          }));
          const primarySnapshotCandidate = snapshotCandidates[0];
          const snapshotCandidateIds = new Set(snapshotCandidates.map((candidate) => candidate.id));
          const orphanSnapshotItem = version.snapshot.items.find(
            (item) => !snapshotCandidateIds.has(item.candidateId),
          );
          if (orphanSnapshotItem) {
            return {
              ok: false,
              statusCode: 409,
              message: `Snapshot item "${orphanSnapshotItem.id}" has no matching candidate`,
              action: 'client_quote.restore.conflict',
              secondaryLabel: 'snapshot_candidate_mismatch',
            };
          }
          const snapshotItemsByCandidate = new Map<string, typeof version.snapshot.items>();
          for (const item of version.snapshot.items) {
            const items = snapshotItemsByCandidate.get(item.candidateId);
            if (items) items.push(item);
            else snapshotItemsByCandidate.set(item.candidateId, [item]);
          }
          const invalidCandidate = snapshotCandidates.find(
            (candidate) => !candidate.expirationDate || !candidate.communicationChannelId,
          );
          if (invalidCandidate) {
            return {
              ok: false,
              statusCode: 409,
              message: `Snapshot candidate "${invalidCandidate.name}" is incomplete`,
              action: 'client_quote.restore.conflict',
              secondaryLabel: 'snapshot_candidate_invalid',
            };
          }
          for (const candidate of snapshotCandidates) {
            const snapshotDiscountResult = optionalLocalizedDocumentDiscount(
              candidate.discount,
              candidate.discountType,
              'discount',
            );
            if (!snapshotDiscountResult.ok) {
              return {
                ok: false,
                statusCode: 409,
                message: `Snapshot candidate "${candidate.name}" has an invalid discount: ${snapshotDiscountResult.message}`,
                action: 'client_quote.restore.conflict',
                secondaryLabel: 'snapshot_discount_invalid',
              };
            }
          }
          const channelIds = Array.from(
            new Set(snapshotCandidates.map((candidate) => candidate.communicationChannelId)),
          );
          const channels = await Promise.all(
            channelIds.map((channelId) => quoteCommunicationChannelsRepo.findById(channelId, tx)),
          );
          if (channels.some((channel) => !channel)) {
            return {
              ok: false,
              statusCode: 409,
              message: 'A candidate communication channel is no longer available',
              action: 'client_quote.restore.conflict',
              secondaryLabel: 'communication_channel_missing',
            };
          }
          const snapshotExpirationDate = primarySnapshotCandidate.expirationDate;
          // Legacy snapshots may hold quoted/confirmed/received/etc.; fold to the canonical set so
          // the tightened CHECK (migration 0083) doesn't reject the restore write (issue #779).
          const restoredStatus = normalizeQuoteStatus(version.snapshot.quote.status);
          if (restoredStatus === 'offer' || restoredStatus === 'accepted') {
            return {
              ok: false,
              statusCode: 409,
              message: 'Use candidate promotion to recreate an offer from a historical quote',
              action: 'client_quote.restore.conflict',
              secondaryLabel: 'candidate_promotion_required',
            };
          }
          if (linkedOfferId && restoredStatus !== 'draft') {
            return {
              ok: false,
              statusCode: 409,
              message: 'Quotes become read-only once an offer exists',
              action: 'client_quote.restore.conflict',
              secondaryLabel: 'offer_exists',
            };
          }
          // Restoring a snapshot whose status is sent/offer/accepted would park the quote in a
          // progressed state alongside an expired sourced supplier quote — the same transition the
          // PUT guard blocks (issue #779 follow-up). The restore REPLACES the lines with the
          // snapshot's (which carry the supplier sourcing), so the guard must read the SNAPSHOT's
          // earliest sourced expiration, not the pre-restore lines'.
          if (restoredStatus === 'sent') {
            // Only a progressed target can be blocked, so resolve the snapshot's earliest sourced
            // expiration lazily (avoids a supplier_quotes read inside the lock for draft/denied
            // restores). Reuses the same line→sourced-ids extraction as the create/update guards.
            const restoredSourcedExpiration = await supplierQuotesRepo.findEarliestExpirationByIds(
              await sourcedSupplierQuoteIds(version.snapshot.items, tx),
              tx,
            );
            if (restoredSourcedExpiration && isPastLocalDate(restoredSourcedExpiration)) {
              return {
                ok: false,
                statusCode: 409,
                message:
                  'A supplier quote sourced by this quote has expired; extend its validity before progressing this quote',
                action: 'client_quote.restore.conflict',
                secondaryLabel: 'linked_supplier_quote_expired',
              };
            }
          }
          // Drop draft sales inside the tx - historical line items may not line up with the

          // current draft sale's row references, but if the snapshot/update later fails the
          // rollback must take the deletes with it (otherwise users lose draft orders for
          // an unchanged quote).
          // Snapshot current with reason='restore' so the just-replaced data stays recoverable.
          await Promise.all([
            clientQuotesRepo.deleteDraftSalesForQuote(idResult.value, tx),
            snapshotPreState(idResult.value, 'restore', request, tx),
          ]);
          if (linkedOfferId) {
            await deleteDraftLinkedOfferForRollback(linkedOfferId, tx);
          }
          await quoteCandidatesRepo.deleteAllForQuote(idResult.value, tx);

          const quote = await clientQuotesRepo.restoreSnapshotQuote(
            idResult.value,
            {
              clientId: version.snapshot.quote.clientId,
              clientName: version.snapshot.quote.clientName,
              paymentTerms: primarySnapshotCandidate.paymentTerms,
              discount: primarySnapshotCandidate.discount,
              discountType: primarySnapshotCandidate.discountType,
              status: restoredStatus,
              expirationDate: snapshotExpirationDate,
              communicationChannelId: primarySnapshotCandidate.communicationChannelId,
              notes: primarySnapshotCandidate.notes,
            },
            tx,
          );
          if (!quote) {
            return {
              ok: false,
              statusCode: 404,
              message: 'Quote not found',
              action: 'client_quote.restore.not_found',
            };
          }
          const restoredItems = (
            await Promise.all(
              snapshotCandidates.map(async (snapshotCandidate, candidateIndex) => {
                const candidateId = candidateIndex === 0 ? quote.id : generatePrefixedId('qc');
                await quoteCandidatesRepo.insert(
                  {
                    id: candidateId,
                    quoteId: quote.id,
                    name: snapshotCandidate.name,
                    position: candidateIndex,
                    state: 'active',
                    paymentTerms: snapshotCandidate.paymentTerms,
                    discount: snapshotCandidate.discount,
                    discountType: snapshotCandidate.discountType,
                    expirationDate: snapshotCandidate.expirationDate,
                    communicationChannelId: snapshotCandidate.communicationChannelId,
                    notes: snapshotCandidate.notes,
                  },
                  tx,
                );
                const candidateItems = (
                  snapshotItemsByCandidate.get(snapshotCandidate.id) ?? []
                ).map(({ quoteId: _quoteId, candidateId: _candidateId, ...item }, position) => ({
                  ...item,
                  id: generatePrefixedId(ITEM_ID_PREFIXES.clientQuoteItem),
                  position,
                  productId: item.productId || null,
                  productMolPercentage: calculateClientLineMol(item),
                }));
                return clientQuotesRepo.insertItems(quote.id, candidateItems, tx, candidateId);
              }),
            )
          ).flat();
          return { ok: true, quote, items: restoredItems };
        });
      } catch (err) {
        const codeCollision = replyDocumentCodeCollision(
          request,
          reply,
          err,
          'client_quote.restore.conflict',
          'client_offer',
        );
        if (codeCollision) return codeCollision;
        const dup = getUniqueViolation(err);
        const autoOfferConflict = await replyAutoOfferUniqueViolation(request, reply, dup, {
          action: 'client_quote.restore.conflict',
          quoteId: idResult.value,
        });
        if (autoOfferConflict) return autoOfferConflict;
        if (err instanceof LinkedOfferRollbackError) {
          return replyError(request, reply, {
            statusCode: 409,
            message: err.message,
            action: 'client_quote.restore.conflict',
            entityType: 'client_quote',
            entityId: idResult.value,
            details: { secondaryLabel: err.secondaryLabel },
          });
        }
        throw err;
      }

      if (!result.ok) {
        return replyError(request, reply, {
          statusCode: result.statusCode,
          message: result.message,
          action: result.action,
          entityType: 'client_quote',
          entityId: idResult.value,
          details: result.secondaryLabel ? { secondaryLabel: result.secondaryLabel } : undefined,
        });
      }
      const restored = { quote: result.quote, items: result.items };

      await logAudit({
        request,
        action: 'client_quote.restored',
        entityType: 'client_quote',
        entityId: restored.quote.id,
        details: {
          targetLabel: restored.quote.id,
          secondaryLabel: restored.quote.clientName,
          toValue: versionIdResult.value,
        },
      });

      // Status-aware response flag (#812 round 11): resolve the restored lines' blocking
      // expiration the same way the guards do (terminal-frozen sourced quotes excluded).
      return loadFamilyResponse(restored.quote.id);
    },
  );

  // DELETE /:id - Delete quote
  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('sales.client_quotes.delete')],
      schema: {
        tags: ['client-quotes'],
        summary: 'Delete client quote',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as unknown as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (await clientQuotesRepo.findLinkedOfferId(idResult.value)) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Cannot delete a quote once an offer has been created from it',
          action: 'client_quote.delete.conflict',
          entityType: 'client_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'offer_exists' },
        });
      }

      const [status, familyCandidates] = await Promise.all([
        clientQuotesRepo.findStatusAndClientName(idResult.value),
        quoteCandidatesRepo.listForQuote(idResult.value),
      ]);
      if (!status) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Quote not found',
          action: 'client_quote.delete.not_found',
          entityType: 'client_quote',
          entityId: idResult.value,
        });
      }
      if (normalizeQuoteStatus(status.status) === 'accepted') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Cannot delete an accepted quote',
          action: 'client_quote.delete.conflict',
          entityType: 'client_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'accepted_status' },
        });
      }
      // Expired is read-only EVERYWHERE under #779 — the UI already disables deletion, and the
      // only exit is extending the expiration date. Derive it here too so a direct API caller
      // cannot delete what the model freezes (#812 round 25).
      const familyIsExpired =
        !isTerminalQuoteStatus(status.status) &&
        isCandidateFamilyExpired(
          familyCandidates,
          effectiveQuoteStatusFromDate(status.status, status.expirationDate) === 'expired',
        );
      if (familyIsExpired) {
        return replyError(request, reply, {
          statusCode: 409,
          message:
            'Expired quotes are read-only and cannot be deleted; extend the expiration date instead',
          action: 'client_quote.delete.conflict',
          entityType: 'client_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'expired_read_only' },
        });
      }

      await clientQuotesRepo.deleteById(idResult.value);

      await logAudit({
        request,
        action: 'client_quote.deleted',
        entityType: 'client_quote',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: status.clientName ?? '',
        },
      });
      return reply.code(204).send();
    },
  );
}
