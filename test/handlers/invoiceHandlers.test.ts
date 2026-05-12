import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const apiMocks = {
  invoicesCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'inv-new', ...(data as object) }),
  ),
  invoicesUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  invoicesDelete: mock((_id: string): Promise<void> => Promise.resolve()),
};

mock.module('../../services/api', () => ({
  default: {
    invoices: {
      create: (data: unknown) => apiMocks.invoicesCreate(data),
      update: (id: string, updates: unknown) => apiMocks.invoicesUpdate(id, updates),
      delete: (id: string) => apiMocks.invoicesDelete(id),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

const { makeInvoiceHandlers } = await import('../../hooks/handlers/invoiceHandlers');

type InvoiceLike = { id: string; status?: string; total?: number };

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

const silenceConsole = () => {
  const original = console.error;
  console.error = mock(() => {}) as unknown as typeof console.error;
  return () => {
    console.error = original;
  };
};

describe('makeInvoiceHandlers', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
  });

  test('add appends invoice to list', async () => {
    apiMocks.invoicesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'inv-new', ...(data as object) }),
    );
    const invoices = makeStubSetter<InvoiceLike>([{ id: 'inv-1' }]);
    const handlers = makeInvoiceHandlers({ setInvoices: invoices.setter });

    await handlers.add({ status: 'draft' } as never);
    expect(apiMocks.invoicesCreate).toHaveBeenCalledWith({ status: 'draft' });
    expect(invoices.get()).toEqual([{ id: 'inv-1' }, { id: 'inv-new', status: 'draft' }]);
  });

  test('add swallows errors', async () => {
    apiMocks.invoicesCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const invoices = makeStubSetter<InvoiceLike>([]);
    const handlers = makeInvoiceHandlers({ setInvoices: invoices.setter });

    const restore = silenceConsole();
    try {
      await handlers.add({ status: 'draft' } as never);
      expect(invoices.get()).toEqual([]);
    } finally {
      restore();
    }
  });

  test('update replaces matching invoice', async () => {
    apiMocks.invoicesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    const invoices = makeStubSetter<InvoiceLike>([
      { id: 'inv-1', status: 'draft' },
      { id: 'inv-2', status: 'sent' },
    ]);
    const handlers = makeInvoiceHandlers({ setInvoices: invoices.setter });

    await handlers.update('inv-1', { status: 'paid' } as never);
    expect(invoices.get()[0]).toEqual({ id: 'inv-1', status: 'paid' });
    expect(invoices.get()[1]).toEqual({ id: 'inv-2', status: 'sent' });
  });

  test('update swallows errors', async () => {
    apiMocks.invoicesUpdate.mockImplementation(() => Promise.reject(new Error('nope')));
    const invoices = makeStubSetter<InvoiceLike>([{ id: 'inv-1', status: 'draft' }]);
    const handlers = makeInvoiceHandlers({ setInvoices: invoices.setter });

    const restore = silenceConsole();
    try {
      await handlers.update('inv-1', { status: 'paid' } as never);
      expect(invoices.get()).toEqual([{ id: 'inv-1', status: 'draft' }]);
    } finally {
      restore();
    }
  });

  test('delete removes matching invoice', async () => {
    apiMocks.invoicesDelete.mockImplementation(() => Promise.resolve());
    const invoices = makeStubSetter<InvoiceLike>([{ id: 'inv-1' }, { id: 'inv-2' }]);
    const handlers = makeInvoiceHandlers({ setInvoices: invoices.setter });

    await handlers.delete('inv-1');
    expect(apiMocks.invoicesDelete).toHaveBeenCalledWith('inv-1');
    expect(invoices.get()).toEqual([{ id: 'inv-2' }]);
  });

  test('delete swallows errors', async () => {
    apiMocks.invoicesDelete.mockImplementation(() => Promise.reject(new Error('fail')));
    const invoices = makeStubSetter<InvoiceLike>([{ id: 'inv-1' }]);
    const handlers = makeInvoiceHandlers({ setInvoices: invoices.setter });

    const restore = silenceConsole();
    try {
      await handlers.delete('inv-1');
      expect(invoices.get()).toEqual([{ id: 'inv-1' }]);
    } finally {
      restore();
    }
  });
});
