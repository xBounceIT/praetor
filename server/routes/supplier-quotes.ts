import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type DbExecutor, withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import * as productsRepo from '../repositories/productsRepo.ts';
import * as quoteCommunicationChannelsRepo from '../repositories/quoteCommunicationChannelsRepo.ts';
import * as revisionsRepo from '../repositories/revisionsRepo.ts';
import * as supplierQuoteAttachmentsRepo from '../repositories/supplierQuoteAttachmentsRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import * as supplierQuoteVersionsRepo from '../repositories/supplierQuoteVersionsRepo.ts';
import * as suppliersRepo from '../repositories/suppliersRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import {
  allocateDocumentCode,
  reserveDocumentCodeCounterFromCode,
} from '../services/documentCodes.ts';
import {
  RevisionRestoreConflict,
  restoreSupplierQuoteRevision,
} from '../services/revisionRestore.ts';
import { logAudit } from '../utils/audit.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { replyDocumentCodeCollision } from '../utils/document-code-replies.ts';
import {
  DOCUMENT_CODE_MAX_LENGTH,
  OPTIONAL_DOCUMENT_CODE_VALUE_PATTERN,
  validateOptionalDocumentCode,
} from '../utils/document-codes.ts';
import { type DurationUnit, defaultDurationMonthsForUnit } from '../utils/duration-unit.ts';
import {
  ATTACHMENT_MAX_BYTES,
  deleteSupplierQuoteAttachment,
  isAllowedAttachment,
  type OpenedAttachment,
  openSupplierQuoteAttachment,
  saveSupplierQuoteAttachment,
} from '../utils/fileStorage.ts';
import { createChildLogger } from '../utils/logger.ts';
import { generatePrefixedId, ITEM_ID_PREFIXES } from '../utils/order-ids.ts';
import { requirePathSegment } from '../utils/path-segments.ts';
import {
  effectiveSupplierQuoteStatusFromDate,
  normalizeQuoteStatus,
} from '../utils/quote-status.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import {
  deriveSupplierLinePricing,
  MAX_LINE_AMOUNT,
  normalizeSupplierQuoteSnapshotPricing,
  normalizeSupplierUnitPrice,
} from '../utils/supplier-quote-pricing.ts';
import { snapshotSupplierQuotePreState } from '../utils/supplier-quote-version.ts';
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
import { registerRevisionHistoryRoutes } from './revision-history.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const normalizeUnitType = (value: unknown): 'hours' | 'days' | 'unit' => {
  if (value === 'days') return 'days';
  if (value === 'hours') return 'hours';
  return 'unit';
};

// Effective status for a supplier quote (issue #779): mirrors the linked client quote's pipeline
// status when linked, otherwise its own; `expired` is computed from its OWN expiration date.
const supplierQuoteEffectiveStatus = (quote: supplierQuotesRepo.SupplierQuote) =>
  effectiveSupplierQuoteStatusFromDate({
    expirationDate: quote.expirationDate,
    linkedClientStatus: quote.linkedClientQuoteStatus,
    linkedClientQuoteExpiration: quote.linkedClientQuoteExpiration,
    linkedOfferStatus: quote.linkedOfferStatus,
    linkedOfferExpiration: quote.linkedOfferExpiration,
  });

const projectQuote = (quote: supplierQuotesRepo.SupplierQuote) => ({
  ...quote,
  // `status` is FULLY DERIVED (issue #779): unlinked → draft; linked → it follows the client
  // quote and, once one exists, the client offer — plus the expiry overlays. There is no manual
  // status management anymore; the stored column is vestigial.
  status: supplierQuoteEffectiveStatus(quote),
  isStatusSynced: quote.linkedClientQuoteId !== null,
});

const projectItem = (item: supplierQuotesRepo.SupplierQuoteItem) => ({
  ...item,
  unitType: normalizeUnitType(item.unitType),
});

const supplierQuoteItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    quoteId: { type: 'string' },
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    listPrice: { type: 'number' },
    discountPercent: { type: 'number' },
    unitPrice: { type: 'number' },
    note: { type: ['string', 'null'] },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    durationMonths: {
      type: 'number',
      description:
        'Canonical whole months; pricing uses the numeric value displayed by durationUnit.',
    },
    durationUnit: {
      type: 'string',
      enum: ['months', 'years', 'na'],
      description:
        'Display unit only: the displayed number multiplies pricing; na applies a neutral x1.',
    },
    pricingSemanticsVersion: {
      type: 'integer',
      enum: [1, 2],
      description: 'Read-only pricing compatibility marker; 1 preserves historical totals.',
    },
  },
  required: ['id', 'quoteId', 'productName', 'quantity', 'unitPrice'],
} as const;

const supplierQuoteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    revisionNumber: { type: 'integer' },
    revisionCode: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    clientId: { type: ['string', 'null'] },
    clientName: { type: ['string', 'null'] },
    paymentTerms: { type: ['string', 'null'] },
    status: { type: 'string' },
    // Whether a client quote drives this supplier quote's status (then it's read-only/synced).
    isStatusSynced: { type: 'boolean' },
    linkedClientQuoteId: { type: ['string', 'null'] },
    linkedClientQuoteRevisionCode: { type: ['string', 'null'] },
    expirationDate: { type: ['string', 'null'], format: 'date' },
    communicationChannelId: { type: 'string' },
    communicationChannelName: { type: 'string' },
    linkedOrderId: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: supplierQuoteItemSchema },
  },
  required: [
    'supplierId',
    'supplierName',
    'status',
    'communicationChannelId',
    'communicationChannelName',
    'isStatusSynced',
    'createdAt',
    'updatedAt',
    'items',
  ],
} as const;

const supplierQuoteItemBodySchema = {
  type: 'object',
  properties: {
    // On update, an id matching one of the quote's persisted items keeps that row's identity
    // (in-place edit); anything else — including the form's tmp-* placeholders — is re-minted
    // server-side. Ignored on create.
    id: { type: 'string' },
    productId: { type: 'string' },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    listPrice: { type: 'number' },
    discountPercent: { type: 'number' },
    unitPrice: {
      type: 'number',
      minimum: 0,
      description:
        'On create, preserves an explicit authoritative cost when it differs from the list-price/discount formula; pricing edits derive it again.',
    },
    note: { type: 'string' },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    durationMonths: {
      type: 'number',
      description:
        'Canonical whole months; pricing uses the numeric value displayed by durationUnit.',
    },
    durationUnit: {
      type: 'string',
      enum: ['months', 'years', 'na'],
      description:
        'Display unit only: the displayed number multiplies pricing; na applies a neutral x1.',
    },
  },
  required: ['productName', 'quantity'],
} as const;

const supplierQuoteCreateBodySchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      maxLength: DOCUMENT_CODE_MAX_LENGTH,
      pattern: OPTIONAL_DOCUMENT_CODE_VALUE_PATTERN,
      description:
        'Leave blank to allocate automatically. Manual values may contain letters, numbers, underscores, and hyphens.',
    },
    description: { type: 'string' },
    supplierId: { type: 'string' },
    // Accepted for backward compatibility; ignored. Canonical supplierName is resolved from supplierId.
    supplierName: {
      type: 'string',
      description: 'Ignored. The canonical supplier name is resolved server-side from supplierId.',
    },
    // clientName is resolved server-side from clientId; the body only carries the id.
    clientId: { type: ['string', 'null'] },
    items: { type: 'array', items: supplierQuoteItemBodySchema },
    paymentTerms: { type: 'string' },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    communicationChannelId: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['supplierId', 'items', 'expirationDate', 'communicationChannelId'],
} as const;

const supplierQuoteUpdateBodySchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      maxLength: DOCUMENT_CODE_MAX_LENGTH,
      description:
        'When changed, may contain letters, numbers, underscores, and hyphens. An unchanged legacy id remains accepted.',
    },
    description: { type: ['string', 'null'] },
    supplierId: { type: 'string' },
    // Accepted for backward compatibility; ignored. Canonical supplierName is resolved when supplierId changes.
    supplierName: {
      type: 'string',
      description:
        'Ignored. The canonical supplier name is resolved server-side when supplierId changes.',
    },
    // clientName is resolved server-side from clientId; the body only carries the id.
    clientId: { type: ['string', 'null'] },
    items: { type: 'array', items: supplierQuoteItemBodySchema },
    paymentTerms: { type: 'string' },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    communicationChannelId: { type: 'string' },
    notes: { type: 'string' },
  },
} as const;

type ItemBody = {
  id?: string;
  productId?: string;
  productName?: string;
  quantity?: string | number;
  listPrice?: string | number;
  discountPercent?: string | number;
  unitPrice?: string | number;
  note?: string;
  unitType?: 'hours' | 'days' | 'unit';
  durationMonths?: string | number;
  durationUnit?: DurationUnit;
};

const validateAndNormalizeItems = (
  items: ItemBody[],
  reply: FastifyReply,
  options: { preserveProvidedUnitPrice?: boolean } = {},
): supplierQuotesRepo.NewSupplierQuoteItem[] | null => {
  const result: supplierQuotesRepo.NewSupplierQuoteItem[] = [];
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
    // List price drives the pricing chain. Legacy callers that only send unitPrice fall back to
    // it as the list price (with no discount) so existing integrations keep working.
    const listPriceResult = optionalLocalizedNonNegativeNumber(
      item.listPrice,
      `items[${i}].listPrice`,
    );
    if (!listPriceResult.ok) {
      badRequest(reply, listPriceResult.message);
      return null;
    }
    const providedUnitPriceResult = optionalLocalizedNonNegativeNumber(
      item.unitPrice,
      `items[${i}].unitPrice`,
    );
    if (!providedUnitPriceResult.ok) {
      badRequest(reply, providedUnitPriceResult.message);
      return null;
    }
    let listPrice = listPriceResult.value;
    if (listPrice === null) {
      const unitPriceResult = parseLocalizedNonNegativeNumber(
        item.unitPrice,
        `items[${i}].unitPrice`,
      );
      if (!unitPriceResult.ok) {
        badRequest(reply, unitPriceResult.message);
        return null;
      }
      listPrice = unitPriceResult.value;
    }
    const discountResult = optionalLocalizedNonNegativeNumber(
      item.discountPercent,
      `items[${i}].discountPercent`,
    );
    if (!discountResult.ok) {
      badRequest(reply, discountResult.message);
      return null;
    }
    if (discountResult.value !== null && discountResult.value > 100) {
      badRequest(reply, `items[${i}].discountPercent must be between 0 and 100`);
      return null;
    }
    const discountPercent = discountResult.value ?? 0;
    // Duration in months: a positive whole number, defaulting to 1 (one-off line item). Mirrors
    // the client-quote items so the two modules price the same way (issue #776 / #757).
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
    // Round both inputs to the persisted DB scale and derive the candidate net cost (Costo
    // unitario) from them. Pricing edits use this value; a create can retain a supplied
    // authoritative cost, while update reconciliation below retains an existing synced override.
    const pricing = deriveSupplierLinePricing(listPrice, discountPercent);
    // Reject amounts that would overflow either the NUMERIC(15,2) list price or the NUMERIC(19,6)
    // derived unit cost, so the caller gets a clean 400 instead of a database error. Both keep 13
    // integer digits; unitPrice is currently ≤ listPrice, but checking both protects future changes.
    if (pricing.listPrice > MAX_LINE_AMOUNT || pricing.unitPrice > MAX_LINE_AMOUNT) {
      badRequest(reply, `items[${i}].listPrice must not exceed ${MAX_LINE_AMOUNT}`);
      return null;
    }
    const unitPrice =
      options.preserveProvidedUnitPrice && providedUnitPriceResult.value !== null
        ? normalizeSupplierUnitPrice(providedUnitPriceResult.value)
        : pricing.unitPrice;
    if (unitPrice > MAX_LINE_AMOUNT) {
      badRequest(reply, `items[${i}].unitPrice must not exceed ${MAX_LINE_AMOUNT}`);
      return null;
    }
    const unitType = normalizeUnitType(item.unitType);
    // Duration applies to every line type now (issue #775); the 'na' unit marks a line that never
    // multiplies. The canonical value is stored as-is; pricing derives the displayed multiplier.
    const durationUnit = durationUnitResult.value ?? 'months';
    const durationMonths = durationMonthsResult.value ?? defaultDurationMonthsForUnit(durationUnit);
    result.push({
      id: generatePrefixedId(ITEM_ID_PREFIXES.supplierQuoteItem),
      productId: item.productId || null,
      productName: productNameResult.value,
      quantity: quantityResult.value,
      listPrice: pricing.listPrice,
      discountPercent: pricing.discountPercent,
      unitPrice,
      note: item.note || null,
      unitType,
      durationMonths,
      durationUnit,
    });
  }
  return result;
};

// Resolves the optional customer association (issue #759) from the request's `clientId`.
// An empty/absent id clears the link (both columns null); a non-empty id is validated against
// the clients table and the canonical name is denormalized onto the quote so it survives later
// client renames (mirroring how `supplierName` is snapshotted). Sends a 400 and returns null on
// an invalid or unknown client id.
const resolveClientLink = async (
  rawClientId: unknown,
  reply: FastifyReply,
): Promise<{ clientId: string | null; clientName: string | null } | null> => {
  const clientIdResult = optionalNonEmptyString(rawClientId, 'clientId');
  if (!clientIdResult.ok) {
    badRequest(reply, clientIdResult.message);
    return null;
  }
  if (clientIdResult.value === null) {
    return { clientId: null, clientName: null };
  }
  // findName doubles as an existence check (null ⇒ unknown client) and yields the canonical name.
  const clientName = await clientsRepo.findName(clientIdResult.value);
  if (clientName === null) {
    badRequest(reply, 'clientId does not reference an existing client');
    return null;
  }
  return { clientId: clientIdResult.value, clientName };
};

