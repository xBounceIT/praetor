import type { FastifyRequest } from 'fastify';
import type { DbExecutor } from '../db/drizzle.ts';
import * as clientsOrdersRepo from '../repositories/clientsOrdersRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import { logAudit } from '../utils/audit.ts';
import {
  generateClientOrderId,
  generatePrefixedId,
  generateSupplierOrderId,
  ITEM_ID_PREFIXES,
} from '../utils/order-ids.ts';
import { effectiveSupplierQuoteStatusFromDate } from '../utils/quote-status.ts';

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

export const createClientOrderRows = async (
  fields: ClientOrderCreateFields,
  items: clientsOrdersRepo.NewClientOrderItem[],
  tx: DbExecutor,
): Promise<{
  order: clientsOrdersRepo.ClientOrder;
  items: clientsOrdersRepo.ClientOrderItem[];
}> => {
  const orderId = fields.id || (await generateClientOrderId(tx));
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
): Promise<{ items: clientsOrdersRepo.ClientOrderItem[]; warnings: string[] }> => {
  const supplierQuoteIds = [
    ...new Set(
      items
        .map((item) => item.supplierQuoteId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  const warnings: string[] = [];
  let didAutoCreate = false;

  for (const sqId of supplierQuoteIds) {
    try {
      // Cheap fast-fail outside any tx: skip if the quote isn't accepted or already has a
      // linked order. The authoritative decision is repeated inside the tx below under a row lock.
      const [fastFailQuote, fastFailLinked] = await Promise.all([
        supplierQuotesRepo.findById(sqId),
        supplierQuotesRepo.findLinkedOrderId(sqId),
      ]);
      if (!fastFailQuote) {
        warnings.push(`Supplier order not created: supplier quote ${sqId} no longer exists`);
        continue;
      }
      const fastFailStatus = effectiveSupplierQuoteStatusFromDate({
        expirationDate: fastFailQuote.expirationDate,
        linkedClientStatus: fastFailQuote.linkedClientQuoteStatus,
        linkedClientQuoteExpiration: fastFailQuote.linkedClientQuoteExpiration,
        linkedOfferStatus: fastFailQuote.linkedOfferStatus,
        linkedOfferExpiration: fastFailQuote.linkedOfferExpiration,
      });
      if (fastFailStatus !== 'accepted') {
        warnings.push(
          `Supplier order not created for supplier quote ${sqId}: its status is '${fastFailStatus}', not 'accepted' (only the supplier quote linked to the accepted client document follows its status)`,
        );
        continue;
      }
      if (fastFailLinked) continue;

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
        )
          return false;
        const linkedUnderLock = await supplierQuotesRepo.findLinkedOrderId(sqId, tx);
        if (linkedUnderLock) return false;
        const supplierQuote = await supplierQuotesRepo.findById(sqId, tx);
        if (!supplierQuote) return false;
        const supplierItems = await supplierQuotesRepo.findItemsForQuote(sqId, tx);
        const supplierOrderId = await generateSupplierOrderId(tx);
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

        await clientsOrdersRepo.bulkInsertSupplierOrderItems(
          supplierOrderId,
          supplierItemRecords,
          tx,
        );

        await clientsOrdersRepo.linkSaleItemsToSupplierOrder(
          {
            orderId: order.id,
            supplierQuoteId: sqId,
            supplierOrderId,
            supplierName: supplierQuote.supplierName,
          },
          tx,
        );

        await clientsOrdersRepo.mapSaleItemsToSupplierItems(
          {
            orderId: order.id,
            supplierQuoteId: sqId,
            mappings: insertedSupplierItemIds,
          },
          tx,
        );

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
        return true;
      });
      if (autoCreated) didAutoCreate = true;
    } catch (err) {
      request.log.error({ err, supplierQuoteId: sqId }, 'Failed to auto-create supplier order');
      warnings.push(`Failed to auto-create supplier order for quote ${sqId}`);
    }
  }

  return {
    items: didAutoCreate ? await clientsOrdersRepo.findItemsForOrder(order.id) : items,
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
