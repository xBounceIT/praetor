import type { FastifyRequest } from 'fastify';
import type { DbExecutor } from '../db/drizzle.ts';
import * as clientsOrdersRepo from '../repositories/clientsOrdersRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import { logAudit } from '../utils/audit.ts';
import { generatePrefixedId, ITEM_ID_PREFIXES } from '../utils/order-ids.ts';
import { effectiveSupplierQuoteStatusFromDate } from '../utils/quote-status.ts';
import {
  allocateDocumentCode,
  compactDocumentCodeSources,
  DocumentCodeCollisionError,
  reserveDocumentCodeCounterFromCode,
} from './documentCodes.ts';

export type ClientOrderCreateFields = {
  id?: string | null;
  linkedQuoteId: string | null;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  notes: string | null;
};

export type CreatedSupplierOrderSummary = {
  id: string;
  supplierQuoteId: string;
  supplierName: string;
};

export const createClientOrderRows = async (
  fields: ClientOrderCreateFields,
  items: clientsOrdersRepo.NewClientOrderItem[],
  tx: DbExecutor,
): Promise<{
  order: clientsOrdersRepo.ClientOrder;
  items: clientsOrdersRepo.ClientOrderItem[];
}> => {
  const sourceCodes = compactDocumentCodeSources(fields.linkedQuoteId, fields.linkedOfferId);
  let orderId: string;
  if (fields.id) {
    await reserveDocumentCodeCounterFromCode('client_order', fields.id, tx);
    orderId = fields.id;
  } else {
    orderId = await allocateDocumentCode('client_order', {
      exec: tx,
      ...(sourceCodes.length ? { sourceCodes } : {}),
    });
  }
  const order = await clientsOrdersRepo.create(
    {
      id: orderId,
      linkedQuoteId: fields.linkedQuoteId,
      linkedOfferId: fields.linkedOfferId,
      clientId: fields.clientId,
      clientName: fields.clientName,
      paymentTerms: fields.paymentTerms,
      discount: fields.discount,
      discountType: fields.discountType,
      status: fields.status,
      notes: fields.notes,
    },
    tx,
  );
  return { order, items: await clientsOrdersRepo.insertItems(order.id, items, tx) };
};

