import type React from 'react';
import api from '../../services/api';
import type {
  AutoCreatedSupplierOrder,
  ClientOffer,
  ClientsOrder,
  Invoice,
  Quote,
  QuoteMutation,
  View,
} from '../../types';
import { addMonthsToDateOnly, getLocalDateString, isDateOnlyBeforeToday } from '../../utils/date';
import { sourcesSupplierQuote } from '../../utils/supplierLineSync';
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
  getClientOffers: () => ClientOffer[];
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  setClientOffers: React.Dispatch<React.SetStateAction<ClientOffer[]>>;
  setClientsOrders: React.Dispatch<React.SetStateAction<ClientsOrder[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  setClientQuoteFilterId: React.Dispatch<React.SetStateAction<string | null>>;
  setClientOfferFilterId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveView: React.Dispatch<React.SetStateAction<View | '404'>>;
  refreshSupplierQuoteFlow: () => Promise<void>;
  notifyClientOfferCreated?: (offerId: string) => void;
  notifyClientOrderCreated?: (orderId: string) => void;
  notifySupplierOrderCreated?: (order: AutoCreatedSupplierOrder) => void;
};

export const makeQuoteHandlers = (deps: QuoteHandlersDeps) => {
  const {
    getClientQuoteFilterId,
    getClientOfferFilterId,
    getQuotes,
    getClientOffers,
    setQuotes,
    setClientOffers,
    setClientsOrders,
    setInvoices,
    setClientQuoteFilterId,
    setClientOfferFilterId,
    setActiveView,
    refreshSupplierQuoteFlow,
    notifyClientOfferCreated,
    notifyClientOrderCreated,
    notifySupplierOrderCreated,
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

  const surfaceWarnings = (warnings?: string[]) => {
    for (const warning of warnings ?? []) {
      toastError(warning);
    }
  };

  const addQuote = async (quoteData: QuoteMutation) => {
    try {
      const quote = await api.quotes.create(quoteData);
      setQuotes((prev) => [quote, ...prev]);
      if (sourcesSupplierQuote(quote)) {
        await refreshLinkedSupplierQuotes();
      }
    } catch (err) {
      console.error('Failed to add quote:', err);
      throw err;
    }
  };

  const updateQuote = async (id: string, updates: QuoteMutation) => {
    try {
      // Captured before the await: the response reflects the post-save lines, but a quote that
      // STOPPED sourcing a supplier quote also needs a refresh (the now-unsourced supplier quote
      // falls back to draft), so consider the pre-save lines too.
      const previousQuote = getQuotes().find((q) => q.id === id);
      const previousLinkedOffer = previousQuote?.linkedOfferId
        ? getClientOffers().find((offer) => offer.id === previousQuote.linkedOfferId)
        : undefined;
      const wasSourcing =
        sourcesSupplierQuote(previousQuote) || sourcesSupplierQuote(previousLinkedOffer);
      const updated = await api.quotes.update(id, updates);
      // Re-read the filter via the getter so we observe the latest value, not
      // the one captured when this handler was created. Navigation effects in
      // App.tsx can clear the filter while the API call is in flight.
      if (getClientQuoteFilterId() === id) {
        setClientQuoteFilterId(updated.id);
      }
      // Only a quote that sources (or sourced) a supplier quote can stale the supplier-quotes
      // cache: line sourcing drives the derived status and forward-syncs the supplier items, so a
      // stale cache would show a false drift chip whose refresh writes pre-edit values back.
      // Gating on sourcing rather than the request fields matters: the edit form spreads formData,
      // so a plain edit of an unsourced quote would otherwise refetch needlessly. The two flows
      // set disjoint state, so they run in parallel.
      const supplierRefreshNeeded = wasSourcing || sourcesSupplierQuote(updated);
      await Promise.all([
        refreshClientQuoteFlow(),
        supplierRefreshNeeded ? refreshLinkedSupplierQuotes() : Promise.resolve(),
      ]);
      if (
        updated.status === 'offer' &&
        previousQuote?.status !== 'offer' &&
        updated.linkedOfferId
      ) {
        notifyClientOfferCreated?.(updated.linkedOfferId);
      }
    } catch (err) {
      console.error('Failed to update quote:', err);
      throw err;
    }
  };

  const promoteQuoteCandidate = async (quoteId: string, candidateId: string) => {
    try {
      const result = await api.quotes.promote(quoteId, candidateId);
      await Promise.all([refreshClientQuoteFlow(), refreshLinkedSupplierQuotes()]);
      notifyClientOfferCreated?.(result.offer.id);
      return result;
    } catch (err) {
      console.error('Failed to promote quote candidate:', err);
      throw err;
    }
  };

  const rollbackQuotePromotion = async (quoteId: string) => {
    try {
      const quote = await api.quotes.rollbackPromotion(quoteId);
      await Promise.all([refreshClientQuoteFlow(), refreshLinkedSupplierQuotes()]);
      return quote;
    } catch (err) {
      console.error('Failed to roll back quote promotion:', err);
      throw err;
    }
  };

  const deleteQuote = async (id: string) => {
    try {
      // Read before the awaits — after the delete the quote is gone from state. Deleting a quote
      // that sourced a supplier quote drops that supplier quote back to draft server-side, the
      // same staleness class the update path refreshes for.
      const wasSourcing = sourcesSupplierQuote(getQuotes().find((q) => q.id === id));
      await api.quotes.delete(id);
      setQuotes((prev) => prev.filter((q) => q.id !== id));
      if (wasSourcing) {
        await refreshLinkedSupplierQuotes();
      }
    } catch (err) {
      console.error('Failed to delete quote:', err);
      throw err;
    }
  };

  const updateClientOffer = async (id: string, updates: Partial<ClientOffer>) => {
    try {
      // Read BEFORE the await: an update can REMOVE an offer-only sourced line (one not present
      // on the linked quote), in which case neither `updated` nor the source quote reports the
      // link anymore — but the supplier quote's derived status/sourceability just changed
      // (#812 round 29).
      const wasSourcing = sourcesSupplierQuote(getClientOffers().find((o) => o.id === id));
      const updated = await api.clientOffers.update(id, updates);
      // Same reasoning as in updateQuote: read the filter freshly so a
      // mid-flight navigation/clear is respected.
      if (getClientOfferFilterId() === id) {
        setClientOfferFilterId(updated.id);
      }
      // An offer's status drives a supplier quote's derived status through the offer chain (#779:
      // sent/accepted/denied flow through). That chain hangs off the SOURCE quote's lines
      // (customer_offers.linked_quote_id → quote_items), so the offer's own items may not carry the
      // sourcing — check the source quote too (consistent with deleteClientOffer). An offer item
      // edit also forward-syncs the supplier items, hence checking the offer as well.
      const sourceQuote = getQuotes().find((q) => q.id === updated.linkedQuoteId);
      const supplierRefreshNeeded =
        wasSourcing || sourcesSupplierQuote(updated) || sourcesSupplierQuote(sourceQuote);
      await Promise.all([
        refreshClientQuoteFlow(),
        supplierRefreshNeeded ? refreshLinkedSupplierQuotes() : Promise.resolve(),
      ]);
      if (updated.autoCreated) {
        notifyClientOrderCreated?.(updated.autoCreated.clientOrder.id);
        for (const supplierOrder of updated.autoCreated.supplierOrders) {
          notifySupplierOrderCreated?.(supplierOrder);
        }
      }
      surfaceWarnings(updated.warnings);
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
      // accepted/denied → draft flips a sourced supplier quote's derived status back to 'offer'
      // (#779 offer chain). The chain follows the SOURCE quote's lines, not the offer's own items,
      // so check the source quote too (consistent with deleteClientOffer).
      const sourceQuote = getQuotes().find((q) => q.id === updated.linkedQuoteId);
      const supplierRefreshNeeded =
        sourcesSupplierQuote(updated) || sourcesSupplierQuote(sourceQuote);
      await Promise.all([
        refreshClientQuoteFlow(),
        supplierRefreshNeeded ? refreshLinkedSupplierQuotes() : Promise.resolve(),
      ]);
    } catch (err) {
      console.error('Failed to revert client offer to draft:', err);
      throw err;
    }
  };

  const deleteClientOffer = async (id: string) => {
    try {
      // Read before the await — after the delete the linkage is gone from state. Removing an offer
      // collapses a sourced supplier quote's derived status back onto the quote chain. Check BOTH
      // the source quote's lines AND the offer's own: an offer can carry sourced lines that exist
      // only on the offer (added while editing the draft), and the backend counts those as
      // sourcing candidates too — deleting them un-sources the supplier quote just the same.
      const linkedQuote = getQuotes().find((q) => q.linkedOfferId === id);
      const offer = getClientOffers().find((o) => o.id === id);
      await api.clientOffers.delete(id);
      // Candidate-linked offer deletion performs a server-side promotion rollback: the parent
      // returns to draft and every selected/discarded candidate becomes active. Refresh the whole
      // flow so local state receives those changes instead of merely clearing linkedOfferId.
      await Promise.all([
        refreshClientQuoteFlow(),
        sourcesSupplierQuote(linkedQuote) || sourcesSupplierQuote(offer)
          ? refreshLinkedSupplierQuotes()
          : Promise.resolve(),
      ]);
    } catch (err) {
      console.error('Failed to delete client offer:', err);
      throw err;
    }
  };

  const createClientOfferFromLegacyQuote = async (quote: Quote) => {
    try {
      // Accepted legacy quotes can predate candidate promotion and therefore have no generated
      // offer. Keep their one-time conversion path until all such records have been migrated.
      const expirationDate =
        !quote.expirationDate || isDateOnlyBeforeToday(quote.expirationDate)
          ? addMonthsToDateOnly(getLocalDateString(), 1)
          : quote.expirationDate;
      const offer = await api.clientOffers.create({
        linkedQuoteId: quote.id,
        clientId: quote.clientId,
        clientName: quote.clientName,
        paymentTerms: quote.paymentTerms,
        discount: quote.discount,
        status: 'draft',
        expirationDate,
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
      notifyClientOfferCreated?.(offer.id);
      if (sourcesSupplierQuote(quote)) {
        await refreshLinkedSupplierQuotes();
      }
    } catch (err) {
      console.error('Failed to create offer from legacy quote:', err);
      toastError((err as Error).message || 'Failed to create offer from legacy quote');
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
          orderId: '',
        })),
        discount: offer.discount,
        notes: offer.notes,
      };

      const order = await api.clientsOrders.create(orderData);
      setClientsOrders((prev) => [...prev, order]);
      setActiveView('accounting/clients-orders');
      notifyClientOrderCreated?.(order.id);
      for (const supplierOrder of order.supplierOrders ?? []) {
        notifySupplierOrderCreated?.(supplierOrder);
      }
      surfaceWarnings(order.warnings);
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
    promoteQuoteCandidate,
    rollbackQuotePromotion,
    deleteQuote,
    updateClientOffer,
    revertClientOfferToDraft,
    deleteClientOffer,
    createClientOfferFromLegacyQuote,
    updateClientsOrder,
    deleteClientsOrder,
    createClientsOrderFromOffer,
  };
};
