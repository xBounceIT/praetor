import type React from 'react';
import api from '../../services/api';
import type { SupplierInvoice, SupplierSaleOrder, View } from '../../types';
import { addDaysToDateOnly, getLocalDateString } from '../../utils/date';
import { getDiscountedDocumentTotal } from '../../utils/numbers';
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
        // The API replaces this id with a new invoice-item id; retain the source id in the
        // request so it can preserve each order line's historical pricing marker.
        id: item.id,
        invoiceId: '',
        productId: item.productId,
        description: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount || 0,
        legacyDiscountRounding: item.legacyDiscountRounding === true,
        // Carry the order line's duration so the invoice total matches the order (issue #776/#775);
        // pricing uses the displayed numeric value and 'na' lines use the neutral multiplier 1.
        durationMonths: item.durationMonths ?? 1,
        durationUnit: item.durationUnit ?? 'months',
        pricingSemanticsVersion: item.pricingSemanticsVersion,
      }));
      const subtotal = getDiscountedDocumentTotal(items);
      const invoice = await api.supplierInvoices.create({
        linkedSaleId: order.id,
        supplierId: order.supplierId,
        supplierName: order.supplierName,
        issueDate,
        dueDate,
        status: 'draft',
        subtotal,
        total: subtotal,
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
