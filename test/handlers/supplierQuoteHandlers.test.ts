import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ApiErrorStub } from '../helpers/apiErrorStub';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

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

const toastErrorMock = mock((_message: string) => {});

mock.module('../../utils/toast', () => ({
  toastError: (message: string) => toastErrorMock(message),
  toastSuccess: () => {},
  toast: { error: () => {}, success: () => {}, info: () => {} },
}));

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
  ApiError: ApiErrorStub,
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

clearSpyStateAfterAll();

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
  const initialFilterId =
    typeof overrides.supplierQuoteFilterId === 'string' || overrides.supplierQuoteFilterId === null
      ? (overrides.supplierQuoteFilterId as string | null)
      : null;
  const supplierQuoteFilterId = makeStubScalar<string | null>(initialFilterId);
  const setActiveView = mock(() => {});
  // Pull out raw-value override (test-only convenience) before spreading so it
  // does not leak into the factory deps shape.
  const { supplierQuoteFilterId: _initial, ...factoryOverrides } = overrides;
  const handlers = makeSupplierQuoteHandlers({
    // Backed by a closure over the stub so tests can mutate the value mid-test
    // and observe the getter pattern (mirrors the ref-backed App.tsx getter).
    getSupplierQuoteFilterId: () => supplierQuoteFilterId.get(),
    setSupplierQuotes: supplierQuotes.setter as never,
    setSupplierOrders: supplierOrders.setter as never,
    setSupplierInvoices: supplierInvoices.setter as never,
    setSupplierQuoteFilterId: supplierQuoteFilterId.setter as never,
    setActiveView: setActiveView as never,
    ...(factoryOverrides as Record<string, never>),
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
  console.error = mock(() => {}) as unknown as typeof console.error;
  return () => {
    console.error = originalError;
  };
};

describe('makeSupplierQuoteHandlers', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
    toastErrorMock.mockClear();
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

    const created = await ctx.handlers.addSupplierQuote({ status: 'draft' } as never);
    expect(ctx.supplierQuotes.get()).toEqual([{ id: 'sq-new', status: 'draft' }]);
    // The created quote is returned so the modal can upload files staged during creation to it.
    expect(created).toEqual({ id: 'sq-new', status: 'draft' } as never);
  });

  test('addSupplierQuote rethrows api error', async () => {
    apiMocks.supplierQuotesCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.addSupplierQuote({} as never)).rejects.toThrow('boom');
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
    expect(ctx.supplierQuoteFilterId.get()).toBe('sq-other');
  });

  test('updateSupplierQuote rethrows api error', async () => {
    apiMocks.supplierQuotesUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.updateSupplierQuote('sq-1', {} as never)).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('updateSupplierQuote reads filter via getter at call time, not capture time', async () => {
    // Factory is created with filter=null. The buggy version captured that
    // null value and would never re-apply the filter even after the user
    // navigated to a filtered view. The getter must observe the current value
    // at invocation time.
    apiMocks.supplierQuotesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id: `${id}-v2`, ...(updates as object) }),
    );
    apiMocks.supplierQuotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.supplierOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers({ supplierQuoteFilterId: null });

    // After factory creation, user pins the filter to the quote we'll update.
    ctx.supplierQuoteFilterId.setter('sq-1' as never);

    await ctx.handlers.updateSupplierQuote('sq-1', { status: 'sent' } as never);

    // Filter must have followed the new id — proof the getter was read at
    // invocation time, not at factory creation.
    expect(ctx.supplierQuoteFilterId.get()).toBe('sq-1-v2');
  });

  test('updateSupplierQuote does NOT re-apply filter that was cleared during await', async () => {
    let resolver: () => void = () => {};
    apiMocks.supplierQuotesUpdate.mockImplementation(
      (id: string, updates: unknown) =>
        new Promise((resolve) => {
          resolver = () => resolve({ id: `${id}-v2`, ...(updates as object) } as never);
        }),
    );
    apiMocks.supplierQuotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.supplierOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers({ supplierQuoteFilterId: 'sq-1' });

    // Kick off the update; do NOT await yet.
    const pending = ctx.handlers.updateSupplierQuote('sq-1', { status: 'sent' } as never);

    // Simulate the user navigating away mid-await (App.tsx clears filter).
    ctx.supplierQuoteFilterId.setter(null as never);

    resolver();
    await pending;

    // The handler must respect the cleared filter. The buggy version would
    // have re-applied 'sq-1-v2'.
    expect(ctx.supplierQuoteFilterId.get()).toBe(null);
  });

  test('deleteSupplierQuote removes from list', async () => {
    apiMocks.supplierQuotesDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers();
    ctx.supplierQuotes.setter([{ id: 'sq-1' }, { id: 'sq-2' }] as never);

    await ctx.handlers.deleteSupplierQuote('sq-1');
    expect(ctx.supplierQuotes.get()).toEqual([{ id: 'sq-2' }]);
  });

  test('deleteSupplierQuote rethrows api error', async () => {
    apiMocks.supplierQuotesDelete.mockImplementation(() => Promise.reject(new Error('nope')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.deleteSupplierQuote('sq-1')).rejects.toThrow('nope');
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
      items: [
        {
          productId: 'p1',
          quantity: 1,
          listPrice: 12.5,
          discountPercent: 20,
          unitPrice: 10,
          unitType: 'days',
        },
      ],
    };

    await ctx.handlers.createSupplierOrderFromQuote(quote as never);

    expect(apiMocks.supplierOrdersCreate).toHaveBeenCalled();
    const callArg = apiMocks.supplierOrdersCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.linkedQuoteId).toBe('sq-1');
    expect(callArg.supplierId).toBe('sup-1');
    expect(callArg.status).toBe('draft');
    expect(callArg.items).toEqual([
      expect.objectContaining({ unitPrice: 12.5, discount: 20, unitType: 'days' }),
    ]);
    expect(ctx.supplierQuoteFilterId.get()).toBe('sq-1');
    expect(ctx.setActiveView).toHaveBeenCalledWith('accounting/supplier-orders');
    expect(ctx.supplierQuotes.get()).toEqual([{ id: 'sq-1' }]);
  });

  test('createSupplierOrderFromQuote preserves an explicit synced net cost', async () => {
    apiMocks.supplierOrdersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'so-new', ...(data as object) }),
    );
    apiMocks.supplierQuotesList.mockImplementation(() => Promise.resolve([]));
    apiMocks.supplierOrdersList.mockImplementation(() => Promise.resolve([]));
    const ctx = buildHandlers();

    await ctx.handlers.createSupplierOrderFromQuote({
      id: 'sq-1',
      supplierId: 'sup-1',
      supplierName: 'Acme',
      paymentTerms: '30',
      items: [
        {
          listPrice: 37.75,
          discountPercent: 15,
          unitPrice: 32.09,
          quantity: 150,
        },
      ],
    } as never);

    const callArg = apiMocks.supplierOrdersCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.items).toEqual([
      expect.objectContaining({ unitPrice: 32.09, discount: 0, quantity: 150 }),
    ]);
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

  test('createSupplierOrderFromQuote toasts on create error', async () => {
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
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock.mock.calls[0][0]).toBe('boom');
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
