import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type DbExecutor, db, withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission, requireRole } from '../middleware/auth.ts';
import * as clientOffersRepo from '../repositories/clientOffersRepo.ts';
import * as clientQuotesRepo from '../repositories/clientQuotesRepo.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import * as offerVersionsRepo from '../repositories/offerVersionsRepo.ts';
import * as productsRepo from '../repositories/productsRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { todayLocalDateOnly } from '../utils/date.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import type { DurationUnit } from '../utils/duration-unit.ts';
import { normalizeNullableNumber, normalizeNullableString } from '../utils/normalize.ts';
import { generatePrefixedId, ITEM_ID_PREFIXES } from '../utils/order-ids.ts';
import { ADMIN_ROLE_ID, TOP_MANAGER_ROLE_ID } from '../utils/permissions.ts';
import {
  effectiveQuoteStatusFromDate,
  normalizeQuoteStatus,
  parseQuoteStatusInput,
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
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  parseLocalizedPositiveNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

// Surfaced for both the gate-check inside the create-tx and the catch on the unique-index
// violation; keep them identical so the error doesn't drift between paths.
const LINKED_OFFER_CONFLICT = 'An offer already exists for this quote';
const TERMINAL_OFFER_STATUSES = new Set(['accepted', 'denied']);

// Shared guard texts — the PUT and restore paths both raise these; keep them identical so the
// error doesn't drift between paths (issue #779).
const NON_DRAFT_READ_ONLY_ERROR = 'Non-draft offers are read-only';
const EXPIRED_READ_ONLY_ERROR = 'Expired offers are read-only; extend the expiration date instead';
// `offer` is canonical for the QUOTE pipeline but not a customer-offer status, so the strict
// parse below rejects it alongside unknown spellings.
const OFFER_STATUS_INPUT_ERROR = 'status must be one of draft, sent, accepted, denied';

// Derived #779 status for responses: `expired` overrides a non-terminal stored status once the
// offer's own expiration date has passed; accepted/denied are frozen and never expire. Mirrors
// the client-quote `effectiveStatus` field.
const projectOffer = <T extends { status: string; expirationDate: string | null }>(offer: T) => ({
  ...offer,
  effectiveStatus: effectiveQuoteStatusFromDate(offer.status, offer.expirationDate),
});
const TERMINAL_REVERT_ERROR = 'Terminal offers must be reverted through the revert-to-draft action';
const TERMINAL_REVERT_ROLE_ERROR = 'Only Top Manager or Admin can revert terminal offers to draft';
const TERMINAL_REVERT_LINKED_SALE_ERROR =
  'Cannot revert an offer once a sale order has been created from it';

const canRevertTerminalOfferStatus = (request: FastifyRequest) =>
  request.user?.role === TOP_MANAGER_ROLE_ID || request.user?.role === ADMIN_ROLE_ID;

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const offerItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    offerId: { type: 'string' },
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
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    note: { type: ['string', 'null'] },
    discount: { type: 'number' },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
  },
  required: ['id', 'offerId', 'productName', 'quantity', 'unitPrice', 'productCost', 'discount'],
} as const;

const offerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string' },
    // Derived (issue #779): `expired` overrides draft/sent once the expiration date has passed;
    // accepted/denied are frozen and never expire.
    effectiveStatus: {
      type: 'string',
      enum: ['draft', 'sent', 'accepted', 'denied', 'expired'],
    },
    deliveryDate: { type: ['string', 'null'], format: 'date' },
    expirationDate: { type: ['string', 'null'], format: 'date' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: offerItemSchema },
  },
  required: [
    'id',
    'linkedQuoteId',
    'clientId',
    'clientName',
    'discount',
    'discountType',
    'status',
    'effectiveStatus',
    'createdAt',
    'updatedAt',
    'items',
  ],
} as const;

const offerItemBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    productId: { type: 'string' },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    // Nullable: Ajv's coerceTypes would otherwise fold a null into 0 — lying about the value and,
    // for supplierQuoteUnitPrice, feeding a phantom 0-cost into the #779 supplier-item sync.
    productMolPercentage: { type: ['number', 'null'] },
    supplierQuoteId: { type: ['string', 'null'] },
    supplierQuoteItemId: { type: ['string', 'null'] },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    discount: { type: 'number' },
    note: { type: 'string' },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
  },
  // unitType is required: it drives per-unit pricing (a 'days' line bills at 8x the hourly rate)
  // and is stored on every line, so the API must not silently default the unit. Mirrors invoices'
  // required unitOfMeasure.
  required: ['productName', 'quantity', 'unitPrice', 'unitType'],
} as const;

const offerCreateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: offerItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string' },
    deliveryDate: { type: ['string', 'null'], format: 'date' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
  required: ['id', 'linkedQuoteId', 'clientId', 'clientName', 'items', 'expirationDate'],
} as const;

const offerUpdateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: offerItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string' },
    deliveryDate: { type: ['string', 'null'], format: 'date' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
} as const;

const offerRevertToDraftBodySchema = {
  type: 'object',
  properties: {
    reason: { type: 'string' },
  },
  additionalProperties: false,
} as const;

type OfferItemInput = {
  id?: string;
  productId?: string;
  productName?: string;
  quantity?: string | number;
  unitPrice?: string | number;
  productCost?: string | number;
  productMolPercentage?: string | number | null;
  supplierQuoteId?: string | null;
  supplierQuoteItemId?: string | null;
  supplierQuoteSupplierName?: string | null;
  supplierQuoteUnitPrice?: string | number | null;
  unitType?: UnitType;
  discount?: string | number;
  note?: string;
  durationMonths?: string | number;
  durationUnit?: string;
};

type NormalizedOfferItem = {
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  productCost: number;
  productMolPercentage: number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
  unitType: UnitType;
  discount: number;
  note: string | null;
  durationMonths: number;
  durationUnit: DurationUnit;
};

