import type React from 'react';
import api from '../../services/api';
import type { SupplierInvoice, SupplierQuote, SupplierSaleOrder, View } from '../../types';
import { makeTempId } from '../../utils/tempId';

export type SupplierQuoteHandlersDeps = {
  supplierQuoteFilterId: string | null;
  setSupplierQuotes: React.Dispatch<React.SetStateAction<SupplierQuote[]>>;
  setSupplierOrders: React.Dispatch<React.SetStateAction<SupplierSaleOrder[]>>;
  setSupplierInvoices: React.Dispatch<React.SetStateAction<SupplierInvoice[]>>;
  setSupplierQuoteFilterId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveView: React.Dispatch<React.SetStateAction<View | '404'>>;
};

export const makeSupplierQuoteHandlers = (deps: SupplierQuoteHandlersDeps) => {
  const {
    supplierQuoteFilterId,
    setSupplierQuotes,
    setSupplierOrders,
    setSupplierInvoices,
    setSupplierQuoteFilterId,
    setActiveView,
  } = deps;

  const refreshSupplierQuoteFlow = async () => {
    const [quotesData, ordersData] = await Promise.all([
      api.supplierQuotes.list(),
      api.supplierOrders.list(),
    ]);
    setSupplierQuotes(quotesData);
    setSupplierOrders(ordersData);
  };

  const refreshSupplierOrderFlow = async () => {
    const [ordersData, invoicesData] = await Promise.all([
      api.supplierOrders.list(),
      api.supplierInvoices.list(),
    ]);
    setSupplierOrders(ordersData);
    setSupplierInvoices(invoicesData);
  };

  const addSupplierQuote = async (quoteData: Partial<SupplierQuote>) => {
    try {
      const quote = await api.supplierQuotes.create(quoteData);
      setSupplierQuotes((prev) => [...prev, quote]);
    } catch (err) {
      console.error('Failed to add supplier quote:', err);
    }
  };

  const updateSupplierQuote = async (id: string, updates: Partial<SupplierQuote>) => {
    try {
      const updated = await api.supplierQuotes.update(id, updates);
      if (supplierQuoteFilterId === id) {
        setSupplierQuoteFilterId(updated.id);
      }
      await refreshSupplierQuoteFlow();
    } catch (err) {
      console.error('Failed to update supplier quote:', err);
    }
  };

  const deleteSupplierQuote = async (id: string) => {
    try {
      await api.supplierQuotes.delete(id);
      setSupplierQuotes((prev) => prev.filter((q) => q.id !== id));
    } catch (err) {
      console.error('Failed to delete supplier quote:', err);
    }
  };

  const updateSupplierOrder = async (id: string, updates: Partial<SupplierSaleOrder>) => {
    try {
      await api.supplierOrders.update(id, updates);
      await refreshSupplierOrderFlow();
    } catch (err) {
      console.error('Failed to update supplier order:', err);
      throw err;
    }
  };

  const deleteSupplierOrder = async (id: string) => {
    try {
      await api.supplierOrders.delete(id);
      setSupplierOrders((prev) => prev.filter((order) => order.id !== id));
    } catch (err) {
      console.error('Failed to delete supplier order:', err);
      throw err;
    }
  };

  const createSupplierOrderFromQuote = async (quote: SupplierQuote) => {
    try {
      await api.supplierOrders.create({
        linkedQuoteId: quote.id,
        supplierId: quote.supplierId,
        supplierName: quote.supplierName,
        paymentTerms: quote.paymentTerms,
        status: 'draft',
        notes: quote.notes,
        items: quote.items.map((item) => ({
          ...item,
          id: makeTempId(),
          orderId: '',
          productId: item.productId ?? '',
        })),
      });
      setSupplierQuoteFilterId(quote.id);
      setActiveView('accounting/supplier-orders');
      try {
        await refreshSupplierQuoteFlow();
      } catch (refreshErr) {
        console.error('Failed to refresh supplier data:', refreshErr);
      }
    } catch (err) {
      console.error('Failed to create supplier order from quote:', err);
      alert((err as Error).message || 'Failed to create supplier order from quote');
    }
  };

  return {
    refreshSupplierQuoteFlow,
    refreshSupplierOrderFlow,
    addSupplierQuote,
    updateSupplierQuote,
    deleteSupplierQuote,
    updateSupplierOrder,
    deleteSupplierOrder,
    createSupplierOrderFromQuote,
  };
};
