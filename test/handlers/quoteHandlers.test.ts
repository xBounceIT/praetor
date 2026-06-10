import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { addMonthsToDateOnly, getLocalDateString } from '../../utils/date';
import { ApiErrorStub } from '../helpers/apiErrorStub';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

const apiMocks = {
  quotesList: mock((): Promise<unknown[]> => Promise.resolve([])),
  quotesCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'q-new', ...(data as object) }),
  ),
  quotesUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  quotesDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  clientOffersList: mock((): Promise<unknown[]> => Promise.resolve([])),
  clientOffersCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'of-new', ...(data as object) }),
  ),
  clientOffersUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  clientOffersRevertToDraft: mock(
    (id: string, _reason?: string): Promise<unknown> => Promise.resolve({ id, status: 'draft' }),
  ),
  clientOffersDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  clientsOrdersList: mock((): Promise<unknown[]> => Promise.resolve([])),
  clientsOrdersCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'order-new', ...(data as object) }),
  ),
  clientsOrdersUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  clientsOrdersDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  invoicesList: mock((): Promise<unknown[]> => Promise.resolve([])),
};

const toastErrorMock = mock((_message: string) => {});

mock.module('../../utils/toast', () => ({
  toastError: (message: string) => toastErrorMock(message),
  toastSuccess: () => {},
  toast: { error: () => {}, success: () => {}, info: () => {} },
}));