const normalizeItems = (
  items: OfferItemInput[],
  reply: FastifyReply,
): NormalizedOfferItem[] | null => {
  const normalizedItems: NormalizedOfferItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const productNameResult = requireNonEmptyString(item.productName, `items[${i}].productName`);
    if (!productNameResult.ok) {
      badRequest(reply, productNameResult.message);
      return null;
    }
    const quantityResult = parseLocalizedPositiveNumber(item.quantity, `items[${i}].quantity`);
    if (!quantityResult.ok) {
      badRequest(reply, quantityResult.message);
      return null;
    }
    const unitPriceResult = parseLocalizedNonNegativeNumber(
      item.unitPrice,
      `items[${i}].unitPrice`,
    );
    if (!unitPriceResult.ok) {
      badRequest(reply, unitPriceResult.message);
      return null;
    }
    // Mirror the client-quote path: a retained supplier-sourced line can carry an edited
    // supplierQuoteUnitPrice that the #779 forward sync writes back onto the supplier quote item,
    // so it must be validated non-negative here. normalizeNullableNumber alone let a direct PUT
    // push a negative supplier cost (negative supplier unit/list prices) through the sync.
    const supplierQuoteUnitPriceResult = optionalLocalizedNonNegativeNumber(
      item.supplierQuoteUnitPrice,
      `items[${i}].supplierQuoteUnitPrice`,
    );
    if (!supplierQuoteUnitPriceResult.ok) {
      badRequest(reply, supplierQuoteUnitPriceResult.message);
      return null;
    }
    const itemDiscountResult = optionalLocalizedNonNegativeNumber(
      item.discount,
      `items[${i}].discount`,
    );
    if (!itemDiscountResult.ok) {
      badRequest(reply, itemDiscountResult.message);
      return null;
    }
    const durationMonthsResult = optionalDurationMonths(
      item.durationMonths,
      `items[${i}].durationMonths`,
    );
    if (!durationMonthsResult.ok) {
      badRequest(reply, durationMonthsResult.message);
      return null;
    }
    const durationUnitResult = optionalDurationUnit(item.durationUnit, `items[${i}].durationUnit`);
    if (!durationUnitResult.ok) {
      badRequest(reply, durationUnitResult.message);
      return null;
    }
    const unitType = normalizeUnitType(item.unitType);
    const durationMonths = durationMonthsResult.value ?? 1;
    const durationUnit = durationUnitResult.value ?? 'months';
    normalizedItems.push({
      productId: item.productId || null,
      productName: productNameResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      productCost: Number(item.productCost ?? 0),
      productMolPercentage: normalizeNullableNumber(item.productMolPercentage),
      supplierQuoteId: normalizeNullableString(item.supplierQuoteId),
      supplierQuoteItemId: normalizeNullableString(item.supplierQuoteItemId),
      supplierQuoteSupplierName: normalizeNullableString(item.supplierQuoteSupplierName),
      supplierQuoteUnitPrice: supplierQuoteUnitPriceResult.value,
      unitType,
      discount: itemDiscountResult.value || 0,
      note: normalizeNullableString(item.note),
      durationMonths,
      durationUnit,
    });
  }

  return normalizedItems;
};

// Server-side supplier-link resolution (issue #779), mirroring the client-quotes route: a
// FRESHLY picked link takes its cost and metadata from the live supplier item — the client's
// cached copy may be stale, and storing/pushing it verbatim would let an outdated browser revert
// newer supplier pricing. A RETAINED link stays client-authoritative for the cost (that edit is
// pushed back onto the supplier item by the forward sync). "Retained" is keyed on
// supplierQuoteItemId: offer items get fresh row ids on every save, so the link itself is the
// only stable correlation. Throws on a NEW link whose id doesn't resolve; a retained link
// tolerates a vanished supplier item (legacy dangle) by keeping the stored metadata.
// `inheritedItemIds` are the LINKED QUOTE's sourced supplier item ids: offers are created by
// converting a quote, which copies its sourced lines verbatim while the supplier quote already
// derives offer/accepted — those links are exempt from the fresh-link sourceable check (#812
// round 15); any other fresh link must reference a quote the picker would offer.
const resolveOfferItemSupplierLinks = async (
  items: NormalizedOfferItem[],
  existingItems: clientOffersRepo.ClientOfferItem[] | null,
  inheritedItemIds: ReadonlySet<string>,
): Promise<NormalizedOfferItem[]> => {
  const linkedIds = items
    .map((item) => item.supplierQuoteItemId)
    .filter((id): id is string => id !== null);
  if (linkedIds.length === 0) return items;
  const snapshots = await supplierQuotesRepo.getQuoteItemSnapshots(linkedIds);
  const existingByLink = new Map<string, clientOffersRepo.ClientOfferItem>();
  for (const existing of existingItems ?? []) {
    if (existing.supplierQuoteItemId && !existingByLink.has(existing.supplierQuoteItemId)) {
      existingByLink.set(existing.supplierQuoteItemId, existing);
    }
  }
  return items.map((item) => {
    if (!item.supplierQuoteItemId) return item;
    const snapshot = snapshots.get(item.supplierQuoteItemId);
    const existing = existingByLink.get(item.supplierQuoteItemId);
    if (!snapshot) {
      if (existing) {
        return {
          ...item,
          supplierQuoteId: existing.supplierQuoteId ?? item.supplierQuoteId,
          supplierQuoteSupplierName:
            existing.supplierQuoteSupplierName ?? item.supplierQuoteSupplierName,
          supplierQuoteUnitPrice:
            item.supplierQuoteUnitPrice ?? existing.supplierQuoteUnitPrice ?? null,
        };
      }
      throw new Error(
        `supplierQuoteItemId "${item.supplierQuoteItemId}" does not reference an existing supplier quote item`,
      );
    }
    // Fresh link (not retained, not inherited from the linked quote): a stale tab or raw API
    // client could otherwise newly source a frozen/order-locked supplier quote, persisting a
    // line the editor immediately locks and the sync rejects (#812 round 15).
    if (
      !existing &&
      !inheritedItemIds.has(item.supplierQuoteItemId) &&
      snapshot.sourceable === false
    ) {
      throw new Error(
        `supplierQuoteItemId "${item.supplierQuoteItemId}" references a supplier quote that is no longer available for new sourcing`,
      );
    }
    return {
      ...item,
      supplierQuoteId: snapshot.supplierQuoteId,
      supplierQuoteSupplierName: snapshot.supplierName,
      supplierQuoteUnitPrice: existing
        ? (item.supplierQuoteUnitPrice ?? existing.supplierQuoteUnitPrice ?? snapshot.netCost)
        : snapshot.netCost,
    };
  });
};

