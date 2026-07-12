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
  quotesPromote: mock(
    (_id: string, _candidateId: string): Promise<unknown> =>
      Promise.resolve({ quote: { id: 'q-1' }, offer: { id: 'of-1' } }),
  ),
  quotesRollbackPromotion: mock(
    (_id: string): Promise<unknown> => Promise.resolve({ id: 'q-1', status: 'draft' }),
  ),
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
      promote: (id: string, candidateId: string) => apiMocks.quotesPromote(id, candidateId),
      rollbackPromotion: (id: string) => apiMocks.quotesRollbackPromotion(id),
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
  candidates?: Array<{ id: string; state: string }>;
  items?: Array<{ supplierQuoteItemId?: string | null }>;
  clientId?: string;
};
type ClientOfferLike = {
  id: string;
  clientId?: string;
  linkedQuoteId?: string;
  items?: Array<{ supplierQuoteItemId?: string | null }>;
  autoCreated?: {
    clientOrder: { id: string };
    supplierOrders: Array<{ id: string; supplierQuoteId: string; supplierName: string }>;
  };
};
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
  const clientOffers = makeStubSetter<ClientOfferLike>(
    (overrides.clientOffers as ClientOfferLike[] | undefined) ?? [],
  );
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
  const notifyClientOfferCreated = mock((_offerId: string) => {});
  const notifyClientOrderCreated = mock((_orderId: string) => {});
  const notifySupplierOrderCreated = mock((_order: unknown) => {});

  const handlers = makeQuoteHandlers({
    getClientQuoteFilterId: () => clientQuoteFilterId.get(),
    getClientOfferFilterId: () => clientOfferFilterId.get(),
    getQuotes: () => quotes.get() as never,
    getClientOffers: () => clientOffers.get() as never,
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
    notifyClientOfferCreated,
    notifyClientOrderCreated,
    notifySupplierOrderCreated,
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
    notifyClientOfferCreated,
    notifyClientOrderCreated,
    notifySupplierOrderCreated,
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

  // The three list refetches behind refreshClientQuoteFlow, stubbed empty.
  const stubFlowListRefetch = () => {
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
  };

  // A supplier quote's visible status is derived from the client quote/offer whose lines SOURCE it
  // (#779 follow-up: line-sourced, no header link), so a save of such a document must refresh the
  // separately-cached supplier quotes table. `sourced` returns the line-sourcing marker.
  const sourced = [{ supplierQuoteItemId: 'sqi-9' }];
  const stubQuoteUpdateFlow = (updatedFields: object = {}) => {
    apiMocks.quotesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object), ...updatedFields }),
    );
    stubFlowListRefetch();
  };

  test('updateQuote refreshes supplier quotes when a sourcing quote changes status', async () => {
    stubQuoteUpdateFlow({ items: sourced });
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'offer', items: sourced }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateQuote('q1', { status: 'accepted' } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('updateQuote refreshes supplier quotes when a save adds line sourcing', async () => {
    stubQuoteUpdateFlow({ items: sourced });
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'draft' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateQuote('q1', { items: sourced } as never);
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

  test('updateQuote refreshes supplier quotes when a save REMOVES line sourcing', async () => {
    // The previously-sourced supplier quote drops back to draft, so a refresh is still needed even
    // though the post-save quote no longer sources anything (the pre-save snapshot knows it did).
    stubQuoteUpdateFlow({ items: [{ supplierQuoteItemId: null }] });
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'draft', items: sourced }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateQuote('q1', { items: [{ supplierQuoteItemId: null }] } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('updateQuote refreshes supplier quotes when rollback removes offer-only sourcing', async () => {
    stubQuoteUpdateFlow({ status: 'draft', linkedOfferId: null, items: [] });
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'offer', linkedOfferId: 'of-1', items: [] }],
      clientOffers: [{ id: 'of-1', items: sourced }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateQuote('q1', { status: 'draft' } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('updateQuote refetches offers after marking a quote as offer', async () => {
    stubQuoteUpdateFlow({ status: 'offer', linkedOfferId: 'q1-OF', items: [] });
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'sent', items: [] }],
    });

    await ctx.handlers.updateQuote('q1', { status: 'offer' } as never);
    expect(apiMocks.clientOffersList).toHaveBeenCalledTimes(1);
    expect(ctx.notifyClientOfferCreated).toHaveBeenCalledWith('q1-OF');
  });

  test('deleteQuote refreshes supplier quotes when the deleted quote sourced one', async () => {
    apiMocks.quotesDelete.mockImplementation(() => Promise.resolve());
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'sent', items: sourced }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.deleteQuote('q1');
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
    expect(ctx.quotes.get()).toHaveLength(0);
  });

  test('deleteQuote does NOT refresh supplier quotes for a quote with no sourcing', async () => {
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
    stubQuoteUpdateFlow({ items: sourced });
    const refreshSupplierQuoteFlow = mock(() => Promise.reject(new Error('supplier boom')));
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', status: 'offer', items: sourced }],
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

  test('addQuote refreshes supplier quotes when the created quote sources one', async () => {
    apiMocks.quotesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'q-new', items: sourced, ...(data as object) }),
    );
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({ refreshSupplierQuoteFlow });

    await ctx.handlers.addQuote({ status: 'draft', items: sourced } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('addQuote does NOT refresh supplier quotes for a create with no sourcing', async () => {
    apiMocks.quotesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'q-new', ...(data as object) }),
    );
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({ refreshSupplierQuoteFlow });

    await ctx.handlers.addQuote({ status: 'draft' } as never);
    expect(refreshSupplierQuoteFlow).not.toHaveBeenCalled();
  });

  test('updateClientOffer refreshes supplier quotes when the offer sources one', async () => {
    apiMocks.clientOffersUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({
        id,
        linkedQuoteId: 'q-unlinked',
        items: [{ supplierQuoteItemId: 'sqi-9' }],
        ...(updates as object),
      }),
    );
    stubFlowListRefetch();
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
    stubFlowListRefetch();
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q-unlinked', status: 'accepted' }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateClientOffer('of-1', { notes: 'edited' } as never);
    expect(refreshSupplierQuoteFlow).not.toHaveBeenCalled();
  });

  test('updateClientOffer refreshes supplier quotes when the update REMOVES an offer-only sourced line (#812 round 29)', async () => {
    // The PREVIOUS offer carried the only link (not present on the linked quote); after the
    // update neither the response nor the source quote sources anything — but the supplier
    // quote's derived status just changed, so the cache must still refresh.
    apiMocks.clientOffersUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, linkedQuoteId: 'q-unlinked', items: [], ...(updates as object) }),
    );
    stubFlowListRefetch();
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q-unlinked', status: 'accepted' }],
      clientOffers: [{ id: 'of-1', items: [{ supplierQuoteItemId: 'sqi-9' }] }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.updateClientOffer('of-1', { items: [] } as never);
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });
  test('revertClientOfferToDraft refreshes supplier quotes when the offer sources one', async () => {
    apiMocks.clientOffersRevertToDraft.mockImplementation((id: string) =>
      Promise.resolve({ id, status: 'draft', linkedQuoteId: 'q1', items: sourced }),
    );
    stubFlowListRefetch();
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({ refreshSupplierQuoteFlow });

    await ctx.handlers.revertClientOfferToDraft('of-1', 'mistake');
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('deleteClientOffer refreshes supplier quotes when the source quote sourced one', async () => {
    apiMocks.clientOffersDelete.mockImplementation(() => Promise.resolve());
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      // The offer's sourcing mirrors its source quote's lines; the linked quote is found by id.
      quotes: [{ id: 'q1', linkedOfferId: 'of-1', items: sourced }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.deleteClientOffer('of-1');
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('deleteClientOffer refreshes supplier quotes when only the OFFER carried the sourced line (#812 round 32)', async () => {
    // The sourced line exists only on the offer (added while editing the draft) — the linked
    // quote sources nothing. The backend counts offer lines as sourcing candidates, so deleting
    // the offer still un-sources the supplier quote and the cache must refresh.
    apiMocks.clientOffersDelete.mockImplementation(() => Promise.resolve());
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', linkedOfferId: 'of-1', items: [] }],
      clientOffers: [{ id: 'of-1', items: [{ supplierQuoteItemId: 'sqi-9' }] }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.deleteClientOffer('of-1');
    expect(refreshSupplierQuoteFlow).toHaveBeenCalledTimes(1);
  });

  test('deleteClientOffer does NOT refresh supplier quotes when neither the quote nor the offer sources one', async () => {
    apiMocks.clientOffersDelete.mockImplementation(() => Promise.resolve());
    const refreshSupplierQuoteFlow = mock(() => Promise.resolve());
    const ctx = buildHandlers({
      quotes: [{ id: 'q1', linkedOfferId: 'of-1', items: [] }],
      clientOffers: [{ id: 'of-1', items: [] }],
      refreshSupplierQuoteFlow,
    });

    await ctx.handlers.deleteClientOffer('of-1');
    expect(refreshSupplierQuoteFlow).not.toHaveBeenCalled();
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
      Promise.resolve({
        id,
        ...(updates as object),
        autoCreated: {
          clientOrder: { id: 'ORD-1' },
          supplierOrders: [{ id: 'SORD-1', supplierQuoteId: 'SQ-1', supplierName: 'Supplier' }],
        },
      }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers({ clientOfferFilterId: 'of-1' });

    await ctx.handlers.updateClientOffer('of-1', { status: 'sent' } as never);
    expect(ctx.clientOfferFilterId.get()).toBe('of-1');
    expect(ctx.notifyClientOrderCreated).toHaveBeenCalledWith('ORD-1');
    expect(ctx.notifySupplierOrderCreated).toHaveBeenCalledWith({
      id: 'SORD-1',
      supplierQuoteId: 'SQ-1',
      supplierName: 'Supplier',
    });
  });

  test('updateClientOffer surfaces auto-create warnings', async () => {
    apiMocks.clientOffersUpdate.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        linkedQuoteId: 'q-1',
        warnings: ['Supplier order not created for supplier quote SQ-1'],
      }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers();

    await ctx.handlers.updateClientOffer('of-1', { status: 'accepted' } as never);

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Supplier order not created for supplier quote SQ-1',
    );
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

  test('deleteClientOffer reloads the server-side candidate rollback state', async () => {
    apiMocks.clientOffersDelete.mockImplementation(() => Promise.resolve());
    apiMocks.quotesList.mockImplementation(() =>
      Promise.resolve([
        {
          id: 'q1',
          status: 'draft',
          candidates: [
            { id: 'qc-a', state: 'active' },
            { id: 'qc-b', state: 'active' },
          ],
        },
        { id: 'q2', linkedOfferId: 'of-2' },
      ]),
    );
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([{ id: 'of-2' }]));
    apiMocks.clientsOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers();
    ctx.clientOffers.setter([{ id: 'of-1' }, { id: 'of-2' }] as never);
    ctx.quotes.setter([
      {
        id: 'q1',
        status: 'offer',
        linkedOfferId: 'of-1',
        candidates: [
          { id: 'qc-a', state: 'selected' },
          { id: 'qc-b', state: 'discarded' },
        ],
      },
      { id: 'q2', linkedOfferId: 'of-2' },
    ] as never);

    await ctx.handlers.deleteClientOffer('of-1');

    expect(ctx.clientOffers.get()).toEqual([{ id: 'of-2' }]);
    expect(ctx.quotes.get()[0]).toEqual({
      id: 'q1',
      status: 'draft',
      candidates: [
        { id: 'qc-a', state: 'active' },
        { id: 'qc-b', state: 'active' },
      ],
    });
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
      Promise.resolve({
        id: 'or-new',
        ...(data as object),
        supplierOrders: [{ id: 'SORD-2', supplierQuoteId: 'SQ-2', supplierName: 'Supplier 2' }],
      }),
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
    expect(ctx.notifyClientOrderCreated).toHaveBeenCalledWith('or-new');
    expect(ctx.notifySupplierOrderCreated).toHaveBeenCalledWith({
      id: 'SORD-2',
      supplierQuoteId: 'SQ-2',
      supplierName: 'Supplier 2',
    });
    expect(refreshSupplierQuoteFlow).toHaveBeenCalled();
  });

  test('createClientsOrderFromOffer surfaces auto-create warnings', async () => {
    apiMocks.clientsOrdersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({
        id: 'or-new',
        ...(data as object),
        warnings: ['Supplier order not created for supplier quote SQ-1'],
      }),
    );
    const ctx = buildHandlers();

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

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Supplier order not created for supplier quote SQ-1',
    );
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

  test('promoteQuoteCandidate calls the dedicated API, refreshes the flow and notifies', async () => {
    apiMocks.quotesPromote.mockImplementation(() =>
      Promise.resolve({ quote: { id: 'q-1' }, offer: { id: 'of-1' } }),
    );
    apiMocks.quotesList.mockImplementation(() => Promise.resolve([{ id: 'q-1', status: 'offer' }]));
    apiMocks.clientOffersList.mockImplementation(() => Promise.resolve([{ id: 'of-1' }]));
    const ctx = buildHandlers();

    await ctx.handlers.promoteQuoteCandidate('q-1', 'candidate-b');

    expect(apiMocks.quotesPromote).toHaveBeenCalledWith('q-1', 'candidate-b');
    expect(ctx.notifyClientOfferCreated).toHaveBeenCalledWith('of-1');
    expect(ctx.refreshSupplierQuoteFlow).toHaveBeenCalled();
  });

  test('createClientOfferFromLegacyQuote creates and links the missing first offer', async () => {
    apiMocks.clientOffersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'of-legacy', ...(data as object) }),
    );
    const quote = {
      id: 'q-legacy',
      status: 'accepted',
      clientId: 'c1',
      clientName: 'Acme',
      paymentTerms: '30',
      discount: 0,
      expirationDate: '2099-12-31',
      notes: 'Legacy accepted quote',
      items: [{ id: 'item-1', quoteId: 'q-legacy', quantity: 1, unitPrice: 100 }],
    };
    const ctx = buildHandlers({ quotes: [quote] });

    await ctx.handlers.createClientOfferFromLegacyQuote(quote as never);

    expect(apiMocks.clientOffersCreate).toHaveBeenCalledTimes(1);
    const payload = apiMocks.clientOffersCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.linkedQuoteId).toBe('q-legacy');
    expect(payload.status).toBe('draft');
    expect(ctx.clientOffers.get()[0].id).toBe('of-legacy');
    expect(ctx.quotes.get()[0].linkedOfferId).toBe('of-legacy');
    expect(ctx.setActiveView).toHaveBeenCalledWith('sales/client-offers');
    expect(ctx.notifyClientOfferCreated).toHaveBeenCalledWith('of-legacy');
  });

  test('rollbackQuotePromotion reactivates the family through the dedicated API', async () => {
    const ctx = buildHandlers();

    await ctx.handlers.rollbackQuotePromotion('q-1');

    expect(apiMocks.quotesRollbackPromotion).toHaveBeenCalledWith('q-1');
    expect(ctx.refreshSupplierQuoteFlow).toHaveBeenCalled();
  });
});