mock.module('../../services/api', () => ({
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
      revertToDraft: (id: string, reason?: string) =>
        apiMocks.clientOffersRevertToDraft(id, reason),
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
  ApiError: ApiErrorStub,
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

clearSpyStateAfterAll();

const { makeQuoteHandlers } = await import('../../hooks/handlers/quoteHandlers');

type QuoteLike = {
  id: string;
  status?: string;
  isExpired?: boolean;
  expirationDate?: string;
  linkedOfferId?: string;
  linkedSupplierQuoteId?: string | null;
  items?: Array<{ supplierQuoteItemId?: string | null }>;
  clientId?: string;
};
type ClientOfferLike = { id: string; clientId?: string; linkedQuoteId?: string };
type ClientsOrderLike = { id: string; clientId?: string };
type InvoiceLike = { id: string };

type AnyFn = (...args: unknown[]) => void;
const makeStubSetter = <T>(initial: T[]) => {
  let value = initial;
  const setter = ((updater: T[] | ((prev: T[]) => T[])) => {
    value = typeof updater === 'function' ? (updater as (prev: T[]) => T[])(value) : updater;
  }) as AnyFn;
  return { setter, get: () => value };
};

const makeStubScalar = <T>(initial: T) => {
  let value = initial;
  const setter = ((updater: T | ((prev: T) => T)) => {
    value = typeof updater === 'function' ? (updater as (prev: T) => T)(value) : updater;
  }) as AnyFn;
  return { setter, get: () => value };
};

const buildHandlers = (overrides: Record<string, unknown> = {}) => {
  const quotes = makeStubSetter<QuoteLike>((overrides.quotes as QuoteLike[] | undefined) ?? []);
  const clientOffers = makeStubSetter<ClientOfferLike>([]);
  const clientsOrders = makeStubSetter<ClientsOrderLike>([]);
  const invoices = makeStubSetter<InvoiceLike>([]);
  const clientQuoteFilterId = makeStubScalar<string | null>(
    (overrides.clientQuoteFilterId as string | null | undefined) ?? null,
  );
  const clientOfferFilterId = makeStubScalar<string | null>(
    (overrides.clientOfferFilterId as string | null | undefined) ?? null,
  );
  const setActiveView = mock(() => {});
  const refreshSupplierQuoteFlow = mock(() => Promise.resolve()) as unknown as () => Promise<void>;

  const handlers = makeQuoteHandlers({
    getClientQuoteFilterId: () => clientQuoteFilterId.get(),
    getClientOfferFilterId: () => clientOfferFilterId.get(),
    getQuotes: () => quotes.get() as never,
    setQuotes: quotes.setter as never,
    setClientOffers: clientOffers.setter as never,
    setClientsOrders: clientsOrders.setter as never,
    setInvoices: invoices.setter as never,
    setClientQuoteFilterId: clientQuoteFilterId.setter as never,
    setClientOfferFilterId: clientOfferFilterId.setter as never,
    setActiveView: setActiveView as never,
    refreshSupplierQuoteFlow:
      (overrides.refreshSupplierQuoteFlow as (() => Promise<void>) | undefined) ??
      refreshSupplierQuoteFlow,
  });

  return {
    handlers,
    quotes,
    clientOffers,
    clientsOrders,
    invoices,
    clientQuoteFilterId,
    clientOfferFilterId,
    setActiveView,
    refreshSupplierQuoteFlow,
  };
};

const silenceConsole = () => {
  const originalError = console.error;
  console.error = mock(() => {}) as unknown as typeof console.error;
  return () => {
    console.error = originalError;
  };
};

describe('makeQuoteHandlers', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
    toastErrorMock.mockClear();
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
  });

  test('refreshClientQuoteFlow loads quotes/offers/orders', async () => {
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([{ id: 'q-fresh' }]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([{ id: 'of-fresh' }]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([{ id: 'or-fresh' }]));

    const ctx = buildHandlers();
    await ctx.handlers.refreshClientQuoteFlow();

    expect(ctx.quotes.get()).toEqual([{ id: 'q-fresh' }]);
    expect(ctx.clientOffers.get()).toEqual([{ id: 'of-fresh' }]);
    expect(ctx.clientsOrders.get()).toEqual([{ id: 'or-fresh' }]);
  });

  test('refreshClientOrderFlow loads orders and invoices', async () => {
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([{ id: 'or-fresh' }]));
    apiMocks.invoicesList.mockImplementation(() => Promise.resolve([{ id: 'inv-fresh' }]));

    const ctx = buildHandlers();
    await ctx.handlers.refreshClientOrderFlow();
    expect(ctx.clientsOrders.get()).toEqual([{ id: 'or-fresh' }]);
    expect(ctx.invoices.get()).toEqual([{ id: 'inv-fresh' }]);
  });

  test('addQuote prepends created quote', async () => {
    apiMocks.quotesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'q-new', ...(data as object) }),
    );
    const ctx = buildHandlers();
    ctx.quotes.setter([{ id: 'q1' }] as never);

    await ctx.handlers.addQuote({ status: 'draft' } as never);
    expect(ctx.quotes.get()[0].id).toBe('q-new');
  });

  test('addQuote rethrows api error', async () => {
    apiMocks.quotesCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.addQuote({} as never)).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('updateQuote passes the payload through to the API untouched', async () => {
    apiMocks.quotesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'draft', isExpired: false }],
    });

    await ctx.handlers.updateQuote('q1', { status: 'sent' } as never);
    const callArgs = apiMocks.quotesUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].expirationDate).toBeUndefined();
  });

  test('updateQuote updates client filter when ids match', async () => {
    apiMocks.quotesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'draft' }],
      clientQuoteFilterId: 'q1',
    });

    await ctx.handlers.updateQuote('q1', { status: 'sent' } as never);
    expect(ctx.clientQuoteFilterId.get()).toBe('q1');
  });

  test('updateQuote rethrows api error', async () => {
    apiMocks.quotesUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers({ quotes: [{ id: 'q1' }] });
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.updateQuote('q1', {} as never)).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  // A linked supplier quote's visible status is derived from its client quote (#779), so a status
  // or link change must also refresh the separately-cached supplier quotes table.
  const stubQuoteUpdateFlow = () => {
    apiMocks.quotesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
  };

  test('updateQuote refreshes supplier quotes when a linked quote changes status', async () => {
    stubQuoteUpdateFlow();
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'offer', linkedSupplierQuoteId: 'sq-9' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateQuote('q1', { status: 'accepted' } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('updateQuote refreshes supplier quotes when the linked supplier quote changes', async () => {
    stubQuoteUpdateFlow();
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'draft' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateQuote('q1', { linkedSupplierQuoteId: 'sq-9' } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('updateQuote does NOT refresh supplier quotes for a plain content edit', async () => {
    stubQuoteUpdateFlow();
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'draft' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateQuote('q1', { notes: 'just a note' } as never);
    expect(refreshSupplierQuoteFlow).not.toHaveBeenCalled();
  });

  test('updateQuote does NOT refresh supplier quotes when an unlinked quote saves its full form', async () => {
    stubQuoteUpdateFlow();
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'draft' }],
      refreshSupplierQuoteFlow,
    });

    // The edit modal spreads formData, so status and a null link ride along on EVERY save —
    // the gate must key on the actual link, not on which request fields are present.
    await ctx.handlers.updateQuote('q1', {
      status: 'draft',
      linkedSupplierQuoteId: null,
      notes: 'edited',
    } as never);
    expect(refreshSupplierQuoteFlow).not.toHaveBeenCalled();
  });

  test('updateQuote refreshes supplier quotes when the link is removed', async () => {
    stubQuoteUpdateFlow();
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'draft', linkedSupplierQuoteId: 'sq-9' }],
      refreshSupplierQuoteFlow,
    });

    // The response carries null after an unlink — only the pre-await snapshot knows sq-9 just
    // became un-synced.
    await ctx.handlers.updateQuote('q1', { linkedSupplierQuoteId: null } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('deleteQuote refreshes supplier quotes when the deleted quote was linked', async () => {
    apiMocks.quotesDelete.mockImplementation(() => Promise.resolve());
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'sent', linkedSupplierQuoteId: 'sq-9' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.deleteQuote('q1');
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
    expect(ctx.quotes.get()).toHaveLength(0);
  });

  test('deleteQuote does NOT refresh supplier quotes for an unlinked quote', async () => {
    apiMocks.quotesDelete.mockImplementation(() => Promise.resolve());
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'draft' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.deleteQuote('q1');
    expect(refreshSupplierQuoteFlow).not.toHaveBeenCalled();
  });

  test('updateQuote still resolves when the supplier-quote refresh fails (best-effort)', async () => {
    stubQuoteUpdateFlow();
    const refreshSupplierQuoteFlow = mock(() => Promise.reject(new Error('supplier boom')));
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'offer', linkedSupplierQuoteId: 'sq-9' }],
      refreshSupplierQuoteFlow,
    });
    const restore = silenceConsole();
    try {
      await ctx.handlers.updateQuote('q1', { status: 'accepted' } as never);
      expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  test('addQuote refreshes supplier quotes when the created quote carries a link', async () => {
    apiMocks.quotesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'q-new', linkedSupplierQuoteId: 'sq-9', ...(data as object) }),
    );
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({ refreshSupplierQuoteFlow });

    await ctx.handlers.addQuote({ status: 'draft', linkedSupplierQuoteId: 'sq-9' } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('addQuote does NOT refresh supplier quotes for an unlinked create', async () => {
    apiMocks.quotesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'q-new', ...(data as object) }),
    );
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({ refreshSupplierQuoteFlow });

    await ctx.handlers.addQuote({ status: 'draft' } as never);
    expect(refreshSupplierQuoteFlow).not.toHaveBeenCalled();
  });

  test('updateQuote refreshes supplier quotes for LINE-sourced items without a header link', async () => {
    // The forward sync rewrites the supplier item on save even when quotes.linkedSupplierQuoteId
    // is null — a stale cache would then show a false "old info" chip whose refresh writes the
    // pre-edit values back (#779).
    stubQuoteUpdateFlow();
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'draft', items: [{ supplierQuoteItemId: 'sqi-9' }] }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateQuote('q1', { notes: 'edited' } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('updateClientOffer refreshes supplier quotes when its quote is header-linked', async () => {
    // Offer status drives the derived supplier-quote status through the offer chain (#779).
    apiMocks.clientOffersUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, linkedQuoteId: 'q1', ...(updates as object) }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'accepted', linkedSupplierQuoteId: 'sq-9' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateClientOffer('of-1', { status: 'accepted' } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('updateClientOffer refreshes supplier quotes when the response carries sourced items', async () => {
    apiMocks.clientOffersUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({
        id,
        linkedQuoteId: 'q-unlinked',
        items: [{ supplierQuoteItemId: 'sqi-9' }],
        ...(updates as object),
      }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q-unlinked', status: 'accepted' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateClientOffer('of-1', { notes: 'edited' } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('updateClientOffer does NOT refresh supplier quotes when nothing supplier-related is involved', async () => {
    apiMocks.clientOffersUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, linkedQuoteId: 'q-unlinked', items: [], ...(updates as object) }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q-unlinked', status: 'accepted' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateClientOffer('of-1', { notes: 'edited' } as never);
    expect(refreshSupplierQuoteFlow).not.toHaveBeenCalled();
  });

  test('revertClientOfferToDraft refreshes supplier quotes when its quote is header-linked', async () => {
    apiMocks.clientOffersRevertToDraft.mockImplementation((id: string) =>
      Promise.resolve({ id, status: 'draft', linkedQuoteId: 'q1' }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'accepted', linkedSupplierQuoteId: 'sq-9' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.revertClientOfferToDraft('of-1', 'mistake');
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('deleteClientOffer refreshes supplier quotes when the offer drove a linked supplier quote', async () => {
    apiMocks.clientOffersDelete.mockImplementation(() => Promise.resolve());
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', linkedOfferId: 'of-1', linkedSupplierQuoteId: 'sq-9' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.deleteClientOffer('of-1');
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('createClientOfferFromQuote refreshes supplier quotes for a header-linked source quote', async () => {
    apiMocks.clientOffersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ ...(data as object), id: 'of-new' }),
    );
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({ refreshSupplierQuoteFlow });
    ctx.quotes.setter([{ id: 'q1', clientId: 'c1' }] as never);

    await ctx.handlers.createClientOfferFromQuote({
      id: 'q1',
      clientId: 'c1',
      clientName: 'Acme',
      paymentTerms: '30',
      discount: 0,
      expirationDate: '2999-12-31',
      linkedSupplierQuoteId: 'sq-9',
      notes: '',
      items: [],
    } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('deleteQuote removes from list', async () => {
    apiMocks.quotesDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers();
    ctx.quotes.setter([{ id: 'q1' }, { id: 'q2' }] as never);

    await ctx.handlers.deleteQuote('q1');
    expect(ctx.quotes.get()).toEqual([{ id: 'q2' }]);
  });

  test('deleteQuote rethrows api error', async () => {
    apiMocks.quotesDelete.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.deleteQuote('q1')).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('updateClientOffer refreshes flow and updates filter when matched', async () => {
    apiMocks.clientOffersUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers({ clientOfferFilterId: 'of-1' });

    await ctx.handlers.updateClientOffer('of-1', { status: 'sent' } as never);
    expect(ctx.clientOfferFilterId.get()).toBe('of-1');
  });

  test('updateClientOffer rethrows api error', async () => {
    apiMocks.clientOffersUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.updateClientOffer('of-1', {} as never)).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('revertClientOfferToDraft calls dedicated API and refreshes flow', async () => {
    apiMocks.clientOffersRevertToDraft.mockImplementation((id: string) =>
      Promise.resolve({ id, status: 'draft' }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([{ id: 'of-1' }]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers({ clientOfferFilterId: 'of-1' });

    await ctx.handlers.revertClientOfferToDraft('of-1', 'wrong status');

    expect(apiMocks.clientOffersRevertToDraft).toHaveBeenCalledWith('of-1', 'wrong status');
    expect(ctx.clientOfferFilterId.get()).toBe('of-1');
    expect(ctx.clientOffers.get()).toEqual([{ id: 'of-1' }]);
  });

  test('deleteClientOffer removes offer and unlinks affected quotes', async () => {
    apiMocks.clientOffersDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers();
    ctx.clientOffers.setter([{ id: 'of-1' }, { id: 'of-2' }] as never);
    ctx.quotes.setter([
      { id: 'q1', linkedOfferId: 'of-1' },
      { id: 'q2', linkedOfferId: 'of-2' },
    ] as never);

    await ctx.handlers.deleteClientOffer('of-1');
    expect(ctx.clientOffers.get()).toEqual([{ id: 'of-2' }]);
    expect(ctx.quotes.get()[0].linkedOfferId).toBeUndefined();
    expect(ctx.quotes.get()[1].linkedOfferId).toBe('of-2');
  });

  test('deleteClientOffer rethrows api error', async () => {
    apiMocks.clientOffersDelete.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.deleteClientOffer('of-1')).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('createClientOfferFromQuote creates offer, links quote, switches view', async () => {
    apiMocks.clientOffersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ ...(data as object), id: 'of-new' }),
    );
    const ctx = buildHandlers();
    ctx.quotes.setter([{ id: 'q1', clientId: 'c1' }] as never);

    const quote = {
      id: 'q1',
      clientId: 'c1',
      clientName: 'Acme',
      paymentTerms: '30',
      discount: 5,
      // Far future: a past date would trigger the fresh-validity-window branch instead.
      expirationDate: '2999-12-31',
      notes: 'note',
      items: [{ id: 'orig-1', productId: 'p1', quantity: 1, unitPrice: 10 }],
    };

    await ctx.handlers.createClientOfferFromQuote(quote as never);

    expect(apiMocks.clientOffersCreate).toHaveBeenCalled();
    const callArg = apiMocks.clientOffersCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.id).toBe('q1-OF');
    expect(callArg.linkedQuoteId).toBe('q1');
    expect(callArg.status).toBe('draft');
    const items = callArg.items as Array<Record<string, unknown>>;
    expect(items[0].offerId).toBe('');
    // ID is replaced with a temp id, not the original.
    expect(items[0].id).not.toBe('orig-1');

    expect(ctx.clientOffers.get()[0].id).toBe('of-new');
    expect(ctx.quotes.get()[0].linkedOfferId).toBe('of-new');
    expect(ctx.setActiveView).toHaveBeenCalledWith('sales/client-offers');
    // A still-valid source date is copied verbatim.
    const payload = apiMocks.clientOffersCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.expirationDate).toBe('2999-12-31');
  });

  test('createClientOfferFromQuote refreshes a dead validity window instead of copying it', async () => {
    apiMocks.clientOffersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ ...(data as object), id: 'of-new' }),
    );
    const ctx = buildHandlers();
    ctx.quotes.setter([{ id: 'q1', clientId: 'c1' }] as never);

    await ctx.handlers.createClientOfferFromQuote({
      id: 'q1',
      clientId: 'c1',
      clientName: 'Acme',
      paymentTerms: '30',
      discount: 0,
      // Long past — e.g. an accepted quote converted months later (terminal quotes never expire).
      expirationDate: '2000-01-01',
      notes: '',
      items: [],
    } as never);

    const payload = apiMocks.clientOffersCreate.mock.calls[0][0] as Record<string, unknown>;
    // Copying the dead date would mint a born-expired, immediately read-only offer (#779);
    // the conversion mints the standard one-month window instead.
    expect(payload.expirationDate).toBe(addMonthsToDateOnly(getLocalDateString(), 1));
  });

  test('createClientOfferFromQuote toasts on api error', async () => {
    apiMocks.clientOffersCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await ctx.handlers.createClientOfferFromQuote({
        id: 'q1',
        clientId: 'c1',
        clientName: 'Acme',
        paymentTerms: '30',
        discount: 0,
        expirationDate: '2999-12-31',
        notes: '',
        items: [],
      } as never);
      expect(ctx.setActiveView).not.toHaveBeenCalled();
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock.mock.calls[0][0]).toBe('boom');
    } finally {
      restore();
    }
  });

  test('updateClientsOrder refreshes order flow', async () => {
    apiMocks.clientsOrdersUpdate.mockImplementation(() => Promise.resolve({}));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([{ id: 'or-fresh' }]));
    apiMocks.invoicesList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers();

    await ctx.handlers.updateClientsOrder('or-1', { status: 'confirmed' } as never);
    expect(ctx.clientsOrders.get()).toEqual([{ id: 'or-fresh' }]);
  });

  test('updateClientsOrder rethrows api error', async () => {
    apiMocks.clientsOrdersUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.updateClientsOrder('or-1', {} as never)).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('deleteClientsOrder removes from list', async () => {
    apiMocks.clientsOrdersDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers();
    ctx.clientsOrders.setter([{ id: 'or-1' }, { id: 'or-2' }] as never);

    await ctx.handlers.deleteClientsOrder('or-1');
    expect(ctx.clientsOrders.get()).toEqual([{ id: 'or-2' }]);
  });

  test('deleteClientsOrder rethrows api error', async () => {
    apiMocks.clientsOrdersDelete.mockImplementation(() => Promise.reject(new Error('nope')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.deleteClientsOrder('or-1')).rejects.toThrow('nope');
    } finally {
      restore();
    }
  });

  test('createClientsOrderFromOffer creates order, switches view, refreshes supplier flow', async () => {
    apiMocks.clientsOrdersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'or-new', ...(data as object) }),
    );
    const refreshSupplierQuoteFlow = mock(() =>
      Promise.resolve(),
    ) as unknown as () => Promise<void>;
    const ctx = buildHandlers({ refreshSupplierQuoteFlow });

    const offer = {
      id: 'of-1',
      clientId: 'c1',
      clientName: 'Acme',
      paymentTerms: '30',
      discount: 0,
      linkedQuoteId: 'q1',
      notes: 'note',
      items: [{ id: 'orig', productId: 'p1', quantity: 1, unitPrice: 10 }],
    };

    await ctx.handlers.createClientsOrderFromOffer(offer as never);
    expect(apiMocks.clientsOrdersCreate).toHaveBeenCalled();
    const callArg = apiMocks.clientsOrdersCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.linkedOfferId).toBe('of-1');
    expect(callArg.status).toBe('draft');
    const items = callArg.items as Array<Record<string, unknown>>;
    expect(items[0].orderId).toBe('');

    expect(ctx.clientsOrders.get()[0].id).toBe('or-new');
    expect(ctx.setActiveView).toHaveBeenCalledWith('accounting/clients-orders');
    expect(refreshSupplierQuoteFlow).toHaveBeenCalled();
  });

  test('createClientsOrderFromOffer toasts on api error', async () => {
    apiMocks.clientsOrdersCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await ctx.handlers.createClientsOrderFromOffer({
        id: 'of-1',
        clientId: 'c1',
        clientName: 'Acme',
        paymentTerms: '30',
        discount: 0,
        linkedQuoteId: 'q1',
        notes: '',
        items: [],
      } as never);
      expect(ctx.setActiveView).not.toHaveBeenCalled();
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock.mock.calls[0][0]).toBe('boom');
    } finally {
      restore();
    }
  });

  test('createClientsOrderFromOffer swallows refresh errors after success', async () => {
    apiMocks.clientsOrdersCreate.mockImplementation(() => Promise.resolve({ id: 'or-new' }));
    const refreshSupplierQuoteFlow = mock(() =>
      Promise.reject(new Error('refresh-fail')),
    ) as unknown as () => Promise<void>;
    const ctx = buildHandlers({ refreshSupplierQuoteFlow });
    const restore = silenceConsole();
    try {
      await ctx.handlers.createClientsOrderFromOffer({
        id: 'of-1',
        clientId: 'c1',
        clientName: 'Acme',
        paymentTerms: '30',
        discount: 0,
        linkedQuoteId: 'q1',
        notes: '',
        items: [],
      } as never);
      expect(ctx.setActiveView).toHaveBeenCalledWith('accounting/clients-orders');
    } finally {
      restore();
    }
  });
});
