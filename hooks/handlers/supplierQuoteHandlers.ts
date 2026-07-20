import type React from 'react';
import api from '../../services/api';
import type {
  SupplierInvoice,
  SupplierQuote,
  SupplierQuoteItem,
  SupplierSaleOrder,
  View,
} from '../../types';
import { roundCurrency, roundToDecimalPlaces } from '../../utils/numbers';
import { makeTempId } from '../../utils/tempId';
import { toastError } from '../../utils/toast';

const toSupplierOrderLinePricing = (
  item: SupplierQuoteItem,
): { unitPrice: number; discount: number } => {
  const authoritativeUnitPrice = roundToDecimalPlaces(Number(item.unitPrice) || 0, 6);
  const listPrice = roundCurrency(Number(item.listPrice ?? authoritativeUnitPrice) || 0);
  const discount = roundCurrency(Number(item.discountPercent) || 0);
  const derivedUnitPrice = roundToDecimalPlaces(listPrice * (1 - discount / 100), 6);

  return derivedUnitPrice === authoritativeUnitPrice
    ? { unitPrice: listPrice, discount }
    : { unitPrice: roundCurrency(authoritativeUnitPrice), discount: 0 };
};

/**
 * Supplier-quote handlers read `supplierQuoteFilterId` both before and AFTER
 * awaited network calls. Capturing the raw value via the deps closure would
 * surface a stale-closure bug: the handler factory is memoized with the value
 * at the time of the surrounding `useMemo` render, but an awaited API call can
 * outlive that render. While the await is pending the user can navigate or
 * clear the filter, which mutates the underlying state. Reading the captured
 * value after the await would then act on out-of-date data (for example, the
 * `supplierQuoteFilterId === id` branch could re-apply a filter the user just
 * cleared). Callers pass a getter that closes over the latest React state via
 * a ref in `App.tsx`, so reads inside the handler always see the current value
 * — even across awaits. See `quoteHandlers.ts` for the canonical example.
 */
export type SupplierQuoteHandlersDeps = {
  getSupplierQuoteFilterId: () => string | null;
  setSupplierQuotes: React.Dispatch<React.SetStateAction<SupplierQuote[]>>;
  setSupplierOrders: React.Dispatch<React.SetStateAction<SupplierSaleOrder[]>>;
  setSupplierInvoices: React.Dispatch<React.SetStateAction<SupplierInvoice[]>>;
  setSupplierQuoteFilterId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveView: React.Dispatch<React.SetStateAction<View | '404'>>;
};

export const makeSupplierQuoteHandlers = (deps: SupplierQuoteHandlersDeps) => {
  const {
    getSupplierQuoteFilterId,
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

  // Returns the created quote so the caller can act on its server id — the supplier-quote
  // modal flushes any files staged during creation to /attachments once the id exists.
  const addSupplierQuote = async (quoteData: Partial<SupplierQuote>): Promise<SupplierQuote> => {
    try {
      const quote = await api.supplierQuotes.create(quoteData);
      setSupplierQuotes((prev) => [...prev, quote]);
      return quote;
    } catch (err) {
      console.error('Failed to add supplier quote:', err);
      throw err;
    }
  };

  const updateSupplierQuote = async (id: string, updates: Partial<SupplierQuote>) => {
    try {
      const updated = await api.supplierQuotes.update(id, updates);
      // Re-read the filter via the getter so we observe the latest value, not
      // the one captured when this handler was created. A navigation effect in
      // App.tsx can clear the filter while the API call is in flight.
      if (getSupplierQuoteFilterId() === id) {
        setSupplierQuoteFilterId(updated.id);
      }
      await refreshSupplierQuoteFlow();
    } catch (err) {
      console.error('Failed to update supplier quote:', err);
      throw err;
    }
  };

  const deleteSupplierQuote = async (id: string) => {
    try {
      await api.supplierQuotes.delete(id);
      setSupplierQuotes((prev) => prev.filter((q) => q.id !== id));
    } catch (err) {
      console.error('Failed to delete supplier quote:', err);
      throw err;
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
        items: quote.items.map((item) => {
          const pricing = toSupplierOrderLinePricing(item);
          return {
            ...item,
            id: makeTempId(),
            orderId: '',
            // Keep the gross/discount chain when it reproduces the quote cost. An explicit synced
            // override is flattened so the order preserves the authoritative net total.
            unitPrice: pricing.unitPrice,
            discount: pricing.discount,
            // Free-text supplier lines without a linked product are valid;
            // the server canonicalizes missing productId to NULL.
            productId: item.productId ?? '',
          };
        }),
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
      toastError((err as Error).message || 'Failed to create supplier order from quote');
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
