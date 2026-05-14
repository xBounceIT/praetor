import type React from 'react';
import api from '../../services/api';
import type { ClientOffer, ClientsOrder, Invoice, Quote, View } from '../../types';
import { getLocalDateString } from '../../utils/date';
import { makeTempId } from '../../utils/tempId';
import { toastError } from '../../utils/toast';

/**
 * Quote handlers read three pieces of shared state — `quotes`,
 * `clientQuoteFilterId`, and `clientOfferFilterId` — both before and AFTER
 * awaited network calls. Capturing those values from the deps closure would
 * surface a stale-closure bug: the handler factory is created with the values
 * at the time of the surrounding `useMemo` render, but an awaited API call can
 * outlive that render. While the await is pending the user can navigate or
 * toggle a filter, which mutates the underlying state. Reading the captured
 * value after the await would then act on out-of-date data (for example, the
 * `clientQuoteFilterId === id` branch could re-apply a filter the user just
 * cleared).
 *
 * To keep the reads fresh while still allowing the factory to be memoized,
 * callers pass getter functions instead of raw values. The getters close over
 * the latest React state via refs in `App.tsx`, so calls inside the handlers
 * always see the current value — even across awaits.
 */
export type QuoteHandlersDeps = {
  getQuotes: () => Quote[];
  getClientQuoteFilterId: () => string | null;
  getClientOfferFilterId: () => string | null;
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  setClientOffers: React.Dispatch<React.SetStateAction<ClientOffer[]>>;
  setClientsOrders: React.Dispatch<React.SetStateAction<ClientsOrder[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  setClientQuoteFilterId: React.Dispatch<React.SetStateAction<string | null>>;
  setClientOfferFilterId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveView: React.Dispatch<React.SetStateAction<View | '404'>>;
  refreshSupplierQuoteFlow: () => Promise<void>;
};

export const makeQuoteHandlers = (deps: QuoteHandlersDeps) => {
  const {
    getQuotes,
    getClientQuoteFilterId,
    getClientOfferFilterId,
    setQuotes,
    setClientOffers,
    setClientsOrders,
    setInvoices,
    setClientQuoteFilterId,
    setClientOfferFilterId,
    setActiveView,
    refreshSupplierQuoteFlow,
  } = deps;

  const refreshClientQuoteFlow = async () => {
    const [quotesData, offersData, ordersData] = await Promise.all([
      api.quotes.list(),
      api.clientOffers.list(),
      api.clientsOrders.list(),
    ]);
    setQuotes(quotesData);
    setClientOffers(offersData);
    setClientsOrders(ordersData);
  };

  const refreshClientOrderFlow = async () => {
    const [ordersData, invoicesData] = await Promise.all([
      api.clientsOrders.list(),
      api.invoices.list(),
    ]);
    setClientsOrders(ordersData);
    setInvoices(invoicesData);
  };

  const addQuote = async (quoteData: Partial<Quote>) => {
    try {
      const quote = await api.quotes.create(quoteData);
      setQuotes((prev) => [quote, ...prev]);
    } catch (err) {
      console.error('Failed to add quote:', err);
      throw err;
    }
  };

  const updateQuote = async (id: string, updates: Partial<Quote>) => {
    try {
      const currentQuote = getQuotes().find((quote) => quote.id === id);
      const isRestore = Boolean(
        updates.status === 'draft' &&
          updates.isExpired === false &&
          currentQuote &&
          (currentQuote.status !== 'draft' || currentQuote.isExpired),
      );
      const updatesWithRestore = isRestore
        ? { ...updates, expirationDate: getLocalDateString() }
        : updates;

      const updated = await api.quotes.update(id, updatesWithRestore);
      // Re-read the filter via the getter so we observe the latest value, not
      // the one captured when this handler was created. Navigation effects in
      // App.tsx can clear the filter while the API call is in flight.
      if (getClientQuoteFilterId() === id) {
        setClientQuoteFilterId(updated.id);
      }
      await refreshClientQuoteFlow();
    } catch (err) {
      console.error('Failed to update quote:', err);
      throw err;
    }
  };

  const deleteQuote = async (id: string) => {
    try {
      await api.quotes.delete(id);
      setQuotes((prev) => prev.filter((q) => q.id !== id));
    } catch (err) {
      console.error('Failed to delete quote:', err);
      throw err;
    }
  };

  const updateClientOffer = async (id: string, updates: Partial<ClientOffer>) => {
    try {
      const updated = await api.clientOffers.update(id, updates);
      // Same reasoning as in updateQuote: read the filter freshly so a
      // mid-flight navigation/clear is respected.
      if (getClientOfferFilterId() === id) {
        setClientOfferFilterId(updated.id);
      }
      await refreshClientQuoteFlow();
    } catch (err) {
      console.error('Failed to update client offer:', err);
      throw err;
    }
  };

  const deleteClientOffer = async (id: string) => {
    try {
      await api.clientOffers.delete(id);
      setClientOffers((prev) => prev.filter((offer) => offer.id !== id));
      setQuotes((prev) =>
        prev.map((quote) =>
          quote.linkedOfferId === id ? { ...quote, linkedOfferId: undefined } : quote,
        ),
      );
    } catch (err) {
      console.error('Failed to delete client offer:', err);
      throw err;
    }
  };

  const createClientOfferFromQuote = async (quote: Quote) => {
    try {
      const offer = await api.clientOffers.create({
        id: `${quote.id}-OF`,
        linkedQuoteId: quote.id,
        clientId: quote.clientId,
        clientName: quote.clientName,
        paymentTerms: quote.paymentTerms,
        discount: quote.discount,
        status: 'draft',
        expirationDate: quote.expirationDate,
        notes: quote.notes,
        items: quote.items.map((item) => ({
          ...item,
          id: makeTempId(),
          offerId: '',
        })),
      });
      setClientOffers((prev) => [offer, ...prev]);
      setQuotes((prev) =>
        prev.map((entry) =>
          entry.id === quote.id ? { ...entry, linkedOfferId: offer.id } : entry,
        ),
      );
      setActiveView('sales/client-offers');
    } catch (err) {
      console.error('Failed to create offer from quote:', err);
      toastError((err as Error).message || 'Failed to create offer from quote');
    }
  };

  const updateClientsOrder = async (id: string, updates: Partial<ClientsOrder>) => {
    try {
      await api.clientsOrders.update(id, updates);
      await refreshClientOrderFlow();
    } catch (err) {
      console.error('Failed to update order:', err);
      throw err;
    }
  };

  const deleteClientsOrder = async (id: string) => {
    try {
      await api.clientsOrders.delete(id);
      setClientsOrders((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      console.error('Failed to delete order:', err);
      throw err;
    }
  };

  const createClientsOrderFromOffer = async (offer: ClientOffer) => {
    try {
      const orderData: Partial<ClientsOrder> = {
        clientId: offer.clientId,
        clientName: offer.clientName,
        status: 'draft',
        linkedQuoteId: offer.linkedQuoteId,
        linkedOfferId: offer.id,
        paymentTerms: offer.paymentTerms,
        items: offer.items.map((item) => ({
          ...item,
          id: makeTempId(),
          orderId: '',
        })),
        discount: offer.discount,
        notes: offer.notes,
      };

      const order = await api.clientsOrders.create(orderData);
      setClientsOrders((prev) => [...prev, order]);
      setActiveView('accounting/clients-orders');
      try {
        await refreshSupplierQuoteFlow();
      } catch (refreshErr) {
        console.error('Failed to refresh supplier data:', refreshErr);
      }
    } catch (err) {
      console.error('Failed to create order from offer:', err);
      toastError((err as Error).message || 'Failed to create order from offer');
    }
  };

  return {
    refreshClientQuoteFlow,
    refreshClientOrderFlow,
    addQuote,
    updateQuote,
    deleteQuote,
    updateClientOffer,
    deleteClientOffer,
    createClientOfferFromQuote,
    updateClientsOrder,
    deleteClientsOrder,
    createClientsOrderFromOffer,
  };
};