// The linked quote's sourced supplier item ids (the conversion-inheritance exemption above).
const linkedQuoteSourcedItemIds = async (
  linkedQuoteId: string | null | undefined,
): Promise<ReadonlySet<string>> => {
  if (!linkedQuoteId) return new Set<string>();
  const snapshots = await clientQuotesRepo.findItemSnapshotsForQuote(linkedQuoteId);
  return new Set(
    snapshots
      .map((snapshot) => snapshot.supplierQuoteItemId)
      .filter((id): id is string => id != null),
  );
};

const buildItemsForInsert = (items: NormalizedOfferItem[]): clientOffersRepo.NewClientOfferItem[] =>
  items.map((item) => ({
    id: generatePrefixedId(ITEM_ID_PREFIXES.clientOfferItem),
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    productCost: item.productCost,
    productMolPercentage: item.productMolPercentage,
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

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  const snapshotPreState = async (
    offerId: string,
    reason: offerVersionsRepo.OfferVersionReason,
    request: FastifyRequest,
    tx: DbExecutor,
  ) => {
    const pre = await clientOffersRepo.findFullForSnapshot(offerId, tx);
    if (!pre) return;
    await offerVersionsRepo.insert(
      {
        offerId,
        snapshot: offerVersionsRepo.buildSnapshot(pre.offer, pre.items),
        reason,
        createdByUserId: request.user?.id ?? null,
      },
      tx,
    );
  };

  const findMissingSnapshotReference = async (
    snapshot: offerVersionsRepo.OfferVersionSnapshot,
    exec: DbExecutor = db,
  ): Promise<string | null> => {
    const clientExists = await clientsRepo.existsById(snapshot.offer.clientId, exec);
    if (!clientExists) {
      return `Snapshot client "${snapshot.offer.clientId}" no longer exists`;
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

  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.client_offers.view'),
      ],
      schema: {
        tags: ['client-offers'],
        summary: 'List client offers',
        response: {
          200: { type: 'array', items: offerSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => {
      const [offers, items] = await Promise.all([
        clientOffersRepo.listAll(),
        clientOffersRepo.listAllItems(),
      ]);

      const itemsByOffer = new Map<string, clientOffersRepo.ClientOfferItem[]>();
      for (const item of items) {
        const list = itemsByOffer.get(item.offerId);
        if (list) list.push(item);
        else itemsByOffer.set(item.offerId, [item]);
      }

      return offers.map((offer) =>
        projectOffer({
          ...offer,
          items: itemsByOffer.get(offer.id) ?? [],
        }),
      );
    },
  );

  fastify.post(
    '/',
    {
      onRequest: [requirePermission('sales.client_offers.create')],
      schema: {
        tags: ['client-offers'],
        summary: 'Create client offer',
        body: offerCreateBodySchema,
        response: {
          201: offerSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        id: nextId,
        linkedQuoteId,
        clientId,
        clientName,
        items,
        paymentTerms,
        discount,
        discountType,
        status,
        deliveryDate,
        expirationDate,
        notes,
      } = request.body as {
        id: unknown;
        linkedQuoteId: unknown;
        clientId: unknown;
        clientName: unknown;
        items: OfferItemInput[] | unknown;
        paymentTerms: unknown;
        discount: unknown;
        discountType: unknown;
        status: unknown;
        deliveryDate: unknown;
        expirationDate: unknown;
        notes: unknown;
      };

      const nextIdResult = requireNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
      const linkedQuoteIdResult = requireNonEmptyString(linkedQuoteId, 'linkedQuoteId');
      if (!linkedQuoteIdResult.ok) return badRequest(reply, linkedQuoteIdResult.message);
      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);
      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const sourceQuote = await clientQuotesRepo.findStatusAndClientName(linkedQuoteIdResult.value);
      if (!sourceQuote) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Source quote not found',
          action: 'client_offer.create.not_found',
          entityType: 'client_quote',
          entityId: linkedQuoteIdResult.value,
        });
      }
      // Effective accepted: `accepted` is terminal/frozen, so this equals the normalized stored
      // status and also folds the legacy `confirmed` spelling (issue #779).
      if (normalizeQuoteStatus(sourceQuote.status) !== 'accepted') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Offers can only be created from accepted quotes',
          action: 'client_offer.create.conflict',
          entityType: 'client_quote',
          entityId: linkedQuoteIdResult.value,
          details: { secondaryLabel: 'source_quote_not_accepted' },
        });
      }

      if (await clientOffersRepo.findExistingForQuote(linkedQuoteIdResult.value)) {
        return replyError(request, reply, {
          statusCode: 409,
          message: LINKED_OFFER_CONFLICT,
          action: 'client_offer.create.conflict',
          entityType: 'client_quote',
          entityId: linkedQuoteIdResult.value,
          details: { secondaryLabel: 'duplicate_offer_for_quote' },
        });
      }

      const expirationDateResult = parseDateString(expirationDate, 'expirationDate');
      if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);
      const deliveryDateResult = optionalDateString(deliveryDate, 'deliveryDate');
      if (!deliveryDateResult.ok) return badRequest(reply, deliveryDateResult.message);
      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';
      // Strict write-path parse (issue #779), mirroring the quote routes: unknown spellings 400
      // instead of 500ing on the DB CHECK constraint; legacy spellings fold to canonical.
      const statusValue = parseQuoteStatusInput(
        typeof status === 'string' && status ? status : 'draft',
      );
      if (statusValue === null || statusValue === 'offer') {
        return badRequest(reply, OFFER_STATUS_INPUT_ERROR);
      }
      const deliveryDateValue =
        deliveryDateResult.value ?? (statusValue === 'sent' ? todayLocalDateOnly() : null);

      let normalizedItems = normalizeItems(items as OfferItemInput[], reply);
      if (!normalizedItems) return;
      // All links are fresh on create — every sourced line takes the live supplier values. Links
      // copied from the quote being converted are exempt from the sourceable check (the supplier
      // quote legitimately derives offer/accepted by now); any OTHER fresh link must still
      // reference a pickable quote (#812 round 15).
      try {
        normalizedItems = await resolveOfferItemSupplierLinks(
          normalizedItems,
          null,
          await linkedQuoteSourcedItemIds(linkedQuoteIdResult.value),
        );
      } catch (err) {
        return badRequest(reply, (err as Error).message);
      }

      type CreateOutcome =
        | {
            ok: false;
            statusCode: 404 | 409;
            message: string;
            action: string;
            secondaryLabel?: string;
          }
        | {
            ok: true;
            offer: clientOffersRepo.ClientOffer;
            items: clientOffersRepo.ClientOfferItem[];
          };

      let result: CreateOutcome;
      try {
        result = await withDbTransaction(async (tx): Promise<CreateOutcome> => {
          // Lock the source quote so a concurrent quote-restore (which gates on
          // "no linked offer exists") serializes against this insert.
          const lockedQuote = await clientQuotesRepo.lockCurrentById(linkedQuoteIdResult.value, tx);
          if (!lockedQuote) {
            return {
              ok: false,
              statusCode: 404,
              message: 'Source quote not found',
              action: 'client_offer.create.not_found',
            };
          }
          if (normalizeQuoteStatus(lockedQuote.status) !== 'accepted') {
            return {
              ok: false,
              statusCode: 409,
              message: 'Offers can only be created from accepted quotes',
              action: 'client_offer.create.conflict',
              secondaryLabel: 'source_quote_not_accepted',
            };
          }
          const existing = await clientOffersRepo.findExistingForQuote(
            linkedQuoteIdResult.value,
            tx,
          );
          if (existing) {
            return {
              ok: false,
              statusCode: 409,
              message: LINKED_OFFER_CONFLICT,
              action: 'client_offer.create.conflict',
              secondaryLabel: 'duplicate_offer_for_quote',
            };
          }

          const offer = await clientOffersRepo.create(
            {
              id: nextIdResult.value,
              linkedQuoteId: linkedQuoteIdResult.value,
              clientId: clientIdResult.value,
              clientName: clientNameResult.value,
              paymentTerms:
                typeof paymentTerms === 'string' && paymentTerms ? paymentTerms : 'immediate',
              discount: discountResult.value || 0,
              discountType: discountTypeValue,
              status: statusValue,
              deliveryDate: deliveryDateValue,
              expirationDate: expirationDateResult.value,
              notes: (notes as string | null | undefined) ?? null,
            },
            tx,
          );
          const createdItems = await clientOffersRepo.insertItems(
            offer.id,
            buildItemsForInsert(normalizedItems),
            tx,
          );
          return { ok: true, offer, items: createdItems };
        });
      } catch (err) {
        const dup = getUniqueViolation(err);
        if (dup && (dup.constraint === 'customer_offers_pkey' || dup.detail?.includes('(id)'))) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Offer ID already exists',
            action: 'client_offer.create.conflict',
            entityType: 'client_offer',
            details: { secondaryLabel: 'duplicate_id' },
          });
        }
        if (
          dup &&
          (dup.constraint === 'idx_customer_offers_linked_quote_id' ||
            dup.detail?.includes('(linked_quote_id)'))
        ) {
          return replyError(request, reply, {
            statusCode: 409,
            message: LINKED_OFFER_CONFLICT,
            action: 'client_offer.create.conflict',
            entityType: 'client_quote',
            entityId: linkedQuoteIdResult.value,
            details: { secondaryLabel: 'duplicate_offer_for_quote' },
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
          entityId: linkedQuoteIdResult.value,
          details: result.secondaryLabel ? { secondaryLabel: result.secondaryLabel } : undefined,
        });
      }
      const createdOffer = result.offer;
      const createdItems = result.items;

      await logAudit({
        request,
        action: 'client_offer.created',
        entityType: 'client_offer',
        entityId: createdOffer.id,
        details: {
          targetLabel: createdOffer.id,
          secondaryLabel: clientNameResult.value,
        },
      });
      return reply.code(201).send(projectOffer({ ...createdOffer, items: createdItems }));
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('sales.client_offers.update')],
      schema: {
        tags: ['client-offers'],
        summary: 'Update client offer',
        params: idParamSchema,
        body: offerUpdateBodySchema,
        response: {
          200: offerSchema,
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
        paymentTerms,
        discount,
        discountType,
        status,
        deliveryDate,
        expirationDate,
        notes,
      } = request.body as {
        id?: unknown;
        clientId?: unknown;
        clientName?: unknown;
        items?: OfferItemInput[] | unknown;
        paymentTerms?: unknown;
        discount?: unknown;
        discountType?: unknown;
        status?: unknown;
        deliveryDate?: unknown;
        expirationDate?: unknown;
        notes?: unknown;
      };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const existingOffer = await clientOffersRepo.findExisting(idResult.value);
      if (!existingOffer) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Offer not found',
          action: 'client_offer.update.not_found',
          entityType: 'client_offer',
          entityId: idResult.value,
        });
      }

      // Strict write-path parse (issue #779), mirroring the client/supplier quote routes: unknown
      // or derived-only spellings (e.g. the round-tripped 'expired') 400 instead of 500ing on the
      // DB CHECK constraint, and legacy spellings fold to canonical before the guards compare.
      const targetStatus =
        status === undefined
          ? null
          : parseQuoteStatusInput(typeof status === 'string' ? status : '');
      if (status !== undefined && (targetStatus === null || targetStatus === 'offer')) {
        return badRequest(reply, OFFER_STATUS_INPUT_ERROR);
      }
      const statusChanged =
        targetStatus !== null && targetStatus !== normalizeQuoteStatus(existingOffer.status);

      const isTerminalToDraftRevert =
        targetStatus === 'draft' && TERMINAL_OFFER_STATUSES.has(existingOffer.status);
      if (isTerminalToDraftRevert) {
        if (!canRevertTerminalOfferStatus(request)) {
          return reply.code(403).send({ error: TERMINAL_REVERT_ROLE_ERROR });
        }
        return reply.code(409).send({ error: TERMINAL_REVERT_ERROR });
      }
      // Any other transition off a terminal status is frozen: without this, a plain status PUT
      // could flip accepted→denied — or walk accepted→sent→draft, voiding the role gate and the
      // linked-sale check of the revert flow above. No-op resends stay tolerated.
      if (statusChanged && TERMINAL_OFFER_STATUSES.has(existingOffer.status)) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Accepted or denied offers cannot change status; use the revert-to-draft action',
          action: 'client_offer.update.conflict',
          entityType: 'client_offer',
          entityId: idResult.value,
          details: {
            targetLabel: idResult.value,
            secondaryLabel: 'terminal_read_only',
            fromValue: existingOffer.status,
            toValue: targetStatus ?? undefined,
          },
          extraBody: { currentStatus: existingOffer.status },
        });
      }

      // Derived #779 status: `expired` overrides draft/sent once the offer's own expiration date
      // has passed; accepted/denied are frozen and never expire.
      const currentEffective = effectiveQuoteStatusFromDate(
        existingOffer.status,
        existingOffer.expirationDate,
      );
      // One declared field set, several derived guards (issue #779). The expiration date is NOT
      // in the set: it stays editable on non-draft and expired offers — extending it is the only
      // exit from `expired` — and is locked again only on terminal accepted/denied offers below.
      const hasNonExpirationContentUpdate =
        clientId !== undefined ||
        clientName !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        discount !== undefined ||
        discountType !== undefined ||
        deliveryDate !== undefined ||
        notes !== undefined;
      // The non-draft lock outranks the expired one: for a SENT offer "extend the date" would not
      // make its content editable, so it gets the accurate non-draft message; the expired guard
      // below then only ever fires for an expired DRAFT offer.
      if (existingOffer.status !== 'draft' && hasNonExpirationContentUpdate) {
        return replyError(request, reply, {
          statusCode: 409,
          message: NON_DRAFT_READ_ONLY_ERROR,
          action: 'client_offer.update.conflict',
          entityType: 'client_offer',
          entityId: idResult.value,
          details: {
            targetLabel: idResult.value,
            secondaryLabel: 'non_draft_read_only',
            fromValue: existingOffer.status,
          },
          extraBody: { currentStatus: existingOffer.status },
        });
      }
      // Expired offers are content-read-only EXCEPT their expiration date — a plain
      // expirationDate write is how an offer leaves `expired` (issue #779). Mirrors the
      // client-quote rule; status changes are handled by the freeze below.
      if (currentEffective === 'expired' && hasNonExpirationContentUpdate) {
        return replyError(request, reply, {
          statusCode: 409,
          message: EXPIRED_READ_ONLY_ERROR,
          action: 'client_offer.update.conflict',
          entityType: 'client_offer',
          entityId: idResult.value,
          details: {
            targetLabel: idResult.value,
            secondaryLabel: 'expired_read_only',
            fromValue: 'expired',
          },
        });
      }
      // Terminal accepted/denied offers are frozen entirely — including the expiration date
      // (they can never expire, so there is no validity to renew).
      if (TERMINAL_OFFER_STATUSES.has(existingOffer.status) && expirationDate !== undefined) {
        return replyError(request, reply, {
          statusCode: 409,
          message: NON_DRAFT_READ_ONLY_ERROR,
          action: 'client_offer.update.conflict',
          entityType: 'client_offer',
          entityId: idResult.value,
          details: {
            targetLabel: idResult.value,
            secondaryLabel: 'non_draft_read_only',
            fromValue: existingOffer.status,
          },
          extraBody: { currentStatus: existingOffer.status },
        });
      }
      // Scaduto freezes manual status changes — an offer leaves `expired` only by extending its
      // expiration date. A no-op resend of the stored status stays tolerated (issue #779).
      if (currentEffective === 'expired' && statusChanged) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Expired offers cannot change status; extend the expiration date instead',
          action: 'client_offer.update.conflict',
          entityType: 'client_offer',
          entityId: idResult.value,
          details: { secondaryLabel: 'expired_read_only', fromValue: 'expired' },
        });
      }

      let nextIdValue: string | undefined | null = nextId as string | undefined | null;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (nextIdResult.value) {
          if (await clientOffersRepo.findIdConflict(nextIdResult.value, idResult.value)) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'Offer ID already exists',
              action: 'client_offer.update.conflict',
              entityType: 'client_offer',
              entityId: idResult.value,
              details: { secondaryLabel: 'duplicate_id', toValue: nextIdResult.value },
            });
          }
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

      if (existingOffer.linkedQuoteId) {
        const lockedFields: string[] = [];
        if (
          clientIdValue !== undefined &&
          clientIdValue !== null &&
          clientIdValue !== existingOffer.clientId
        ) {
          lockedFields.push('clientId');
        }
        if (
          clientNameValue !== undefined &&
          clientNameValue !== null &&
          clientNameValue !== existingOffer.clientName
        ) {
          lockedFields.push('clientName');
        }
        if (lockedFields.length > 0) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Quote-linked offer client details are read-only',
            action: 'client_offer.update.conflict',
            entityType: 'client_offer',
            entityId: idResult.value,
            details: {
              targetLabel: idResult.value,
              secondaryLabel: 'quote_linked_locked_fields',
              changedFields: lockedFields,
            },
            extraBody: { fields: lockedFields },
          });
        }
      }

      let expirationDateValue = expirationDate;
      if (expirationDate !== undefined) {
        const expirationDateResult = optionalDateString(expirationDate, 'expirationDate');
        if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);
        expirationDateValue = expirationDateResult.value;
      }

      let discountValue = discount;
      if (discount !== undefined) {
        const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
        if (!discountResult.ok) return badRequest(reply, discountResult.message);
        discountValue = discountResult.value;
      }

      const discountTypeValue: 'currency' | 'percentage' | undefined =
        discountType === undefined
          ? undefined
          : discountType === 'currency'
            ? 'currency'
            : 'percentage';

      let deliveryDateValue = deliveryDate;
      if (deliveryDate !== undefined) {
        const deliveryDateResult = optionalDateString(deliveryDate, 'deliveryDate');
        if (!deliveryDateResult.ok) return badRequest(reply, deliveryDateResult.message);
        deliveryDateValue = deliveryDateResult.value;
      }

      const shouldStampDeliveryDate =
        targetStatus === 'sent' &&
        existingOffer.status !== 'sent' &&
        !existingOffer.deliveryDate &&
        !deliveryDateValue;
      const automaticDeliveryDate = shouldStampDeliveryDate ? todayLocalDateOnly() : undefined;

      let normalizedItemsForUpdate: NormalizedOfferItem[] | null = null;
      let previousSyncLines: PreviousClientLine[] = [];
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        normalizedItemsForUpdate = normalizeItems(items as OfferItemInput[], reply);
        if (!normalizedItemsForUpdate) return;
        const existingOfferItems = await clientOffersRepo.findItemsForOffer(idResult.value);
        try {
          normalizedItemsForUpdate = await resolveOfferItemSupplierLinks(
            normalizedItemsForUpdate,
            existingOfferItems,
            // Re-adding a line the linked quote sources stays allowed (it was inherited via the
            // conversion); only genuinely new picks must be sourceable (#812 round 15).
            await linkedQuoteSourcedItemIds(existingOffer.linkedQuoteId),
          );
        } catch (err) {
          return badRequest(reply, (err as Error).message);
        }
        // Previous stored lines for the supplier-item sync's genuine-edit diff (issue #779) —
        // the stored item shape structurally satisfies PreviousClientLine.
        previousSyncLines = existingOfferItems;
      }

      // Derived from the declared field set above so the two lists can't drift (issue #779).
      const isIdOnlyUpdate =
        nextId !== undefined &&
        status === undefined &&
        expirationDate === undefined &&
        !hasNonExpirationContentUpdate;

      let result: {
        offer: clientOffersRepo.ClientOffer | null;
        items: clientOffersRepo.ClientOfferItem[];
        syncAudits: SupplierItemSyncAudit[];
      };
      try {
        result = await withDbTransaction(async (tx) => {
          // ID-only renames cascade through the FK and don't alter snapshot content, so we
          // skip them to keep the history clean.
          if (!isIdOnlyUpdate) {
            await snapshotPreState(idResult.value, 'update', request, tx);
          }
          let renamedOffer: clientOffersRepo.ClientOffer | null = null;
          if (nextIdValue && nextIdValue !== idResult.value) {
            renamedOffer = await clientOffersRepo.rename(idResult.value, nextIdValue, tx);
            if (!renamedOffer) return { offer: null, items: [], syncAudits: [] };
          }
          // id-only renames have nothing left to write — reuse the row returned by rename().
          const offer =
            isIdOnlyUpdate && renamedOffer
              ? renamedOffer
              : await clientOffersRepo.update(
                  renamedOffer?.id ?? idResult.value,
                  {
                    clientId: (clientIdValue as string | null | undefined) ?? null,
                    clientName: (clientNameValue as string | null | undefined) ?? null,
                    paymentTerms: (paymentTerms as string | null | undefined) ?? null,
                    discount: (discountValue as number | null | undefined) ?? null,
                    discountType: discountTypeValue ?? null,
                    status: targetStatus,
                    deliveryDate:
                      (deliveryDateValue as string | null | undefined) ??
                      automaticDeliveryDate ??
                      null,
                    expirationDate: (expirationDateValue as string | null | undefined) ?? null,
                    notes: (notes as string | null | undefined) ?? null,
                  },
                  tx,
                );
          if (!offer) return { offer: null, items: [], syncAudits: [] };
          const updatedItems = normalizedItemsForUpdate
            ? await clientOffersRepo.replaceItems(
                offer.id,
                buildItemsForInsert(normalizedItemsForUpdate),
                tx,
              )
            : await clientOffersRepo.findItemsForOffer(offer.id, tx);
          // Bidirectional sync (issue #779): push GENUINE client-side edits of supplier-sourced
          // line fields (quantity, unit cost) onto the referenced supplier quote items,
          // atomically with the offer write. The audit entries are logged after commit.
          const syncAudits = normalizedItemsForUpdate
            ? await syncSupplierItemsFromClientLines(
                request,
                'client_offer.update',
                normalizedItemsForUpdate,
                previousSyncLines,
                tx,
              )
            : [];
          return { offer, items: updatedItems, syncAudits };
        });
      } catch (err) {
        // The client→supplier item sync refuses to write frozen/order-locked supplier quotes or
        // to run without the supplier-quote update grant; the tx rolled back, so the offer write
        // was rejected together with the supplier write (issue #779).
        if (err instanceof SupplierItemSyncError) {
          return replySupplierItemSyncError(request, reply, err, {
            entityType: 'client_offer',
            entityId: idResult.value,
          });
        }
        const dup = getUniqueViolation(err);
        if (dup && (dup.constraint === 'customer_offers_pkey' || dup.detail?.includes('(id)'))) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Offer ID already exists',
            action: 'client_offer.update.conflict',
            entityType: 'client_offer',
            entityId: idResult.value,
            details: { secondaryLabel: 'duplicate_id' },
          });
        }
        throw err;
      }

      const updatedOffer = result.offer;
      const updatedItems = result.items;
      if (!updatedOffer) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Offer not found',
          action: 'client_offer.update.not_found',
          entityType: 'client_offer',
          entityId: idResult.value,
        });
      }

      await logSupplierItemSyncAudits(request, result.syncAudits);

      const nextStatus = targetStatus ?? updatedOffer.status;
      const didStatusChange = targetStatus !== null && existingOffer.status !== nextStatus;
      await logAudit({
        request,
        action: 'client_offer.updated',
        entityType: 'client_offer',
        entityId: updatedOffer.id,
        details: {
          targetLabel: updatedOffer.id,
          secondaryLabel: updatedOffer.clientName,
          fromValue: didStatusChange ? existingOffer.status : undefined,
          toValue: didStatusChange ? nextStatus : undefined,
        },
      });

      return projectOffer({ ...updatedOffer, items: updatedItems });
    },
  );

  fastify.post(
    '/:id/revert-to-draft',
    {
      onRequest: [requireRole(ADMIN_ROLE_ID, TOP_MANAGER_ROLE_ID)],
      preValidation: async (request) => {
        request.body ??= {};
      },
      schema: {
        tags: ['client-offers'],
        summary: 'Revert a terminal client offer to draft',
        params: idParamSchema,
        body: offerRevertToDraftBodySchema,
        response: {
          200: offerSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const { reason } = (request.body ?? {}) as { reason?: unknown };
      const reasonResult = optionalNonEmptyString(reason, 'reason');
      if (!reasonResult.ok) return badRequest(reply, reasonResult.message);

      type RevertOutcome =
        | { ok: false; status: number; body: Record<string, unknown> }
        | {
            ok: true;
            previousStatus: string;
            offer: clientOffersRepo.ClientOffer;
            items: clientOffersRepo.ClientOfferItem[];
          };

      const result: RevertOutcome = await withDbTransaction(async (tx) => {
        const current = await clientOffersRepo.lockExistingById(idResult.value, tx);
        if (!current) {
          return { ok: false, status: 404, body: { error: 'Offer not found' } };
        }
        if (!TERMINAL_OFFER_STATUSES.has(current.status)) {
          return {
            ok: false,
            status: 409,
            body: {
              error: 'Only accepted or denied offers can be reverted to draft',
              currentStatus: current.status,
            },
          };
        }

        const linkedSaleId = await clientOffersRepo.findLinkedSaleId(idResult.value, tx);
        if (linkedSaleId) {
          return {
            ok: false,
            status: 409,
            body: { error: TERMINAL_REVERT_LINKED_SALE_ERROR },
          };
        }

        await snapshotPreState(idResult.value, 'update', request, tx);
        const offer = await clientOffersRepo.update(idResult.value, { status: 'draft' }, tx);
        if (!offer) {
          return { ok: false, status: 404, body: { error: 'Offer not found' } };
        }
        const items = await clientOffersRepo.findItemsForOffer(offer.id, tx);
        return { ok: true, previousStatus: current.status, offer, items };
      });

      if (!result.ok) {
        return reply.code(result.status).send(result.body);
      }

      await logAudit({
        request,
        action: 'client_offer.reverted_to_draft',
        entityType: 'client_offer',
        entityId: result.offer.id,
        details: {
          targetLabel: result.offer.id,
          secondaryLabel: result.offer.clientName,
          changedFields: ['status'],
          fromValue: result.previousStatus,
          toValue: 'draft',
          reason: reasonResult.value ?? undefined,
        },
      });

      return projectOffer({ ...result.offer, items: result.items });
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('sales.client_offers.delete')],
      schema: {
        tags: ['client-offers'],
        summary: 'Delete client offer',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (await clientOffersRepo.findLinkedSaleId(idResult.value)) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Cannot delete an offer once a sale order has been created from it',
          action: 'client_offer.delete.conflict',
          entityType: 'client_offer',
          entityId: idResult.value,
          details: { secondaryLabel: 'sale_order_exists' },
        });
      }

      const offer = await clientOffersRepo.findStatusAndClientName(idResult.value);
      if (!offer) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Offer not found',
          action: 'client_offer.delete.not_found',
          entityType: 'client_offer',
          entityId: idResult.value,
        });
      }
      if (offer.status !== 'draft') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Only draft offers can be deleted',
          action: 'client_offer.delete.conflict',
          entityType: 'client_offer',
          entityId: idResult.value,
          details: {
            targetLabel: idResult.value,
            secondaryLabel: 'non_draft_status',
            fromValue: offer.status,
          },
        });
      }

      await logAudit({
        request,
        action: 'client_offer.deleted',
        entityType: 'client_offer',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: offer.clientName ?? '',
        },
      });
      await clientOffersRepo.deleteById(idResult.value);
      return reply.code(204).send();
    },
  );

  const versionParamSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      versionId: { type: 'string' },
    },
    required: ['id', 'versionId'],
  } as const;

  const offerVersionRowSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      offerId: { type: 'string' },
      reason: { type: 'string', enum: ['update', 'restore'] },
      createdByUserId: { type: ['string', 'null'] },
      createdAt: { type: 'number' },
    },
    required: ['id', 'offerId', 'reason', 'createdAt'],
  } as const;

  const offerVersionSchema = {
    type: 'object',
    properties: { ...offerVersionRowSchema.properties, snapshot: {} },
    required: [...offerVersionRowSchema.required, 'snapshot'],
  } as const;

  fastify.get(
    '/:id/versions',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.client_offers.view'),
      ],
      schema: {
        tags: ['client-offers'],
        summary: 'List versions for a client offer',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: offerVersionRowSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const [exists, versions] = await Promise.all([
        clientOffersRepo.existsById(idResult.value),
        offerVersionsRepo.listForOffer(idResult.value),
      ]);
      if (!exists) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Offer not found',
          action: 'client_offer.versions_list.not_found',
          entityType: 'client_offer',
          entityId: idResult.value,
        });
      }
      return versions;
    },
  );

  fastify.get(
    '/:id/versions/:versionId',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.client_offers.view'),
      ],
      schema: {
        tags: ['client-offers'],
        summary: 'Get a single client offer version',
        params: versionParamSchema,
        response: {
          200: offerVersionSchema,
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

      const version = await offerVersionsRepo.findById(idResult.value, versionIdResult.value);
      if (!version) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Version not found',
          action: 'client_offer.version_get.not_found',
          entityType: 'client_offer',
          entityId: idResult.value,
          details: { secondaryLabel: versionIdResult.value },
        });
      }
      return version;
    },
  );

  fastify.post(
    '/:id/versions/:versionId/restore',
    {
      onRequest: [requirePermission('sales.client_offers.update')],
      schema: {
        tags: ['client-offers'],
        summary: 'Restore a client offer to a prior version',
        params: versionParamSchema,
        response: {
          200: offerSchema,
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
            extraBody?: Record<string, unknown>;
          }
        | {
            ok: true;
            offer: clientOffersRepo.ClientOffer;
            items: clientOffersRepo.ClientOfferItem[];
          };

      // Lock the offer row up front, then run remaining gate reads inside the tx. The lock
      // serializes against the sale-create path (which locks this row before inserting a
      // sale with linked_offer_id), closing the TOCTOU window between the linked-sale check
      // and the restore write.
      const result: RestoreOutcome = await withDbTransaction(async (tx) => {
        const current = await clientOffersRepo.lockExistingById(idResult.value, tx);
        if (!current) {
          return {
            ok: false,
            statusCode: 404,
            message: 'Offer not found',
            action: 'client_offer.restore.not_found',
          };
        }
        if (current.status !== 'draft') {
          return {
            ok: false,
            statusCode: 409,
            message: NON_DRAFT_READ_ONLY_ERROR,
            action: 'client_offer.restore.conflict',
            secondaryLabel: 'non_draft_read_only',
            extraBody: { currentStatus: current.status },
          };
        }
        // Expired offers are content-read-only and exit only via a date extension (issue #779);
        // a restore would rewrite content, status AND the date in one shot, so block it like the
        // PUT does.
        if (effectiveQuoteStatusFromDate(current.status, current.expirationDate) === 'expired') {
          return {
            ok: false,
            statusCode: 409,
            message: EXPIRED_READ_ONLY_ERROR,
            action: 'client_offer.restore.conflict',
            secondaryLabel: 'expired_read_only',
          };
        }

        const linkedSaleId = await clientOffersRepo.findLinkedSaleId(idResult.value, tx);
        if (linkedSaleId) {
          return {
            ok: false,
            statusCode: 409,
            message: 'Cannot restore an offer once a sale order has been created from it',
            action: 'client_offer.restore.conflict',
            secondaryLabel: 'sale_order_exists',
          };
        }

        const version = await offerVersionsRepo.findById(idResult.value, versionIdResult.value, tx);
        if (!version) {
          return {
            ok: false,
            statusCode: 404,
            message: 'Version not found',
            action: 'client_offer.restore.not_found',
            secondaryLabel: versionIdResult.value,
          };
        }
        const missingSnapshotReference = await findMissingSnapshotReference(version.snapshot, tx);
        if (missingSnapshotReference) {
          return {
            ok: false,
            statusCode: 409,
            message: missingSnapshotReference,
            action: 'client_offer.restore.conflict',
            secondaryLabel: 'snapshot_reference_missing',
          };
        }
        const snapshotExpirationDate = version.snapshot.offer.expirationDate;
        if (!snapshotExpirationDate) {
          return {
            ok: false,
            statusCode: 409,
            message: 'Snapshot expiration date is missing',
            action: 'client_offer.restore.conflict',
            secondaryLabel: 'snapshot_expiration_missing',
          };
        }
        const snapshotDeliveryDate = version.snapshot.offer.deliveryDate ?? null;

        const snapshotItems: clientOffersRepo.NewClientOfferItem[] = version.snapshot.items.map(
          ({ id: _itemId, offerId: _offerId, ...rest }) => ({
            ...rest,
            id: generatePrefixedId(ITEM_ID_PREFIXES.clientOfferItem),
          }),
        );

        await snapshotPreState(idResult.value, 'restore', request, tx);

        const offer = await clientOffersRepo.restoreSnapshotOffer(
          idResult.value,
          {
            clientId: version.snapshot.offer.clientId,
            clientName: version.snapshot.offer.clientName,
            paymentTerms: version.snapshot.offer.paymentTerms ?? 'immediate',
            discount: version.snapshot.offer.discount,
            discountType: version.snapshot.offer.discountType,
            // Fold to the canonical set like the quote routes' restores do, so a non-canonical
            // snapshot value can never hit the CHECK constraint (issue #779).
            status: normalizeQuoteStatus(version.snapshot.offer.status),
            deliveryDate: snapshotDeliveryDate,
            expirationDate: snapshotExpirationDate,
            notes: version.snapshot.offer.notes,
          },
          tx,
        );
        if (!offer) {
          return {
            ok: false,
            statusCode: 404,
            message: 'Offer not found',
            action: 'client_offer.restore.not_found',
          };
        }
        const items = await clientOffersRepo.replaceItems(offer.id, snapshotItems, tx);
        return { ok: true, offer, items };
      });

      if (!result.ok) {
        return replyError(request, reply, {
          statusCode: result.statusCode,
          message: result.message,
          action: result.action,
          entityType: 'client_offer',
          entityId: idResult.value,
          details: result.secondaryLabel
            ? { targetLabel: idResult.value, secondaryLabel: result.secondaryLabel }
            : { targetLabel: idResult.value },
          extraBody: result.extraBody,
        });
      }

      await logAudit({
        request,
        action: 'client_offer.restored',
        entityType: 'client_offer',
        entityId: result.offer.id,
        details: {
          targetLabel: result.offer.id,
          secondaryLabel: result.offer.clientName,
          toValue: versionIdResult.value,
        },
      });

      return projectOffer({ ...result.offer, items: result.items });
    },
  );
}
