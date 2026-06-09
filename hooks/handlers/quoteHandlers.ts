import type React from 'react';
import api from '../../services/api';
import type { ClientOffer, ClientsOrder, Invoice, Quote, View } from '../../types';
import { makeTempId } from '../../utils/tempId';
import { toastError } from '../../utils/toast';

/**
 * Quote handlers read two pieces of shared state — `clientQuoteFilterId` and
 * `clientOfferFilterId` — both before and AFTER awaited network calls.
 * Capturing those values from the deps closure would
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
  getClientQuoteFilterId: () => string | null;
  getClientOfferFilterId: () => string | null;
  // Read BEFORE awaited writes: whether a quote carried a supplier link decides if the
  // supplier-quotes cache must refresh after an update/unlink/delete.
  getQuotes: () => Quote[];
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
    getClientQuoteFilterId,
    getClientOfferFilterId,
    getQuotes,
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

  // A linked supplier quote derives its visible status / isStatusSynced from its client quote at
  // read time (#779), so creating, changing, or severing that link — or changing the client
  // quote's status — can leave the separately-cached supplier quotes table showing stale
  // unsynced/draft state until a full module reload. Refresh it too, best-effort: a refresh
  // failure must not fail the primary write.
  const refreshLinkedSupplierQuotes = async () => {
    try {
      await refreshSupplierQuoteFlow();
    } catch (refreshErr) {
      console.error('Failed to refresh supplier data:', refreshErr);
    }
  };

  const addQuote = async (quoteData: Partial<Quote>) => {
    try {
      const quote = await api.quotes.create(quoteData);
      setQuotes((prev) => [quote, ...prev]);
      if (quote.linkedSupplierQuoteId) {
        await refreshLinkedSupplierQuotes();
      }
    } catch (err) {
      console.error('Failed to add quote:', err);
      throw err;
    }
  };

  const updateQuote = async (id: string, updates: Partial<Quote>) => {
    try {
      // Captured before the await: after an unlink the response carries null, indistinguishable
      // from never-linked — yet the previously linked supplier quote just became un-synced.
      const wasLinked = getQuotes().some((q) => q.id === id && q.linkedSupplierQuoteId != null);
      const updated = await api.quotes.update(id, updates);
      // Re-read the filter via the getter so we observe the latest value, not
      // the one captured when this handler was created. Navigation effects in
      // App.tsx can clear the filter while the API call is in flight.
      if (getClientQuoteFilterId() === id) {
        setClientQuoteFilterId(updated.id);
      }
      // Only a quote that is (or was) linked can stale the supplier-quotes cache — its visible
      // status is derived from this client quote at read time (#779). Gating on the LINK rather
      // than the request fields matters: the edit form spreads formData, so `updates.status` is
      // defined on every save and would refetch for plain edits of unlinked quotes. The two
      // flows set disjoint state, so they run in parallel.
      const supplierRefreshNeeded = updated.linkedSupplierQuoteId != null || wasLinked;
      await Promise.all([
        refreshClientQuoteFlow(),
        supplierRefreshNeeded ? refreshLinkedSupplierQuotes() : Promise.resolve(),
      ]);
    } catch (err) {
      console.error('Failed to update quote:', err);
      throw err;
    }
  };

  const deleteQuote = async (id: string) => {
    try {
      // Read before the awaits — after the delete the quote is gone from state. Deleting a
      // linked client quote un-syncs its supplier quote server-side (the reverse-lookup row
      // vanishes), the same staleness class the update path refreshes for.
      const wasLinked = getQuotes().some((q) => q.id === id && q.linkedSupplierQuoteId != null);
      await api.quotes.delete(id);
      setQuotes((prev) => prev.filter((q) => q.id !== id));
      if (wasLinked) {
        await refreshLinkedSupplierQuotes();
      }
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

  const revertClientOfferToDraft = async (id: string, reason?: string) => {
    try {
      const updated = await api.clientOffers.revertToDraft(id, reason);
      if (getClientOfferFilterId() === id) {
        setClientOfferFilterId(updated.id);
      }
      await refreshClientQuoteFlow();
    } catch (err) {
      console.error('Failed to revert client offer to draft:', err);
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
      // Order creation can auto-create supplier orders and consume supplier quotes.
      await refreshLinkedSupplierQuotes();
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
    revertClientOfferToDraft,
    deleteClientOffer,
    createClientOfferFromQuote,
    updateClientsOrder,
    deleteClientsOrder,
    createClientsOrderFromOffer,
  };
};
