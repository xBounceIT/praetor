import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withTransaction } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as clientOffersRepo from '../repositories/clientOffersRepo.ts';
import * as clientQuotesRepo from '../repositories/clientQuotesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { isUniqueViolation } from '../utils/db-errors.ts';
import { generateItemId } from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';
import {
  badRequest,
  optionalDateString,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  parseLocalizedPositiveNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

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
    productMolPercentage: { type: 'number' },
    supplierQuoteId: { type: 'string' },
    supplierQuoteItemId: { type: 'string' },
    supplierQuoteSupplierName: { type: 'string' },
    supplierQuoteUnitPrice: { type: 'number' },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    discount: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['productName', 'quantity', 'unitPrice'],
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
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
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
    const itemDiscountResult = optionalLocalizedNonNegativeNumber(
      item.discount,
      `items[${i}].discount`,
    );
    if (!itemDiscountResult.ok) {
      badRequest(reply, itemDiscountResult.message);
      return null;
    }
    normalizedItems.push({
      productId: item.productId || null,
      productName: productNameResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      productCost: Number(item.productCost ?? 0),
      productMolPercentage:
        item.productMolPercentage === undefined || item.productMolPercentage === null
          ? null
          : Number(item.productMolPercentage),
      supplierQuoteId:
        item.supplierQuoteId === undefined || item.supplierQuoteId === null
          ? null
          : String(item.supplierQuoteId),
      supplierQuoteItemId:
        item.supplierQuoteItemId === undefined || item.supplierQuoteItemId === null
          ? null
          : String(item.supplierQuoteItemId),
      supplierQuoteSupplierName:
        item.supplierQuoteSupplierName === undefined || item.supplierQuoteSupplierName === null
          ? null
          : String(item.supplierQuoteSupplierName),
      supplierQuoteUnitPrice:
        item.supplierQuoteUnitPrice === undefined || item.supplierQuoteUnitPrice === null
          ? null
          : Number(item.supplierQuoteUnitPrice),
      unitType: normalizeUnitType(item.unitType),
      discount: itemDiscountResult.value || 0,
      note: item.note || null,
    });
  }

  return normalizedItems;
};

const generateOfferItemId = () => generateItemId('coi-');

const buildItemsForInsert = (items: NormalizedOfferItem[]): clientOffersRepo.NewClientOfferItem[] =>
  items.map((item) => ({
    id: generateOfferItemId(),
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
  }));

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

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

      return offers.map((offer) => ({
        ...offer,
        items: itemsByOffer.get(offer.id) ?? [],
      }));
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
        return reply.code(404).send({ error: 'Source quote not found' });
      }
      if (sourceQuote.status !== 'accepted') {
        return reply.code(409).send({ error: 'Offers can only be created from accepted quotes' });
      }

      if (await clientOffersRepo.findExistingForQuote(linkedQuoteIdResult.value)) {
        return reply.code(409).send({ error: 'An offer already exists for this quote' });
      }

      const expirationDateResult = parseDateString(expirationDate, 'expirationDate');
      if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);
      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';

      const normalizedItems = normalizeItems(items as OfferItemInput[], reply);
      if (!normalizedItems) return;

      let result: {
        offer: clientOffersRepo.ClientOffer;
        items: clientOffersRepo.ClientOfferItem[];
      };
      try {
        result = await withTransaction(async (tx) => {
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
              status: typeof status === 'string' && status ? status : 'draft',
              expirationDate: expirationDateResult.value,
              notes: (notes as string | null | undefined) ?? null,
            },
            tx,
          );
          const createdItems = await clientOffersRepo.replaceItems(
            offer.id,
            buildItemsForInsert(normalizedItems),
            tx,
          );
          return { offer, items: createdItems };
        });
      } catch (err) {
        if (
          isUniqueViolation(err) &&
          (err.constraint === 'customer_offers_pkey' || err.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Offer ID already exists' });
        }
        throw err;
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
      return reply.code(201).send({ ...createdOffer, items: createdItems });
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
        expirationDate?: unknown;
        notes?: unknown;
      };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const existingOffer = await clientOffersRepo.findForUpdate(idResult.value);
      if (!existingOffer) {
        return reply.code(404).send({ error: 'Offer not found' });
      }

      const hasLockedFieldUpdates =
        clientId !== undefined ||
        clientName !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        discount !== undefined ||
        discountType !== undefined ||
        expirationDate !== undefined ||
        notes !== undefined;
      if (existingOffer.status !== 'draft' && hasLockedFieldUpdates) {
        return reply.code(409).send({
          error: 'Non-draft offers are read-only',
          currentStatus: existingOffer.status,
        });
      }

      let nextIdValue: string | undefined | null = nextId as string | undefined | null;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (nextIdResult.value) {
          if (await clientOffersRepo.findIdConflict(nextIdResult.value, idResult.value)) {
            return reply.code(409).send({ error: 'Offer ID already exists' });
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
          return reply.code(409).send({
            error: 'Quote-linked offer client details are read-only',
            fields: lockedFields,
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

      let normalizedItemsForUpdate: NormalizedOfferItem[] | null = null;
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        normalizedItemsForUpdate = normalizeItems(items as OfferItemInput[], reply);
        if (!normalizedItemsForUpdate) return;
      }

      let result: {
        offer: clientOffersRepo.ClientOffer | null;
        items: clientOffersRepo.ClientOfferItem[];
      };
      try {
        result = await withTransaction(async (tx) => {
          const offer = await clientOffersRepo.update(
            idResult.value,
            {
              id: (nextIdValue as string | null | undefined) ?? null,
              clientId: (clientIdValue as string | null | undefined) ?? null,
              clientName: (clientNameValue as string | null | undefined) ?? null,
              paymentTerms: (paymentTerms as string | null | undefined) ?? null,
              discount: (discountValue as number | null | undefined) ?? null,
              discountType: discountTypeValue ?? null,
              status: (status as string | null | undefined) ?? null,
              expirationDate: (expirationDateValue as string | null | undefined) ?? null,
              notes: (notes as string | null | undefined) ?? null,
            },
            tx,
          );
          if (!offer) return { offer: null, items: [] };
          const updatedItems = normalizedItemsForUpdate
            ? await clientOffersRepo.replaceItems(
                offer.id,
                buildItemsForInsert(normalizedItemsForUpdate),
                tx,
              )
            : await clientOffersRepo.findItemsForOffer(offer.id, tx);
          return { offer, items: updatedItems };
        });
      } catch (err) {
        if (
          isUniqueViolation(err) &&
          (err.constraint === 'customer_offers_pkey' || err.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Offer ID already exists' });
        }
        throw err;
      }

      const updatedOffer = result.offer;
      const updatedItems = result.items;
      if (!updatedOffer) {
        return reply.code(404).send({ error: 'Offer not found' });
      }

      const nextStatus = typeof status === 'string' ? status : updatedOffer.status;
      const didStatusChange = status !== undefined && existingOffer.status !== nextStatus;
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

      return { ...updatedOffer, items: updatedItems };
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
        return reply
          .code(409)
          .send({ error: 'Cannot delete an offer once a sale order has been created from it' });
      }

      const offer = await clientOffersRepo.findStatusAndClientName(idResult.value);
      if (!offer) {
        return reply.code(404).send({ error: 'Offer not found' });
      }
      if (offer.status !== 'draft') {
        return reply.code(409).send({ error: 'Only draft offers can be deleted' });
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
}
