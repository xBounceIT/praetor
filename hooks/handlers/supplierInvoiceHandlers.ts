import type React from 'react';
import api from '../../services/api';
import type { SupplierInvoice, SupplierSaleOrder, View } from '../../types';
import { addDaysToDateOnly, getLocalDateString } from '../../utils/date';
import { getDiscountedLineTotal } from '../../utils/numbers';
import { makeTempId } from '../../utils/tempId';
import { toastError } from '../../utils/toast';

export type SupplierInvoiceHandlersDeps = {
  setSupplierInvoices: React.Dispatch<React.SetStateAction<SupplierInvoice[]>>;
  setActiveView: React.Dispatch<React.SetStateAction<View | '404'>>;
};

export const makeSupplierInvoiceHandlers = (deps: SupplierInvoiceHandlersDeps) => {
  const { setSupplierInvoices, setActiveView } = deps;

  const update = async (id: string, updates: Partial<SupplierInvoice>) => {
    try {
      const updated = await api.supplierInvoices.update(id, updates);
      setSupplierInvoices((prev) => prev.map((invoice) => (invoice.id === id ? updated : invoice)));
    } catch (err) {
      console.error('Failed to update supplier invoice:', err);
      throw err;
    }
  };

  const remove = async (id: string) => {
    try {
      await api.supplierInvoices.delete(id);
      setSupplierInvoices((prev) => prev.filter((invoice) => invoice.id !== id));
    } catch (err) {
      console.error('Failed to delete supplier invoice:', err);
      throw err;
    }
  };

  const createFromOrder = async (order: SupplierSaleOrder) => {
    try {
      const paymentDays = Number.parseInt(order.paymentTerms?.replace(/\D/g, '') || '30', 10) || 30;
      const issueDate = getLocalDateString();
      const dueDate = addDaysToDateOnly(issueDate, paymentDays);
      const items = order.items.map((item) => ({
        id: makeTempId(),
        invoiceId: '',
        productId: item.productId,
        description: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount || 0,
        // Carry the order line's duration so the invoice total matches the order (issue #776/#775);
        // 'na' lines never multiply (effectiveDurationMonths returns 1).
        durationMonths: item.durationMonths ?? 1,
        durationUnit: item.durationUnit ?? 'months',
      }));
      const totals = items.reduce(
        (acc, item) => {
          acc.subtotal += getDiscountedLineTotal(item);
          return acc;
        },
        { subtotal: 0 },
      );
      const invoice = await api.supplierInvoices.create({
        linkedSaleId: order.id,
        supplierId: order.supplierId,
        supplierName: order.supplierName,
        issueDate,
        dueDate,
        status: 'draft',
        subtotal: totals.subtotal,
        total: totals.subtotal,
        amountPaid: 0,
        notes: order.notes,
        items,
      });
      setSupplierInvoices((prev) => [invoice, ...prev]);
      setActiveView('accounting/supplier-invoices');
    } catch (err) {
      console.error('Failed to create supplier invoice from order:', err);
      toastError(
        err instanceof Error && err.message
          ? err.message
          : 'Failed to create supplier invoice from order',
      );
    }
  };

  return { update, delete: remove, createFromOrder };
};