export const autoCreateSupplierOrdersForClientOrder = async (
  request: FastifyRequest,
  order: clientsOrdersRepo.ClientOrder,
  items: clientsOrdersRepo.ClientOrderItem[],
  runInTransaction: <T>(cb: (tx: DbExecutor) => Promise<T>) => Promise<T>,
): Promise<{
  items: clientsOrdersRepo.ClientOrderItem[];
  supplierOrders: CreatedSupplierOrderSummary[];
  warnings: string[];
}> => {
  const supplierQuoteIds = [
    ...new Set(
      items
        .map((item) => item.supplierQuoteId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  const supplierOrderOutcomes = await Promise.all(
    supplierQuoteIds.map(
      async (
        sqId,
      ): Promise<{
        supplierOrder?: CreatedSupplierOrderSummary;
        warning?: string;
      }> => {
        try {
          // Cheap fast-fail outside any tx: skip if the quote isn't accepted or already has a
          // linked order. The authoritative decision is repeated inside the tx below under a row lock.
          const [fastFailQuote, fastFailLinked] = await Promise.all([
            supplierQuotesRepo.findById(sqId),
            supplierQuotesRepo.findLinkedOrderId(sqId),
          ]);
          if (!fastFailQuote) {
            return {
              warning: `Supplier order not created: supplier quote ${sqId} no longer exists`,
            };
          }
          const fastFailStatus = effectiveSupplierQuoteStatusFromDate({
            expirationDate: fastFailQuote.expirationDate,
            linkedClientStatus: fastFailQuote.linkedClientQuoteStatus,
            linkedClientQuoteExpiration: fastFailQuote.linkedClientQuoteExpiration,
            linkedOfferStatus: fastFailQuote.linkedOfferStatus,
            linkedOfferExpiration: fastFailQuote.linkedOfferExpiration,
          });
          if (fastFailStatus !== 'accepted') {
            return {
              warning: `Supplier order not created for supplier quote ${sqId}: its status is '${fastFailStatus}', not 'accepted' (only the supplier quote linked to the accepted client document follows its status)`,
            };
          }
          if (fastFailLinked) return {};

          const autoCreated = await runInTransaction(async (tx) => {
            const lockedStatus = await supplierQuotesRepo.lockEffectiveStatusById(sqId, tx);
            if (
              !lockedStatus ||
              effectiveSupplierQuoteStatusFromDate({
                expirationDate: lockedStatus.expirationDate,
                linkedClientStatus: lockedStatus.linkedClientStatus,
                linkedClientQuoteExpiration: lockedStatus.linkedClientQuoteExpiration,
                linkedOfferStatus: lockedStatus.linkedOfferStatus,
                linkedOfferExpiration: lockedStatus.linkedOfferExpiration,
              }) !== 'accepted'
            ) {
              return null;
            }
            const linkedUnderLock = await supplierQuotesRepo.findLinkedOrderId(sqId, tx);
            if (linkedUnderLock) return null;
            const supplierQuote = await supplierQuotesRepo.findById(sqId, tx);
            if (!supplierQuote) return null;
            const [supplierItems, supplierOrderId] = await Promise.all([
              supplierQuotesRepo.findItemsForQuote(sqId, tx),
              allocateDocumentCode('supplier_order', {
                exec: tx,
                sourceCode: sqId,
              }),
            ]);
            await clientsOrdersRepo.createSupplierOrder(
              {
                id: supplierOrderId,
                linkedQuoteId: sqId,
                supplierId: supplierQuote.supplierId,
                supplierName: supplierQuote.supplierName,
                paymentTerms: supplierQuote.paymentTerms || 'immediate',
                notes: supplierQuote.notes,
              },
              tx,
            );

            const insertedSupplierItemIds: { quoteItemId: string; saleItemId: string }[] = [];
            const supplierItemRecords = supplierItems.map((item) => {
              const saleItemId = generatePrefixedId(ITEM_ID_PREFIXES.supplierItem);
              insertedSupplierItemIds.push({ quoteItemId: item.id, saleItemId });
              return {
                id: saleItemId,
                productId: item.productId,
                productName: item.productName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                note: item.note,
                durationMonths: item.durationMonths,
                durationUnit: item.durationUnit,
              };
            });

            await Promise.all([
              clientsOrdersRepo.bulkInsertSupplierOrderItems(
                supplierOrderId,
                supplierItemRecords,
                tx,
              ),
              clientsOrdersRepo.linkSaleItemsToSupplierOrderAndItems(
                {
                  orderId: order.id,
                  supplierQuoteId: sqId,
                  supplierOrderId,
                  supplierName: supplierQuote.supplierName,
                  mappings: insertedSupplierItemIds,
                },
                tx,
              ),
            ]);

            await logAudit({
              request,
              action: 'supplier_order.auto_created',
              entityType: 'supplier_order',
              entityId: supplierOrderId,
              details: {
                targetLabel: supplierOrderId,
                secondaryLabel: `${supplierQuote.supplierName} (from client order ${order.id}, supplier quote ${sqId})`,
              },
            });
            return {
              id: supplierOrderId,
              supplierQuoteId: sqId,
              supplierName: supplierQuote.supplierName,
            };
          });
          return autoCreated ? { supplierOrder: autoCreated } : {};
        } catch (err) {
          if (err instanceof DocumentCodeCollisionError) {
            request.log.warn(
              { err, supplierQuoteId: sqId },
              'Supplier order auto-create skipped after document code collision',
            );
            return {
              warning: `Supplier order not created for supplier quote ${sqId}: unable to allocate a unique supplier order code`,
            };
          }
          request.log.error({ err, supplierQuoteId: sqId }, 'Failed to auto-create supplier order');
          return { warning: `Failed to auto-create supplier order for quote ${sqId}` };
        }
      },
    ),
  );
  const supplierOrders = supplierOrderOutcomes.flatMap((outcome) =>
    outcome.supplierOrder ? [outcome.supplierOrder] : [],
  );
  const warnings = supplierOrderOutcomes.flatMap((outcome) =>
    outcome.warning ? [outcome.warning] : [],
  );

  return {
    items: supplierOrders.length > 0 ? await clientsOrdersRepo.findItemsForOrder(order.id) : items,
    supplierOrders,
    warnings,
  };
};

export const logClientOrderCreated = async (
  request: FastifyRequest,
  order: clientsOrdersRepo.ClientOrder,
): Promise<void> => {
  await logAudit({
    request,
    action: 'client_order.created',
    entityType: 'client_order',
    entityId: order.id,
    details: {
      targetLabel: order.id,
      secondaryLabel: order.clientName,
    },
  });
};
