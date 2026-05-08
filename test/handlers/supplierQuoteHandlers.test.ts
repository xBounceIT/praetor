import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const apiMocks = {
  supplierQuotesList: mock((): Promise<unknown[]> => Promise.resolve([])),
  supplierQuotesCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'sq-new', ...(data as object) }),
  ),
  supplierQuotesUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  supplierQuotesDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  supplierOrdersList: mock((): Promise<unknown[]> => Promise.resolve([])),
  supplierOrdersCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'so-new', ...(data as object) }),
  ),
  supplierOrdersUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  supplierOrdersDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  supplierInvoicesList: mock((): Promise<unknown[]> => Promise.resolve([])),
};

mock.module('../../services/api', () => ({
  default: {
    supplierQuotes: {
      list: () => apiMocks.supplierQuotesList(),
      create: (data: unknown) => apiMocks.supplierQuotesCreate(data),
      update: (id: string, updates: unknown) => apiMocks.supplierQuotesUpdate(id, updates),
      delete: (id: string) => apiMocks.supplierQuotesDelete(id),
    },
    supplierOrders: {
      list: () => apiMocks.supplierOrdersList(),
      create: (data: unknown) => apiMocks.supplierOrdersCreate(data),
      update: (id: string, updates: unknown) => apiMocks.supplierOrdersUpdate(id, updates),
      delete: (id: string) => apiMocks.supplierOrdersDelete(id),
    },
    supplierInvoices: {
      list: () => apiMocks.supplierInvoicesList(),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

const { makeSupplierQuoteHandlers } = await import('../../hooks/handlers/supplierQuoteHandlers');

type SupplierQuoteLike = { id: string; status?: string; supplierId?: string };
type SupplierOrderLike = { id: string; status?: string };
type SupplierInvoiceLike = { id: string };

type AnyFn = (...args: unknown[]) => void;
const makeStubSetter = <T>(initial: T[]) => {
  let value = initial;
  const setter = ((updater: T[] | ((prev: T[]) => T[])) => {
    value = typeof updater === 'function' ? (updater as (prev: T[]) => T[])(value) : updater;
  }) as AnyFn;
  return {
    setter,
    get: () => value,
  };
};

const makeStubScalar = <T>(initial: T) => {
  let value = initial;
  const setter = ((updater: T | ((prev: T) => T)) => {
    value = typeof updater === 'function' ? (updater as (prev: T) => T)(value) : updater;
  }) as AnyFn;
  return {
    setter,
    get: () => value,
  };
};

const buildHandlers = (overrides: Record<string, unknown> = {}) => {
  const supplierQuotes = makeStubSetter<SupplierQuoteLike>([]);
  const supplierOrders = makeStubSetter<SupplierOrderLike>([]);
  const supplierInvoices = makeStubSetter<SupplierInvoiceLike>([]);
  const supplierQuoteFilterId = makeStubScalar<string | null>(null);
  const setActiveView = mock(() => {});
  const handlers = makeSupplierQuoteHandlers({
    supplierQuoteFilterId: supplierQuoteFilterId.get(),
    setSupplierQuotes: supplierQuotes.setter as never,
    setSupplierOrders: supplierOrders.setter as never,
    setSupplierInvoices: supplierInvoices.setter as never,
    setSupplierQuoteFilterId: supplierQuoteFilterId.setter as never,
    setActiveView: setActiveView as never,
    ...overrides,
  });
  return {
    handlers,
    supplierQuotes,
    supplierOrders,
    supplierInvoices,
    supplierQuoteFilterId,
    setActiveView,
  };
};

const silenceConsole = () => {
  const originalError = console.error;
  const originalAlert = globalThis.alert;
  console.error = mock(() => {}) as unknown as typeof console.error;
  globalThis.alert = mock(() => {}) as unknown as typeof globalThis.alert;
  return () => {
    console.error = originalError;
    globalThis.alert = originalAlert;
  };
};

describe('makeSupplierQuoteHandlers', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
  });

  test('refreshSupplierQuoteFlow loads quotes and orders', async () => {
    apiMocks.supplierQuotesList.mockImplementation(() => Promise.resolve([{ id: 'sq-fresh' }]));
    apiMocks.supplierOrdersList.mockImplementation(() => Promise.resolve([{ id: 'so-fresh' }]));
    const ctx = buildHandlers();

    await ctx.handlers.refreshSupplierQuoteFlow();

    expect(ctx.supplierQuotes.get()).toEqual([{ id: 'sq-fresh' }]);
    expect(ctx.supplierOrders.get()).toEqual([{ id: 'so-fresh' }]);
  });

  test('refreshSupplierOrderFlow loads orders and invoices', async () => {
    apiMocks.supplierOrdersList.mockImplementation(() => Promise.resolve([{ id: 'so-fresh' }]));
    apiMocks.supplierInvoicesList.mockImplementation(() => Promise.resolve([{ id: 'si-fresh' }]));
    const ctx = buildHandlers();

    await ctx.handlers.refreshSupplierOrderFlow();
    expect(ctx.supplierOrders.get()).toEqual([{ id: 'so-fresh' }]);
    expect(ctx.supplierInvoices.get()).toEqual([{ id: 'si-fresh' }]);
  });

  test('addSupplierQuote appends to list', async () => {
    apiMocks.supplierQuotesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'sq-new', ...(data as object) }),
    );
    const ctx = buildHandlers();

    await ctx.handlers.addSupplierQuote({ status: 'draft' } as never);
    expect(ctx.supplierQuotes.get()).toEqual([{ id: 'sq-new', status: 'draft' }]);
  });

  test('addSupplierQuote swallows errors', async () => {
    apiMocks.supplierQuotesCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await ctx.handlers.addSupplierQuote({} as never);
      expect(ctx.supplierQuotes.get()).toEqual([]);
    } finally {
      restore();
    }
  });

  test('updateSupplierQuote refreshes flow and updates filter when matched', async () => {
    apiMocks.supplierQuotesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    apiMocks.supplierQuotesList.mockImplementation(() => Promise.resolve([{ id: 'sq-1' }]));
    apiMocks.supplierOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers({ supplierQuoteFilterId: 'sq-1' });

    await ctx.handlers.updateSupplierQuote('sq-1', { status: 'sent' } as never);
    expect(ctx.supplierQuoteFilterId.get()).toBe('sq-1');
    expect(ctx.supplierQuotes.get()).toEqual([{ id: 'sq-1' }]);
  });

  test('updateSupplierQuote does not change filter when ids differ', async () => {
    apiMocks.supplierQuotesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    apiMocks.supplierQuotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.supplierOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers({ supplierQuoteFilterId: 'sq-other' });

    await ctx.handlers.updateSupplierQuote('sq-1', { status: 'sent' } as never);
    expect(ctx.supplierQuoteFilterId.get()).toBeNull();
  });

  test('updateSupplierQuote swallows errors', async () => {
    apiMocks.supplierQuotesUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await ctx.handlers.updateSupplierQuote('sq-1', {} as never);
    } finally {
      restore();
    }
  });

  test('deleteSupplierQuote removes from list', async () => {
    apiMocks.supplierQuotesDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers();
    ctx.supplierQuotes.setter([{ id: 'sq-1' }, { id: 'sq-2' }] as never);

    await ctx.handlers.deleteSupplierQuote('sq-1');
    expect(ctx.supplierQuotes.get()).toEqual([{ id: 'sq-2' }]);
  });

  test('deleteSupplierQuote swallows errors', async () => {
    apiMocks.supplierQuotesDelete.mockImplementation(() => Promise.reject(new Error('nope')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await ctx.handlers.deleteSupplierQuote('sq-1');
    } finally {
      restore();
    }
  });

  test('updateSupplierOrder refreshes order flow', async () => {
    apiMocks.supplierOrdersUpdate.mockImplementation(() => Promise.resolve({}));
    apiMocks.supplierOrdersList.mockImplementation(() => Promise.resolve([{ id: 'so-fresh' }]));
    apiMocks.supplierInvoicesList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers();

    await ctx.handlers.updateSupplierOrder('so-1', { status: 'confirmed' } as never);
    expect(ctx.supplierOrders.get()).toEqual([{ id: 'so-fresh' }]);
  });

  test('updateSupplierOrder rethrows on api error', async () => {
    apiMocks.supplierOrdersUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.updateSupplierOrder('so-1', {} as never)).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('deleteSupplierOrder removes order from list', async () => {
    apiMocks.supplierOrdersDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers();
    ctx.supplierOrders.setter([{ id: 'so-1' }, { id: 'so-2' }] as never);

    await ctx.handlers.deleteSupplierOrder('so-1');
    expect(ctx.supplierOrders.get()).toEqual([{ id: 'so-2' }]);
  });

  test('deleteSupplierOrder rethrows on api error', async () => {
    apiMocks.supplierOrdersDelete.mockImplementation(() => Promise.reject(new Error('nope')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.deleteSupplierOrder('so-1')).rejects.toThrow('nope');
    } finally {
      restore();
    }
  });

  test('createSupplierOrderFromQuote creates order, sets filter, switches view, refreshes', async () => {
    apiMocks.supplierOrdersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'so-new', ...(data as object) }),
    );
    apiMocks.supplierQuotesList.mockImplementation(() => Promise.resolve([{ id: 'sq-1' }]));
    apiMocks.supplierOrdersList.mockImplementation(() => Promise.resolve([{ id: 'so-new' }]));
    const ctx = buildHandlers();

    const quote = {
      id: 'sq-1',
      supplierId: 'sup-1',
      supplierName: 'Acme',
      paymentTerms: '30',
      notes: 'note',
      items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }],
    };

    await ctx.handlers.createSupplierOrderFromQuote(quote as never);

    expect(apiMocks.supplierOrdersCreate).toHaveBeenCalled();
    const callArg = apiMocks.supplierOrdersCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.linkedQuoteId).toBe('sq-1');
    expect(callArg.supplierId).toBe('sup-1');
    expect(callArg.status).toBe('draft');
    expect(ctx.supplierQuoteFilterId.get()).toBe('sq-1');
    expect(ctx.setActiveView).toHaveBeenCalledWith('accounting/supplier-orders');
    expect(ctx.supplierQuotes.get()).toEqual([{ id: 'sq-1' }]);
  });

  test('createSupplierOrderFromQuote handles missing productId by defaulting to empty string', async () => {
    apiMocks.supplierOrdersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'so-new', ...(data as object) }),
    );
    apiMocks.supplierQuotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.supplierOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers();

    await ctx.handlers.createSupplierOrderFromQuote({
      id: 'sq-1',
      supplierId: 's',
      supplierName: 'S',
      paymentTerms: '30',
      notes: '',
      items: [{ quantity: 1, unitPrice: 10 }],
    } as never);

    const callArg = apiMocks.supplierOrdersCreate.mock.calls[0][0] as Record<string, unknown>;
    const items = callArg.items as Array<Record<string, unknown>>;
    expect(items[0].productId).toBe('');
  });

  test('createSupplierOrderFromQuote alerts on create error', async () => {
    apiMocks.supplierOrdersCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await ctx.handlers.createSupplierOrderFromQuote({
        id: 'sq-1',
        supplierId: 's',
        supplierName: 'S',
        paymentTerms: '30',
        notes: '',
        items: [],
      } as never);
      expect(ctx.setActiveView).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test('createSupplierOrderFromQuote swallows refresh errors after success', async () => {
    apiMocks.supplierOrdersCreate.mockImplementation(() => Promise.resolve({ id: 'so-new' }));
    apiMocks.supplierQuotesList.mockImplementation(() => Promise.reject(new Error('refresh-fail')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await ctx.handlers.createSupplierOrderFromQuote({
        id: 'sq-1',
        supplierId: 's',
        supplierName: 'S',
        paymentTerms: '30',
        notes: '',
        items: [],
      } as never);
      expect(ctx.setActiveView).toHaveBeenCalledWith('accounting/supplier-orders');
    } finally {
      restore();
    }
  });
});