// Resolves the required supplier association from `supplierId`. Caller-supplied `supplierName` is
// never trusted: the canonical name is read from the suppliers table so quote labels, audit
// secondary labels, and version snapshots stay tied to the referenced supplier row.
const resolveSupplierLink = async (
  rawSupplierId: unknown,
  reply: FastifyReply,
): Promise<{ supplierId: string; supplierName: string } | null> => {
  const supplierIdResult = requireNonEmptyString(rawSupplierId, 'supplierId');
  if (!supplierIdResult.ok) {
    badRequest(reply, supplierIdResult.message);
    return null;
  }
  const supplierName = await suppliersRepo.findNameById(supplierIdResult.value);
  if (supplierName === null) {
    badRequest(reply, 'supplierId does not reference an existing supplier');
    return null;
  }
  return { supplierId: supplierIdResult.value, supplierName };
};

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

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  registerRevisionHistoryRoutes(fastify, {
    entityType: 'supplier_quote',
    viewPermission: 'sales.supplier_quotes.view',
    updatePermission: 'sales.supplier_quotes.update',
    exists: supplierQuotesRepo.existsById,
    list: revisionsRepo.listForSupplierQuote,
    find: revisionsRepo.findSupplierQuoteById,
    restore: async (quoteId, revision, userId, tx) => {
      const missingReference = await findMissingSnapshotReference(revision.snapshot, tx);
      if (missingReference) {
        throw new RevisionRestoreConflict(missingReference, 'snapshot_reference_missing');
      }
      const restored = await restoreSupplierQuoteRevision(quoteId, revision, userId, tx);
      if (!restored) return null;
      return {
        ...restored,
        status: supplierQuoteEffectiveStatus(restored),
        isStatusSynced: Boolean(restored.linkedClientQuoteId),
        items: await supplierQuotesRepo.findItemsForQuote(quoteId, tx),
      };
    },
    responseSchema: supplierQuoteSchema,
  });

  // Shared with the client→supplier item sync (issue #779) so version histories restore
  // identically no matter which write path minted them.
  const snapshotPreState = (
    quoteId: string,
    reason: supplierQuoteVersionsRepo.SupplierQuoteVersionReason,
    request: FastifyRequest,
    tx: DbExecutor,
  ) => snapshotSupplierQuotePreState(quoteId, reason, request.user?.id ?? null, tx);

  const findMissingSnapshotReference = async (
    snapshot: supplierQuoteVersionsRepo.SupplierQuoteVersionSnapshot,
    exec?: DbExecutor,
  ): Promise<string | null> => {
    const productIds = Array.from(
      new Set(
        snapshot.items
          .map((item) => item.productId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );

    // The optional client link lives only in JSON history; its FK isn't enforced on the snapshot.
    // A since-deleted client (the live link may have been cleared/changed, freeing the RESTRICT FK)
    // would otherwise surface as a 500 FK violation on restore instead of this clean 409.
    const clientId =
      typeof snapshot.quote.clientId === 'string' && snapshot.quote.clientId.length > 0
        ? snapshot.quote.clientId
        : null;

    const channelId = snapshot.quote.communicationChannelId;
    const supplierPromise = exec
      ? suppliersRepo.findById(snapshot.quote.supplierId, exec)
      : suppliersRepo.findById(snapshot.quote.supplierId);
    const clientPromise = clientId
      ? exec
        ? clientsRepo.existsById(clientId, exec)
        : clientsRepo.existsById(clientId)
      : Promise.resolve(true);
    const productsPromise =
      productIds.length > 0
        ? exec
          ? productsRepo.getSnapshots(productIds, exec)
          : productsRepo.getSnapshots(productIds)
        : Promise.resolve(null);
    const channelPromise = channelId
      ? exec
        ? quoteCommunicationChannelsRepo.findById(channelId, exec)
        : quoteCommunicationChannelsRepo.findById(channelId)
      : Promise.resolve(null);
    const [supplier, clientExists, products, channel] = await Promise.all([
      supplierPromise,
      clientPromise,
      productsPromise,
      channelPromise,
    ]);

    if (!supplier) {
      return `Snapshot supplier "${snapshot.quote.supplierId}" no longer exists`;
    }
    if (clientId && !clientExists) {
      return `Snapshot client "${clientId}" no longer exists`;
    }
    if (!channel) {
      return `Snapshot communication channel "${channelId ?? ''}" no longer exists`;
    }
    if (!products) return null;

    const missingProductId = productIds.find((id) => !products.has(id));
    return missingProductId ? `Snapshot product "${missingProductId}" no longer exists` : null;
  };

  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.supplier_quotes.view'),
      ],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'List supplier quotes',
        response: {
          200: { type: 'array', items: supplierQuoteSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => {
      const [quotes, items] = await Promise.all([
        supplierQuotesRepo.listAll(),
        supplierQuotesRepo.listAllItems(),
      ]);
      const itemsByQuote: Record<string, ReturnType<typeof projectItem>[]> = {};
      for (const item of items) {
        if (!itemsByQuote[item.quoteId]) itemsByQuote[item.quoteId] = [];
        itemsByQuote[item.quoteId].push(projectItem(item));
      }
      return quotes.map((quote) => ({
        ...projectQuote(quote),
        items: itemsByQuote[quote.id] || [],
      }));
    },
  );

  fastify.post(
    '/',
    {
      onRequest: [requirePermission('sales.supplier_quotes.create')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Create supplier quote',
        body: supplierQuoteCreateBodySchema,
        response: {
          201: supplierQuoteSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        id: nextId,
        description,
        supplierId,
        clientId,
        items,
        paymentTerms,
        expirationDate,
        communicationChannelId,
        notes,
      } = request.body as {
        id?: string;
        description?: string;
        supplierId?: string;
        clientId?: string | null;
        items?: ItemBody[];
        paymentTerms?: string;
        expirationDate?: string;
        communicationChannelId?: string;
        notes?: string;
      };

      const nextIdResult = validateOptionalDocumentCode(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);

      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      // A duplicate can carry an authoritative client-synced cost that differs from the displayed
      // list-price/discount formula. Preserve that explicitly supplied value on a new quote;
      // updates still derive from pricing inputs before reconciling against the stored row below.
      const normalizedItems = validateAndNormalizeItems(items, reply, {
        preserveProvidedUnitPrice: true,
      });
      if (!normalizedItems) return;
      const preservesClientSyncedCost = normalizedItems.some(
        (item) =>
          item.unitPrice !==
          deriveSupplierLinePricing(item.listPrice, item.discountPercent).unitPrice,
      );

      const expirationDateResult = parseDateString(expirationDate, 'expirationDate');
      if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);

      // supplierName from the body is ignored; resolve the canonical label from supplierId.
      const supplierLink = await resolveSupplierLink(supplierId, reply);
      if (!supplierLink) return;

      const clientLink = await resolveClientLink(clientId, reply);
      if (!clientLink) return;

      const communicationChannel = await resolveCommunicationChannel(
        communicationChannelId,
        reply,
        {
          required: true,
        },
      );
      if (!communicationChannel) return;

      // Status is fully derived from the linked client documents (issue #779): a new supplier
      // quote always stores the vestigial 'draft'; any client-sent status is ignored.

      let result: {
        quote: supplierQuotesRepo.SupplierQuote;
        items: supplierQuotesRepo.SupplierQuoteItem[];
      };
      try {
        result = await withDbTransaction(async (tx) => {
          let quoteId: string;
          if (nextIdResult.value) {
            await reserveDocumentCodeCounterFromCode('supplier_quote', nextIdResult.value, tx);
            quoteId = nextIdResult.value;
          } else {
            quoteId = await allocateDocumentCode('supplier_quote', { exec: tx });
          }
          const quote = await supplierQuotesRepo.create(
            {
              id: quoteId,
              description: description ?? null,
              supplierId: supplierLink.supplierId,
              supplierName: supplierLink.supplierName,
              clientId: clientLink.clientId,
              clientName: clientLink.clientName,
              paymentTerms: paymentTerms || 'immediate',
              status: 'draft',
              expirationDate: expirationDateResult.value,
              communicationChannelId: communicationChannel.id,
              notes: notes ?? null,
            },
            tx,
          );
          const createdItems = await supplierQuotesRepo.insertItems(quote.id, normalizedItems, tx);
          return { quote, items: createdItems };
        });
      } catch (error) {
        const codeCollision = replyDocumentCodeCollision(
          request,
          reply,
          error,
          'supplier_quote.create.conflict',
          'supplier_quote',
        );
        if (codeCollision) return codeCollision;
        const dup = getUniqueViolation(error);
        if (dup && (dup.constraint === 'supplier_quotes_pkey' || dup.detail?.includes('(id)'))) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Quote ID already exists',
            action: 'supplier_quote.create.conflict',
            entityType: 'supplier_quote',
            details: { secondaryLabel: 'duplicate_id' },
          });
        }
        throw error;
      }

      await logAudit({
        request,
        action: 'supplier_quote.created',
        entityType: 'supplier_quote',
        entityId: result.quote.id,
        details: {
          targetLabel: result.quote.id,
          secondaryLabel: result.quote.supplierName,
          changedFields: ['communicationChannelId'],
          toValue: communicationChannel.name,
          ...(preservesClientSyncedCost ? { reason: 'client_synced_cost_preserved' } : {}),
        },
      });
      return reply.code(201).send({
        ...projectQuote(result.quote),
        items: result.items.map(projectItem),
      });
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('sales.supplier_quotes.update')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Update supplier quote',
        params: idParamSchema,
        body: supplierQuoteUpdateBodySchema,
        response: {
          200: supplierQuoteSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      // Note: a client-sent `status` is deliberately NOT destructured — the supplier quote's
      // status is fully derived from its linked client documents (issue #779), so the field is
      // ignored if present.
      const {
        id: nextId,
        description,
        supplierId,
        clientId,
        items,
        paymentTerms,
        expirationDate,
        communicationChannelId,
        notes,
      } = request.body as {
        id?: string;
        description?: string | null;
        supplierId?: string;
        clientId?: string | null;
        items?: ItemBody[];
        paymentTerms?: string;
        expirationDate?: string;
        communicationChannelId?: string;
        notes?: string;
      };

      const idResult = requirePathSegment(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      // Two related flags with different jobs (issue #779): `hasNonExpirationContentUpdate` drives
      // the non-draft read-only guard — the expiration date is excluded because a
      // non-draft/synced/expired supplier quote stays editable for its expiration date alone, so
      // an expiration-only PUT must not trip the guard. `hasContentUpdate` (any snapshot-worthy
      // field, expiration included) decides whether to take a version snapshot before writing;
      // id-only renames do not. Derived from one list so the field sets can't drift. A client-sent
      // `status` is IGNORED entirely: the status is fully derived from the linked client documents.
      // `supplierName` is also ignored (resolved from supplierId when the id changes).
      const hasNonExpirationContentUpdate =
        description !== undefined ||
        supplierId !== undefined ||
        clientId !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        communicationChannelId !== undefined ||
        notes !== undefined;
      const hasContentUpdate = hasNonExpirationContentUpdate || expirationDate !== undefined;

      const patch: supplierQuotesRepo.SupplierQuoteUpdate = {};

      if (description !== undefined) patch.description = description;

      // Validate supplierId format here; resolve/write the canonical name later and only when the
      // id actually changes (mirrors clientId/#759). Caller-supplied supplierName is never trusted.
      let incomingSupplierId: string | null = null;
      if (supplierId !== undefined) {
        const supplierIdResult = optionalNonEmptyString(supplierId, 'supplierId');
        if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);
        if (supplierIdResult.value !== null) incomingSupplierId = supplierIdResult.value;
      }

      // Validate the clientId format here, but resolve/write the link later and only when it
      // actually changes (see below). The edit form resubmits the existing clientId on every
      // save, so re-resolving each time would overwrite the stored historical clientName after a
      // client rename (#759).
      let clientIdProvided = false;
      let incomingClientId: string | null = null;
      if (clientId !== undefined) {
        const clientIdResult = optionalNonEmptyString(clientId, 'clientId');
        if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
        clientIdProvided = true;
        incomingClientId = clientIdResult.value;
      }

      let nextIdValue: string | null = null;
      if (nextId !== undefined) {
        const nextIdResult =
          typeof nextId === 'string' && nextId.trim() === idResult.value
            ? ({ ok: true, value: idResult.value } as const)
            : validateOptionalDocumentCode(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
      }

      if (paymentTerms !== undefined) patch.paymentTerms = paymentTerms;
      if (notes !== undefined) patch.notes = notes;

      if (expirationDate !== undefined) {
        const expirationDateResult = optionalDateString(expirationDate, 'expirationDate');
        if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);
        if (expirationDateResult.value !== null) patch.expirationDate = expirationDateResult.value;
      }

      if (communicationChannelId !== undefined) {
        const communicationChannel = await resolveCommunicationChannel(
          communicationChannelId,
          reply,
          {
            required: false,
          },
        );
        if (!communicationChannel) return;
        patch.communicationChannelId = communicationChannel.id;
      }

      let normalizedItems: supplierQuotesRepo.NewSupplierQuoteItem[] | null = null;
      if (items) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        normalizedItems = validateAndNormalizeItems(items, reply);
        if (!normalizedItems) return;
      }

      // An id rename strands a sourced quote's client lines too: quote_items.supplier_quote_id is a
      // soft, FK-less denormalized value that does NOT cascade, so after a rename the derived-status
      // reverse lookup and the client progression/expiration guards can no longer find them.
      const isRenaming = nextIdValue !== null && nextIdValue !== idResult.value;
      const [current, linkedOrderId, idConflict] = await Promise.all([
        supplierQuotesRepo.findById(idResult.value),
        supplierQuotesRepo.findLinkedOrderId(idResult.value),
        nextIdValue
          ? supplierQuotesRepo.findIdConflict(nextIdValue, idResult.value)
          : Promise.resolve(false),
      ]);
      if (!current) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.update.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }
      if (linkedOrderId) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Quotes become read-only once an order exists',
          action: 'supplier_quote.update.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'order_exists' },
        });
      }
      const currentEffective = supplierQuoteEffectiveStatus(current);
      if (currentEffective !== 'draft' && hasNonExpirationContentUpdate) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Non-draft supplier quotes are read-only',
          action: 'supplier_quote.update.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'non_draft_read_only', fromValue: currentEffective },
        });
      }
      if (idConflict) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Quote ID already exists',
          action: 'supplier_quote.update.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'duplicate_id' },
        });
      }

      // Touch the supplier link only when it actually changes. An unchanged supplierId (the edit
      // form resubmits it on every save) leaves the stored supplierName intact so it survives later
      // supplier renames; a changed id re-resolves the canonical name. Caller-supplied supplierName
      // is never written.
      if (incomingSupplierId !== null && incomingSupplierId !== current.supplierId) {
        const supplierLink = await resolveSupplierLink(incomingSupplierId, reply);
        if (!supplierLink) return;
        patch.supplierId = supplierLink.supplierId;
        patch.supplierName = supplierLink.supplierName;
      }

      // Touch the customer link only when it actually changes. An unchanged clientId (the edit
      // form resubmits it on every save) leaves the stored clientName intact so it survives later
      // client renames; a changed link re-resolves the canonical name (or clears both on null).
      if (clientIdProvided && incomingClientId !== current.clientId) {
        if (incomingClientId === null) {
          patch.clientId = null;
          patch.clientName = null;
        } else {
          const clientName = await clientsRepo.findName(incomingClientId);
          if (clientName === null) {
            return badRequest(reply, 'clientId does not reference an existing client');
          }
          patch.clientId = incomingClientId;
          patch.clientName = clientName;
        }
      }

      let updated: supplierQuotesRepo.SupplierQuote | null;
      let resultItems: supplierQuotesRepo.SupplierQuoteItem[];
      try {
        type UpdateConflict =
          | 'order_exists'
          | 'non_draft_read_only'
          | 'rename_sourced'
          | 'sourced_item_product_changed'
          | 'sourced_item_removed';
        const txResult = await withDbTransaction(
          async (
            tx,
          ): Promise<{
            quote: supplierQuotesRepo.SupplierQuote | null;
            items: supplierQuotesRepo.SupplierQuoteItem[];
            conflict?: UpdateConflict;
          }> => {
            // Client quote/offer/order item writers lock this same row before persisting their soft
            // supplier references. Hold it through the final guard reads and destructive upsert or
            // rename so a concurrent writer either lands first and is observed here, or waits and
            // revalidates the source after this transaction commits.
            const locked = await supplierQuotesRepo.lockEffectiveStatusById(idResult.value, tx);
            if (!locked) return { quote: null, items: [] };
            if (await supplierQuotesRepo.findLinkedOrderId(idResult.value, tx)) {
              return { quote: null, items: [], conflict: 'order_exists' };
            }
            if (
              effectiveSupplierQuoteStatusFromDate(locked) !== 'draft' &&
              hasNonExpirationContentUpdate
            ) {
              return { quote: null, items: [], conflict: 'non_draft_read_only' };
            }
            if (
              isRenaming &&
              (await supplierQuotesRepo.isSourcedByClientDocuments(idResult.value, tx))
            ) {
              return { quote: null, items: [], conflict: 'rename_sourced' };
            }
            if (normalizedItems) {
              const existingItems = await supplierQuotesRepo.findItemsForQuote(idResult.value, tx);
              const sourcedItemIds = await supplierQuotesRepo.findSourcedItemIds(
                idResult.value,
                tx,
              );
              const existingItemById = new Map(
                existingItems.map((item) => [item.id, item] as const),
              );
              const existingIds = new Set(existingItemById.keys());
              const claimedIds = new Set<string>();
              normalizedItems.forEach((normalized, index) => {
                const incomingId = items?.[index]?.id;
                if (incomingId && existingIds.has(incomingId) && !claimedIds.has(incomingId)) {
                  normalized.id = incomingId;
                  claimedIds.add(incomingId);
                  const existing = existingItemById.get(incomingId);
                  if (
                    existing &&
                    normalized.listPrice === existing.listPrice &&
                    normalized.discountPercent === existing.discountPercent
                  ) {
                    normalized.unitPrice = normalizeSupplierUnitPrice(existing.unitPrice);
                  }
                }
              });
              const existingProductById = new Map(
                existingItems.map((item) => [item.id, item.productId] as const),
              );
              if (
                normalizedItems.some(
                  (item) =>
                    sourcedItemIds.has(item.id) &&
                    existingProductById.get(item.id) !== item.productId,
                )
              ) {
                return { quote: null, items: [], conflict: 'sourced_item_product_changed' };
              }
              if (
                [...sourcedItemIds].some(
                  (sourcedId) => existingIds.has(sourcedId) && !claimedIds.has(sourcedId),
                )
              ) {
                return { quote: null, items: [], conflict: 'sourced_item_removed' };
              }
            }
            // Snapshot only when the patch carries actual content. ID-only renames cascade
            // through the FK without altering snapshot fields, and empty PUTs are no-ops in
            // `update()` - both would otherwise create misleading "Save" rows.
            if (hasContentUpdate) {
              await snapshotPreState(idResult.value, 'update', request, tx);
            }
            let renamedQuote: supplierQuotesRepo.SupplierQuote | null = null;
            if (nextIdValue && nextIdValue !== idResult.value) {
              renamedQuote = await supplierQuotesRepo.rename(idResult.value, nextIdValue, tx);
              if (!renamedQuote) {
                return { quote: null, items: [] as supplierQuotesRepo.SupplierQuoteItem[] };
              }
              await reserveDocumentCodeCounterFromCode('supplier_quote', nextIdValue, tx);
            }
            // id-only renames have nothing left to write — reuse the row returned by rename().
            const quote =
              Object.keys(patch).length === 0 && renamedQuote
                ? renamedQuote
                : await supplierQuotesRepo.update(renamedQuote?.id ?? idResult.value, patch, tx);
            if (!quote) return { quote: null, items: [] as supplierQuotesRepo.SupplierQuoteItem[] };
            // upsertItems (not replaceItems): rows whose id survived the claim pass above keep
            // their identity, so client lines sourcing them stay attached across the edit.
            const finalItems = normalizedItems
              ? await supplierQuotesRepo.upsertItems(quote.id, normalizedItems, tx)
              : await supplierQuotesRepo.findItemsForQuote(quote.id, tx);
            return { quote, items: finalItems };
          },
        );
        if (txResult.conflict) {
          const conflictMessages: Record<UpdateConflict, string> = {
            order_exists: 'Quotes become read-only once an order exists',
            non_draft_read_only: 'Non-draft supplier quotes are read-only',
            rename_sourced:
              'Cannot change the id of a supplier quote whose items are used by client quotes, offers or orders',
            sourced_item_product_changed:
              'Cannot change the product of supplier quote items that are used by client quotes, offers or orders',
            sourced_item_removed:
              'Cannot remove supplier quote items that are used by client quotes, offers or orders',
          };
          const conflictLabels: Record<UpdateConflict, string> = {
            order_exists: 'order_exists',
            non_draft_read_only: 'non_draft_read_only',
            rename_sourced: 'sourced_by_client_documents',
            sourced_item_product_changed: 'sourced_item_product_changed',
            sourced_item_removed: 'sourced_item_removed',
          };
          return replyError(request, reply, {
            statusCode: 409,
            message: conflictMessages[txResult.conflict],
            action: 'supplier_quote.update.conflict',
            entityType: 'supplier_quote',
            entityId: idResult.value,
            details: { secondaryLabel: conflictLabels[txResult.conflict] },
          });
        }
        updated = txResult.quote;
        resultItems = txResult.items;
      } catch (error) {
        const dup = getUniqueViolation(error);
        if (dup && (dup.constraint === 'supplier_quotes_pkey' || dup.detail?.includes('(id)'))) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Quote ID already exists',
            action: 'supplier_quote.update.conflict',
            entityType: 'supplier_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'duplicate_id' },
          });
        }
        throw error;
      }

      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.update.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }

      await logAudit({
        request,
        action: 'supplier_quote.updated',
        entityType: 'supplier_quote',
        entityId: updated.id,
        details: {
          targetLabel: updated.id,
          secondaryLabel: updated.supplierName,
        },
      });
      // update()/rename() return only the supplier_quotes columns (bare .returning()), so `updated`
      // lacks the reverse-lookup link fields. This PUT cannot change them — the link is owned by
      // quotes.linked_supplier_quote_id (renames survive via ON UPDATE CASCADE) and status is
      // fully derived — so carry them over from `current` instead of re-reading the row (#779).
      return {
        ...projectQuote({
          ...updated,
          linkedClientQuoteId: current.linkedClientQuoteId,
          linkedClientQuoteStatus: current.linkedClientQuoteStatus,
          linkedClientQuoteExpiration: current.linkedClientQuoteExpiration,
          linkedOfferStatus: current.linkedOfferStatus,
          linkedOfferExpiration: current.linkedOfferExpiration,
        }),
        items: resultItems.map(projectItem),
      };
    },
  );

  // ---------------------------------------------------------------------------------------
  // Version history
  // ---------------------------------------------------------------------------------------

  const versionParamSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      versionId: { type: 'string' },
    },
    required: ['id', 'versionId'],
  } as const;

  const supplierQuoteVersionRowSchema = {
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

  const supplierQuoteVersionSchema = {
    type: 'object',
    properties: { ...supplierQuoteVersionRowSchema.properties, snapshot: {} },
    required: [...supplierQuoteVersionRowSchema.required, 'snapshot'],
  } as const;

  fastify.get(
    '/:id/versions',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.supplier_quotes.view'),
      ],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'List versions for a supplier quote',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: supplierQuoteVersionRowSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requirePathSegment(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const [exists, versions] = await Promise.all([
        supplierQuotesRepo.existsById(idResult.value),
        supplierQuoteVersionsRepo.listForQuote(idResult.value),
      ]);
      if (!exists) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.versions_list.not_found',
          entityType: 'supplier_quote',
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
        requirePermission('sales.supplier_quotes.view'),
      ],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Get a single supplier quote version',
        params: versionParamSchema,
        response: {
          200: supplierQuoteVersionSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, versionId } = request.params as { id: string; versionId: string };
      const idResult = requirePathSegment(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const versionIdResult = requirePathSegment(versionId, 'versionId');
      if (!versionIdResult.ok) return badRequest(reply, versionIdResult.message);

      const version = await supplierQuoteVersionsRepo.findById(
        idResult.value,
        versionIdResult.value,
      );
      if (!version) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Version not found',
          action: 'supplier_quote.version_get.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: versionIdResult.value },
        });
      }
      const hasClientSyncMarker = await supplierQuotesRepo.hasClientSyncedCosts(
        idResult.value,
        version.createdAt,
      );
      return {
        ...version,
        snapshot: {
          ...version.snapshot,
          items: version.snapshot.items.map((item) =>
            normalizeSupplierQuoteSnapshotPricing(item, hasClientSyncMarker),
          ),
        },
      };
    },
  );

  fastify.post(
    '/:id/versions/:versionId/restore',
    {
      onRequest: [requirePermission('sales.supplier_quotes.update')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Restore a supplier quote to a prior version',
        params: versionParamSchema,
        response: {
          200: supplierQuoteSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, versionId } = request.params as { id: string; versionId: string };
      const idResult = requirePathSegment(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const versionIdResult = requirePathSegment(versionId, 'versionId');
      if (!versionIdResult.ok) return badRequest(reply, versionIdResult.message);

      const [linkedOrderId, current, version, sourcedByClientDocuments] = await Promise.all([
        supplierQuotesRepo.findLinkedOrderId(idResult.value),
        supplierQuotesRepo.findById(idResult.value),
        supplierQuoteVersionsRepo.findById(idResult.value, versionIdResult.value),
        // Restore always rewrites items with fresh ids (replaceItems below), so the soft-ref
        // stranding check is always relevant here — run it alongside the other lookups.
        supplierQuotesRepo.isSourcedByClientDocuments(idResult.value),
      ]);

      if (linkedOrderId) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Quotes become read-only once an order exists',
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'order_exists' },
        });
      }
      if (!current) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.restore.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }
      if (!version) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Version not found',
          action: 'supplier_quote.restore.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: versionIdResult.value },
        });
      }
      // A linked supplier quote's content and stored status are driven by its client quote
      // (synced/read-only, issue #779); a restore would silently rewrite the stored lifecycle
      // underneath the sync and surface the moment the link is cleared.
      if (current.linkedClientQuoteId) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'This supplier quote’s status is synced from its client quote and read-only',
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'status_synced_read_only' },
        });
      }
      // The status-sync guard above only catches quotes sourced by a client QUOTE. Restore
      // regenerates every supplier_quote_item id (generatePrefixedId below) and rewrites them via
      // replaceItems, so restoring a quote sourced by ANY client document — including order/offer
      // lines that never surface as linkedClientQuoteId — would strand those lines' soft
      // supplierQuoteItemId references. The PUT and DELETE paths refuse a sourced quote for the
      // same reason; restore must too.
      if (sourcedByClientDocuments) {
        return replyError(request, reply, {
          statusCode: 409,
          message:
            'Cannot restore a supplier quote whose items are used by client quotes, offers or orders',
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'sourced_by_client_documents' },
        });
      }
      const missingSnapshotReference = await findMissingSnapshotReference(version.snapshot);
      if (missingSnapshotReference) {
        return replyError(request, reply, {
          statusCode: 409,
          message: missingSnapshotReference,
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'snapshot_reference_missing' },
        });
      }
      const snapshotExpirationDate = version.snapshot.quote.expirationDate;
      if (!snapshotExpirationDate) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Snapshot expiration date is missing',
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'snapshot_expiration_missing' },
        });
      }

      // Migration 0116 uses this durable marker to distinguish an old scale-2 formula result from
      // an explicit client-authored cost with the same numeric value. Scope the marker to the
      // version timestamp so a later client sync cannot change an older snapshot's provenance.
      const hasClientSyncMarker = await supplierQuotesRepo.hasClientSyncedCosts(
        idResult.value,
        version.createdAt,
      );

      const snapshotItems: supplierQuotesRepo.NewSupplierQuoteItem[] = version.snapshot.items.map(
        ({ quoteId: _q, ...rest }) => {
          // Snapshots taken before list price / discount existed lack those keys, so seed list price
          // from the net unit price (no discount). The shared preview/restore helper upgrades a
          // legacy scale-2 formula result unless the client-sync marker makes it authoritative.
          const pricing = normalizeSupplierQuoteSnapshotPricing(rest, hasClientSyncMarker);
          return {
            ...pricing,
            id: generatePrefixedId(ITEM_ID_PREFIXES.supplierQuoteItem),
            productId: rest.productId || null,
            unitType: rest.unitType ?? 'unit',
            note: rest.note ?? null,
            // Snapshots taken before duration existed (issue #776) lack both keys; default to a
            // single month so the restored line keeps its pre-duration total.
            durationMonths: rest.durationMonths ?? 1,
            durationUnit: rest.durationUnit ?? 'months',
          };
        },
      );

      const restored = await withDbTransaction(async (tx) => {
        const locked = await supplierQuotesRepo.lockEffectiveStatusById(idResult.value, tx);
        if (!locked) return { quote: null, items: [] as supplierQuotesRepo.SupplierQuoteItem[] };
        if (await supplierQuotesRepo.findLinkedOrderId(idResult.value, tx)) {
          return {
            quote: null,
            items: [] as supplierQuotesRepo.SupplierQuoteItem[],
            orderConflict: true,
          };
        }
        if (await supplierQuotesRepo.isSourcedByClientDocuments(idResult.value, tx)) {
          return {
            quote: null,
            items: [] as supplierQuotesRepo.SupplierQuoteItem[],
            sourcedConflict: true,
          };
        }
        // Snapshot current with reason='restore' so the just-replaced data stays recoverable.
        await snapshotPreState(idResult.value, 'restore', request, tx);
        const snapshotCommunicationChannelId =
          typeof version.snapshot.quote.communicationChannelId === 'string' &&
          version.snapshot.quote.communicationChannelId.length > 0
            ? version.snapshot.quote.communicationChannelId
            : null;
        const restoreCommunicationChannel = snapshotCommunicationChannelId
          ? await quoteCommunicationChannelsRepo.findById(snapshotCommunicationChannelId, tx)
          : await quoteCommunicationChannelsRepo.findDefault(tx);
        if (!restoreCommunicationChannel) {
          return {
            quote: null,
            items: [] as supplierQuotesRepo.SupplierQuoteItem[],
            missingChannel: true,
          };
        }

        const quote = await supplierQuotesRepo.restoreSnapshotQuote(
          idResult.value,
          {
            ...(Object.hasOwn(version.snapshot.quote, 'description')
              ? { description: version.snapshot.quote.description ?? null }
              : {}),
            supplierId: version.snapshot.quote.supplierId,
            supplierName: version.snapshot.quote.supplierName,
            // `?? null` tolerates pre-#759 snapshots that predate the customer columns.
            clientId: version.snapshot.quote.clientId ?? null,
            clientName: version.snapshot.quote.clientName ?? null,
            paymentTerms: version.snapshot.quote.paymentTerms ?? 'immediate',
            // Fold legacy received/approved/rejected (and any other pre-#779 spelling) to the
            // canonical set so the tightened CHECK (migration 0083) accepts the restore write.
            status: normalizeQuoteStatus(version.snapshot.quote.status),
            expirationDate: snapshotExpirationDate,
            communicationChannelId: restoreCommunicationChannel.id,
            notes: version.snapshot.quote.notes,
          },
          tx,
        );
        if (!quote) return { quote: null, items: [] as supplierQuotesRepo.SupplierQuoteItem[] };
        const items = await supplierQuotesRepo.replaceItems(quote.id, snapshotItems, tx);
        return { quote, items };
      });

      if ('orderConflict' in restored && restored.orderConflict) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Quotes become read-only once an order exists',
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'order_exists' },
        });
      }

      if ('sourcedConflict' in restored && restored.sourcedConflict) {
        return replyError(request, reply, {
          statusCode: 409,
          message:
            'Cannot restore a supplier quote whose items are used by client quotes, offers or orders',
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'sourced_by_client_documents' },
        });
      }

      if ('missingChannel' in restored && restored.missingChannel) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'No communication channel is available for restore',
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'communication_channel_missing' },
        });
      }

      if (!restored.quote) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.restore.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }

      await logAudit({
        request,
        action: 'supplier_quote.restored',
        entityType: 'supplier_quote',
        entityId: restored.quote.id,
        details: {
          targetLabel: restored.quote.id,
          secondaryLabel: restored.quote.supplierName,
          toValue: versionIdResult.value,
        },
      });

      // The quote is necessarily unlinked here (linked quotes reject restore above), so the bare
      // restoreSnapshotQuote row already carries the correct (null) link/sync fields (issue #779).
      return {
        ...projectQuote(restored.quote),
        items: restored.items.map(projectItem),
      };
    },
  );

  // ---------------------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------------------

  const attachmentsLogger = createChildLogger({ module: 'supplier-quote-attachments' });

  const attachmentParamSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      attachmentId: { type: 'string' },
    },
    required: ['id', 'attachmentId'],
  } as const;

  const supplierQuoteAttachmentSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      quoteId: { type: 'string' },
      fileName: { type: 'string' },
      mimeType: { type: 'string' },
      fileSize: { type: 'number' },
      uploadedByUserId: { type: ['string', 'null'] },
      createdAt: { type: 'number' },
    },
    required: ['id', 'quoteId', 'fileName', 'mimeType', 'fileSize', 'createdAt'],
  } as const;

  const projectAttachment = (attachment: supplierQuoteAttachmentsRepo.SupplierQuoteAttachment) => ({
    id: attachment.id,
    quoteId: attachment.quoteId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    uploadedByUserId: attachment.uploadedByUserId,
    createdAt: attachment.createdAt,
  });

  // Mutation guard mirrors the existing supplier-quote edit rules: only `draft` quotes that
  // are not yet linked to an order may be modified. Returns the quote on success, or sends
  // the appropriate error response and returns null.
  const assertQuoteEditableForAttachments = async (
    id: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<supplierQuotesRepo.SupplierQuote | null> => {
    const [quote, linkedOrderId] = await Promise.all([
      supplierQuotesRepo.findById(id),
      supplierQuotesRepo.findLinkedOrderId(id),
    ]);
    if (!quote) {
      await replyError(request, reply, {
        statusCode: 404,
        message: 'Supplier quote not found',
        action: 'supplier_quote_attachment.mutate.not_found',
        entityType: 'supplier_quote',
        entityId: id,
      });
      return null;
    }
    if (linkedOrderId) {
      await replyError(request, reply, {
        statusCode: 409,
        message: 'Quotes become read-only once an order exists',
        action: 'supplier_quote_attachment.mutate.conflict',
        entityType: 'supplier_quote',
        entityId: id,
        details: { secondaryLabel: 'order_exists' },
      });
      return null;
    }
    const effectiveStatus = supplierQuoteEffectiveStatus(quote);
    if (effectiveStatus !== 'draft') {
      await replyError(request, reply, {
        statusCode: 409,
        message: 'Attachments can only be modified on draft supplier quotes',
        action: 'supplier_quote_attachment.mutate.conflict',
        entityType: 'supplier_quote',
        entityId: id,
        details: { secondaryLabel: 'non_draft_status', fromValue: effectiveStatus },
      });
      return null;
    }
    return quote;
  };

  fastify.get(
    '/:id/attachments',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.supplier_quotes.view'),
      ],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'List attachments for a supplier quote',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: supplierQuoteAttachmentSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requirePathSegment(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const exists = await supplierQuotesRepo.existsById(idResult.value);
      if (!exists) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote_attachment.list.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }
      const attachments = await supplierQuoteAttachmentsRepo.listForQuote(idResult.value);
      return attachments.map(projectAttachment);
    },
  );

  fastify.post(
    '/:id/attachments',
    {
      onRequest: [requirePermission('sales.supplier_quotes.update')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Upload an attachment to a supplier quote',
        params: idParamSchema,
        consumes: ['multipart/form-data'],
        response: {
          201: supplierQuoteAttachmentSchema,
          ...standardErrorResponses,
          413: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
          415: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requirePathSegment(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (!request.isMultipart()) {
        return replyError(request, reply, {
          statusCode: 400,
          message: 'Request must be multipart/form-data',
          action: 'supplier_quote_attachment.upload.invalid',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'not_multipart' },
        });
      }

      const quote = await assertQuoteEditableForAttachments(idResult.value, request, reply);
      if (!quote) return;

      let uploaded: { storedName: string; size: number } | null = null;
      try {
        const part = await request.file();
        if (!part) {
          return replyError(request, reply, {
            statusCode: 400,
            message: 'A file is required',
            action: 'supplier_quote_attachment.upload.invalid',
            entityType: 'supplier_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'no_file' },
          });
        }

        const originalName = part.filename?.trim();

        // Drain the multipart stream up front, before any validation early-returns. If we
        // bail on filename/MIME without consuming `part.file`, fastify-multipart leaves the
        // request body un-drained which can stall the connection until the parser times out.
        let buffer: Buffer;
        try {
          buffer = await part.toBuffer();
        } catch (err) {
          if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
            return reply.code(413).send({ error: 'File exceeds the 10 MB upload limit' });
          }
          throw err;
        }

        if (!originalName) {
          return replyError(request, reply, {
            statusCode: 400,
            message: 'Uploaded file is missing a filename',
            action: 'supplier_quote_attachment.upload.invalid',
            entityType: 'supplier_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'missing_filename' },
          });
        }

        const mimeType = part.mimetype || 'application/octet-stream';
        if (!isAllowedAttachment(mimeType, originalName)) {
          return reply.code(415).send({ error: 'File type not allowed. Use xlsx, pdf, or docx.' });
        }

        if (buffer.byteLength > ATTACHMENT_MAX_BYTES) {
          return reply.code(413).send({ error: 'File exceeds the 10 MB upload limit' });
        }
        if (buffer.byteLength === 0) {
          return replyError(request, reply, {
            statusCode: 400,
            message: 'Uploaded file is empty',
            action: 'supplier_quote_attachment.upload.invalid',
            entityType: 'supplier_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'empty_file' },
          });
        }

        uploaded = await saveSupplierQuoteAttachment(buffer, originalName);

        const attachment = await supplierQuoteAttachmentsRepo.insert({
          id: generatePrefixedId('sqa'),
          quoteId: idResult.value,
          fileName: originalName,
          storedName: uploaded.storedName,
          mimeType,
          fileSize: uploaded.size,
          uploadedByUserId: request.user?.id ?? null,
        });
        // DB row is now the source of truth - clear the cleanup token before audit so a
        // failing audit log doesn't unlink the file under a live row.
        uploaded = null;

        await logAudit({
          request,
          action: 'supplier_quote_attachment.uploaded',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: {
            targetLabel: attachment.fileName,
            secondaryLabel: quote.supplierName,
          },
        });

        return reply.code(201).send(projectAttachment(attachment));
      } finally {
        if (uploaded) {
          await deleteSupplierQuoteAttachment(uploaded.storedName).catch((err) => {
            attachmentsLogger.warn(
              { err, storedName: uploaded?.storedName },
              'Failed to clean up orphaned upload after error',
            );
          });
        }
      }
    },
  );

  fastify.get(
    '/:id/attachments/:attachmentId/download',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.supplier_quotes.view'),
      ],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Download a supplier-quote attachment',
        params: attachmentParamSchema,
        response: {
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, attachmentId } = request.params as { id: string; attachmentId: string };
      const idResult = requirePathSegment(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const attachmentIdResult = requirePathSegment(attachmentId, 'attachmentId');
      if (!attachmentIdResult.ok) return badRequest(reply, attachmentIdResult.message);

      const attachment = await supplierQuoteAttachmentsRepo.findById(attachmentIdResult.value);
      if (!attachment || attachment.quoteId !== idResult.value) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Attachment not found',
          action: 'supplier_quote_attachment.download.not_found',
          entityType: 'supplier_quote_attachment',
          entityId: attachmentIdResult.value,
        });
      }

      let opened: OpenedAttachment;
      try {
        opened = await openSupplierQuoteAttachment(attachment.storedName);
      } catch (err) {
        attachmentsLogger.warn(
          { err, attachmentId: attachment.id },
          'Stored attachment file is missing or unreadable',
        );
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Attachment file is no longer available',
          action: 'supplier_quote_attachment.download.not_found',
          entityType: 'supplier_quote_attachment',
          entityId: attachmentIdResult.value,
          details: { secondaryLabel: 'file_missing' },
        });
      }

      // RFC 6266: provide an ASCII-safe `filename` for legacy clients plus an RFC 5987
      // `filename*` with UTF-8 encoding for Unicode filenames. Strip CR/LF/quote/backslash
      // from the legacy form to prevent header injection through user-controlled filenames.
      // `encodeURIComponent` already emits valid `%XX%XX` UTF-8 byte pairs; we only need to
      // additionally encode `'`, `(`, `)` per RFC 5987 (the legacy global `escape()` would
      // emit invalid `%uXXXX` for non-BMP codepoints, hence explicit replacements here).
      const asciiFallback = attachment.fileName.replace(/[\r\n"\\]/g, '');
      const utf8EncodedName = encodeURIComponent(attachment.fileName)
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');
      reply.header('Content-Type', attachment.mimeType || 'application/octet-stream');
      reply.header('Content-Length', String(opened.size));
      reply.header(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8EncodedName}`,
      );
      return reply.send(opened.stream);
    },
  );

  fastify.delete(
    '/:id/attachments/:attachmentId',
    {
      onRequest: [requirePermission('sales.supplier_quotes.update')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Delete a supplier-quote attachment',
        params: attachmentParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, attachmentId } = request.params as { id: string; attachmentId: string };
      const idResult = requirePathSegment(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const attachmentIdResult = requirePathSegment(attachmentId, 'attachmentId');
      if (!attachmentIdResult.ok) return badRequest(reply, attachmentIdResult.message);

      const quote = await assertQuoteEditableForAttachments(idResult.value, request, reply);
      if (!quote) return;

      const deleted = await supplierQuoteAttachmentsRepo.deleteById(
        attachmentIdResult.value,
        idResult.value,
      );
      if (!deleted) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Attachment not found',
          action: 'supplier_quote_attachment.delete.not_found',
          entityType: 'supplier_quote_attachment',
          entityId: attachmentIdResult.value,
        });
      }

      await deleteSupplierQuoteAttachment(deleted.storedName).catch((err) => {
        attachmentsLogger.warn(
          { err, storedName: deleted.storedName },
          'Failed to remove attachment file from disk',
        );
      });

      await logAudit({
        request,
        action: 'supplier_quote_attachment.deleted',
        entityType: 'supplier_quote',
        entityId: idResult.value,
        details: {
          targetLabel: deleted.fileName,
          secondaryLabel: quote.supplierName,
        },
      });
      return reply.code(204).send();
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('sales.supplier_quotes.delete')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Delete supplier quote',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requirePathSegment(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      type DeleteOutcome =
        | {
            kind: 'deleted';
            deleted: NonNullable<
              Awaited<ReturnType<typeof supplierQuotesRepo.deleteByIdWithAttachmentStoredNames>>
            >;
          }
        | { kind: 'not_found' }
        | { kind: 'order_conflict' }
        | { kind: 'sourced_conflict' };
      const outcome = await withDbTransaction(async (tx): Promise<DeleteOutcome> => {
        const locked = await supplierQuotesRepo.lockEffectiveStatusById(idResult.value, tx);
        if (!locked) return { kind: 'not_found' };
        if (await supplierQuotesRepo.findLinkedOrderId(idResult.value, tx)) {
          return { kind: 'order_conflict' };
        }
        if (await supplierQuotesRepo.isSourcedByClientDocuments(idResult.value, tx)) {
          return { kind: 'sourced_conflict' };
        }
        const deleted = await supplierQuotesRepo.deleteByIdWithAttachmentStoredNames(
          idResult.value,
          tx,
        );
        return deleted ? { kind: 'deleted', deleted } : { kind: 'not_found' };
      });

      if (outcome.kind === 'order_conflict') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Cannot delete a quote once an order has been created from it',
          action: 'supplier_quote.delete.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'order_exists' },
        });
      }

      // Sourcing happens from DRAFT quotes under the derived model (issue #779) — exactly the
      // deletable ones — and the client-line references have no FK behind them, so deleting a
      // sourced quote would strand those lines with dead supplierQuoteItemIds (their next edit
      // would 400). Refuse instead.
      if (outcome.kind === 'sourced_conflict') {
        return replyError(request, reply, {
          statusCode: 409,
          message:
            'Cannot delete a supplier quote whose items are used by client quotes, offers or orders',
          action: 'supplier_quote.delete.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'sourced_by_client_documents' },
        });
      }

      if (outcome.kind === 'not_found') {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.delete.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }
      const { deleted } = outcome;

      await Promise.all(
        deleted.attachmentStoredNames.map((storedName) =>
          deleteSupplierQuoteAttachment(storedName).catch((err) => {
            attachmentsLogger.warn(
              { err, storedName },
              'Failed to remove attachment file during quote delete',
            );
          }),
        ),
      );

      await logAudit({
        request,
        action: 'supplier_quote.deleted',
        entityType: 'supplier_quote',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: deleted.supplierName,
        },
      });
      return reply.code(204).send();
    },
  );
}
