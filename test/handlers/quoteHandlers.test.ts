import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
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
    getQuotes: (() => quotes.get()) as never,
    getClientQuoteFilterId: () => clientQuoteFilterId.get(),
    getClientOfferFilterId: () => clientOfferFilterId.get(),
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

  test('updateQuote restores expirationDate when status flips back to draft', async () => {
    apiMocks.quotesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'rejected', isExpired: true, expirationDate: '2020-01-01' }],
    });

    await ctx.handlers.updateQuote('q1', { status: 'draft', isExpired: false } as never);

    const callArgs = apiMocks.quotesUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[0]).toBe('q1');
    expect(callArgs[1].status).toBe('draft');
    expect(callArgs[1].isExpired).toBe(false);
    expect(callArgs[1].expirationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('updateQuote does not inject expirationDate when not a restore', async () => {
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
      expirationDate: '2026-12-31',
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
        expirationDate: '2026-12-31',
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
