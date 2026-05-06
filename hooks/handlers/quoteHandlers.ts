import type React from 'react';
import api from '../../services/api';
import type { ClientOffer, ClientsOrder, Invoice, Quote, View } from '../../types';
import { getLocalDateString } from '../../utils/date';
import { makeTempId } from '../../utils/tempId';

export type QuoteHandlersDeps = {
  quotes: Quote[];
  clientQuoteFilterId: string | null;
  clientOfferFilterId: string | null;
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
    quotes,
    clientQuoteFilterId,
    clientOfferFilterId,
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
    }
  };

  const updateQuote = async (id: string, updates: Partial<Quote>) => {
    try {
      const currentQuote = quotes.find((quote) => quote.id === id);
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
      if (clientQuoteFilterId === id) {
        setClientQuoteFilterId(updated.id);
      }
      await refreshClientQuoteFlow();
    } catch (err) {
      console.error('Failed to update quote:', err);
    }
  };

  const deleteQuote = async (id: string) => {
    try {
      await api.quotes.delete(id);
      setQuotes((prev) => prev.filter((q) => q.id !== id));
    } catch (err) {
      console.error('Failed to delete quote:', err);
    }
  };

  const updateClientOffer = async (id: string, updates: Partial<ClientOffer>) => {
    try {
      const updated = await api.clientOffers.update(id, updates);
      if (clientOfferFilterId === id) {
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
      await refreshClientQuoteFlow();
    } catch (err) {
      console.error('Failed to delete client offer:', err);
      throw err;
    }
  };

  const createClientOfferFromQuote = async (quote: Quote) => {
    try {
      const offer = await api.clientOffers.create({
        offerCode: `${quote.id}-OF`,
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
      alert((err as Error).message || 'Failed to create offer from quote');
    }
  };

  const createClientOfferVersion = async (id: string) => {
    try {
      const offer = await api.clientOffers.createVersion(id);
      await refreshClientQuoteFlow();
      setClientOfferFilterId(offer.id);
      setActiveView('sales/client-offers');
    } catch (err) {
      console.error('Failed to create client offer version:', err);
      alert((err as Error).message || 'Failed to create client offer version');
      throw err;
    }
  };

  const updateClientsOrder = async (id: string, updates: Partial<ClientsOrder>) => {
    try {
      await api.clientsOrders.update(id, updates);
      await refreshClientOrderFlow();
    } catch (err) {
      console.error('Failed to update order:', err);
    }
  };

  const deleteClientsOrder = async (id: string) => {
    try {
      await api.clientsOrders.delete(id);
      setClientsOrders((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      console.error('Failed to delete order:', err);
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
      alert((err as Error).message || 'Failed to create order from offer');
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
    createClientOfferVersion,
    updateClientsOrder,
    deleteClientsOrder,
    createClientsOrderFromOffer,
  };
};
