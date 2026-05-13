import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { registerMockCleanup } from '../../helpers/mockCleanup.ts';

type QuoteLike = { id: string; status: string; isExpired?: boolean; expirationDate?: string };
type OfferLike = { id: string };
type OrderLike = { id: string };
type InvoiceLike = { id: string };

const apiMocks = {
  quotesUpdate: mock(
    (id: string, updates: unknown): Promise<QuoteLike> =>
      Promise.resolve({ id, status: 'draft', ...(updates as object) }),
  ),
  quotesCreate: mock(
    (data: unknown): Promise<QuoteLike> =>
      Promise.resolve({ id: 'quote-new', status: 'draft', ...(data as object) }),
  ),
  quotesDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  quotesList: mock((): Promise<QuoteLike[]> => Promise.resolve([])),
  clientOffersUpdate: mock(
    (id: string, updates: unknown): Promise<OfferLike> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  clientOffersCreate: mock(
    (data: unknown): Promise<OfferLike> =>
      Promise.resolve({ id: 'offer-new', ...(data as object) }),
  ),
  clientOffersDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  clientOffersList: mock((): Promise<OfferLike[]> => Promise.resolve([])),
  clientsOrdersUpdate: mock(
    (id: string, updates: unknown): Promise<OrderLike> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  clientsOrdersCreate: mock(
    (data: unknown): Promise<OrderLike> =>
      Promise.resolve({ id: 'order-new', ...(data as object) }),
  ),
  clientsOrdersDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  clientsOrdersList: mock((): Promise<OrderLike[]> => Promise.resolve([])),
  invoicesList: mock((): Promise<InvoiceLike[]> => Promise.resolve([])),
};

mock.module('../../../services/api', () => ({
  default: {
    quotes: {
      list: () => apiMocks.quotesList(),
      create: (data: unknown) => apiMocks.quotesCreate(data),
      update: (id: string, updates: unknown) => apiMocks.quotesUpdate(id, updates),
      delete: (id: string) => apiMocks.quotesDelete(id),
    },
    clientOffers: {
      list: () => apiMocks.clientOffersList(),
      create: (data: unknown) => apiMocks.clientOffersCreate(data),
      update: (id: string, updates: unknown) => apiMocks.clientOffersUpdate(id, updates),
      delete: (id: string) => apiMocks.clientOffersDelete(id),
    },
    clientsOrders: {
      list: () => apiMocks.clientsOrdersList(),
      create: (data: unknown) => apiMocks.clientsOrdersCreate(data),
      update: (id: string, updates: unknown) => apiMocks.clientsOrdersUpdate(id, updates),
      delete: (id: string) => apiMocks.clientsOrdersDelete(id),
    },
    invoices: {
      list: () => apiMocks.invoicesList(),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

registerMockCleanup();

const { makeQuoteHandlers } = await import('../../../hooks/handlers/quoteHandlers');

const makeStubSetter = <T>(initial: T[]) => {
  let value = initial;
  const setter = (updater: T[] | ((prev: T[]) => T[])) => {
    value = typeof updater === 'function' ? (updater as (prev: T[]) => T[])(value) : updater;
  };
  return {
    setter: setter as never,
    get: () => value,
  };
};

const makeStubScalarSetter = <T>(initial: T) => {
  let value = initial;
  const setter = (updater: T | ((prev: T) => T)) => {
    value = typeof updater === 'function' ? (updater as (prev: T) => T)(value) : updater;
  };
  return {
    // The handler factory expects React.Dispatch — cast to never to satisfy it
    // while still allowing tests to invoke `setter` directly via `setValue`.
    setter: setter as never,
    setValue: setter,
    get: () => value,
  };
};

describe('makeQuoteHandlers', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((m) => m.mockClear());
  });

  afterEach(() => {
    Object.values(apiMocks).forEach((m) => m.mockReset());
  });

  test('updateQuote sees fresh quotes via getter (post-creation push)', async () => {
    // Snapshot at handler creation: empty.
    let quotesState: QuoteLike[] = [];
    const handlers = makeQuoteHandlers({
      getQuotes: (() => quotesState) as never,
      getClientQuoteFilterId: () => null,
      getClientOfferFilterId: () => null,
      setQuotes: ((updater: unknown) => {
        quotesState =
          typeof updater === 'function'
            ? (updater as (prev: QuoteLike[]) => QuoteLike[])(quotesState)
            : (updater as QuoteLike[]);
      }) as never,
      setClientOffers: makeStubSetter<OfferLike>([]).setter,
      setClientsOrders: makeStubSetter<OrderLike>([]).setter,
      setInvoices: makeStubSetter<InvoiceLike>([]).setter,
      setClientQuoteFilterId: makeStubScalarSetter<string | null>(null).setter,
      setClientOfferFilterId: makeStubScalarSetter<string | null>(null).setter,
      setActiveView: makeStubScalarSetter<string>('').setter,
      refreshSupplierQuoteFlow: () => Promise.resolve(),
    });

    // After factory creation, a fresh quote shows up (e.g. another async load
    // finished). The getter must see this on the next call.
    quotesState = [{ id: 'q1', status: 'sent', isExpired: true }];
    apiMocks.quotesUpdate.mockImplementation((id, updates) =>
      Promise.resolve({ id, status: 'draft', isExpired: false, ...(updates as object) }),
    );

    await handlers.updateQuote('q1', { status: 'draft', isExpired: false });

    // updateQuote should have computed isRestore=true and added expirationDate.
    const callArg = apiMocks.quotesUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(callArg.expirationDate).toBeDefined();
    expect(callArg.status).toBe('draft');
  });

  test('updateQuote does NOT re-apply filter that was cleared during await', async () => {
    const quotesState: QuoteLike[] = [{ id: 'q1', status: 'draft' }];
    const filterIdHolder = makeStubScalarSetter<string | null>('q1');
    // Mock the API to never auto-resolve so we can simulate a navigation.
    let resolver: () => void = () => {};
    apiMocks.quotesUpdate.mockImplementation(
      (id: string, updates: unknown) =>
        new Promise<QuoteLike>((resolve) => {
          resolver = () => resolve({ id: `${id}-v2`, status: 'draft', ...(updates as object) });
        }),
    );

    const handlers = makeQuoteHandlers({
      getQuotes: (() => quotesState) as never,
      // Getter reads the LATEST holder value — this is the invariant we want.
      getClientQuoteFilterId: () => filterIdHolder.get(),
      getClientOfferFilterId: () => null,
      setQuotes: makeStubSetter<QuoteLike>([]).setter,
      setClientOffers: makeStubSetter<OfferLike>([]).setter,
      setClientsOrders: makeStubSetter<OrderLike>([]).setter,
      setInvoices: makeStubSetter<InvoiceLike>([]).setter,
      setClientQuoteFilterId: filterIdHolder.setter,
      setClientOfferFilterId: makeStubScalarSetter<string | null>(null).setter,
      setActiveView: makeStubScalarSetter<string>('').setter,
      refreshSupplierQuoteFlow: () => Promise.resolve(),
    });

    // Kick off the update; do NOT await yet.
    const pending = handlers.updateQuote('q1', { status: 'accepted' });

    // Simulate the user navigating away (App.tsx effect clears the filter).
    filterIdHolder.setValue(null);

    // Now resolve the API call.
    resolver();
    await pending;

    // The filter was cleared, so the handler must respect that and leave it
    // null. The buggy stale-closure version would have re-set it to 'q1-v2'.
    expect(filterIdHolder.get()).toBe(null);
  });

  test('updateQuote moves filter to new id when filter still points at the old id', async () => {
    const quotesState: QuoteLike[] = [{ id: 'q1', status: 'draft' }];
    const filterIdHolder = makeStubScalarSetter<string | null>('q1');
    apiMocks.quotesUpdate.mockImplementation((_id: string, updates: unknown) =>
      Promise.resolve({ id: 'q1-v2', status: 'draft', ...(updates as object) }),
    );

    const handlers = makeQuoteHandlers({
      getQuotes: (() => quotesState) as never,
      getClientQuoteFilterId: () => filterIdHolder.get(),
      getClientOfferFilterId: () => null,
      setQuotes: makeStubSetter<QuoteLike>([]).setter,
      setClientOffers: makeStubSetter<OfferLike>([]).setter,
      setClientsOrders: makeStubSetter<OrderLike>([]).setter,
      setInvoices: makeStubSetter<InvoiceLike>([]).setter,
      setClientQuoteFilterId: filterIdHolder.setter,
      setClientOfferFilterId: makeStubScalarSetter<string | null>(null).setter,
      setActiveView: makeStubScalarSetter<string>('').setter,
      refreshSupplierQuoteFlow: () => Promise.resolve(),
    });

    await handlers.updateQuote('q1', { status: 'accepted' });

    expect(filterIdHolder.get()).toBe('q1-v2');
  });

  test('updateClientOffer does NOT re-apply filter that was cleared during await', async () => {
    const filterIdHolder = makeStubScalarSetter<string | null>('o1');
    let resolver: () => void = () => {};
    apiMocks.clientOffersUpdate.mockImplementation(
      (id: string, updates: unknown) =>
        new Promise<OfferLike>((resolve) => {
          resolver = () => resolve({ id: `${id}-v2`, ...(updates as object) });
        }),
    );

    const handlers = makeQuoteHandlers({
      getQuotes: (() => []) as never,
      getClientQuoteFilterId: () => null,
      getClientOfferFilterId: () => filterIdHolder.get(),
      setQuotes: makeStubSetter<QuoteLike>([]).setter,
      setClientOffers: makeStubSetter<OfferLike>([]).setter,
      setClientsOrders: makeStubSetter<OrderLike>([]).setter,
      setInvoices: makeStubSetter<InvoiceLike>([]).setter,
      setClientQuoteFilterId: makeStubScalarSetter<string | null>(null).setter,
      setClientOfferFilterId: filterIdHolder.setter,
      setActiveView: makeStubScalarSetter<string>('').setter,
      refreshSupplierQuoteFlow: () => Promise.resolve(),
    });

    const pending = handlers.updateClientOffer('o1', {} as never);
    filterIdHolder.setValue(null);
    resolver();
    await pending;

    expect(filterIdHolder.get()).toBe(null);
  });

  test('updateClientOffer moves filter to new id when still pointing at old id', async () => {
    const filterIdHolder = makeStubScalarSetter<string | null>('o1');
    apiMocks.clientOffersUpdate.mockImplementation((_id: string, updates: unknown) =>
      Promise.resolve({ id: 'o1-v2', ...(updates as object) }),
    );

    const handlers = makeQuoteHandlers({
      getQuotes: (() => []) as never,
      getClientQuoteFilterId: () => null,
      getClientOfferFilterId: () => filterIdHolder.get(),
      setQuotes: makeStubSetter<QuoteLike>([]).setter,
      setClientOffers: makeStubSetter<OfferLike>([]).setter,
      setClientsOrders: makeStubSetter<OrderLike>([]).setter,
      setInvoices: makeStubSetter<InvoiceLike>([]).setter,
      setClientQuoteFilterId: makeStubScalarSetter<string | null>(null).setter,
      setClientOfferFilterId: filterIdHolder.setter,
      setActiveView: makeStubScalarSetter<string>('').setter,
      refreshSupplierQuoteFlow: () => Promise.resolve(),
    });

    await handlers.updateClientOffer('o1', {} as never);

    expect(filterIdHolder.get()).toBe('o1-v2');
  });

  test('addQuote prepends new quote', async () => {
    const setter = makeStubSetter<QuoteLike>([{ id: 'q1', status: 'draft' }]);
    apiMocks.quotesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'q-new', status: 'draft', ...(data as object) }),
    );
    const handlers = makeQuoteHandlers({
      getQuotes: (() => setter.get()) as never,
      getClientQuoteFilterId: () => null,
      getClientOfferFilterId: () => null,
      setQuotes: setter.setter,
      setClientOffers: makeStubSetter<OfferLike>([]).setter,
      setClientsOrders: makeStubSetter<OrderLike>([]).setter,
      setInvoices: makeStubSetter<InvoiceLike>([]).setter,
      setClientQuoteFilterId: makeStubScalarSetter<string | null>(null).setter,
      setClientOfferFilterId: makeStubScalarSetter<string | null>(null).setter,
      setActiveView: makeStubScalarSetter<string>('').setter,
      refreshSupplierQuoteFlow: () => Promise.resolve(),
    });

    await handlers.addQuote({ status: 'draft' });
    const ids = setter.get().map((q) => q.id);
    expect(ids[0]).toBe('q-new');
    expect(ids).toContain('q1');
  });

  test('deleteQuote removes the quote from state', async () => {
    apiMocks.quotesDelete.mockImplementation(() => Promise.resolve());
    const setter = makeStubSetter<QuoteLike>([
      { id: 'q1', status: 'draft' },
      { id: 'q2', status: 'draft' },
    ]);
    const handlers = makeQuoteHandlers({
      getQuotes: (() => setter.get()) as never,
      getClientQuoteFilterId: () => null,
      getClientOfferFilterId: () => null,
      setQuotes: setter.setter,
      setClientOffers: makeStubSetter<OfferLike>([]).setter,
      setClientsOrders: makeStubSetter<OrderLike>([]).setter,
      setInvoices: makeStubSetter<InvoiceLike>([]).setter,
      setClientQuoteFilterId: makeStubScalarSetter<string | null>(null).setter,
      setClientOfferFilterId: makeStubScalarSetter<string | null>(null).setter,
      setActiveView: makeStubScalarSetter<string>('').setter,
      refreshSupplierQuoteFlow: () => Promise.resolve(),
    });

    await handlers.deleteQuote('q1');
    expect(setter.get().map((q) => q.id)).toEqual(['q2']);
  });
});
