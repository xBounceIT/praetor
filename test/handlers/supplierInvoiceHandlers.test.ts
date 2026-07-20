import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ApiErrorStub } from '../helpers/apiErrorStub';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

const apiMocks = {
  supplierInvoicesUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  supplierInvoicesDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  supplierInvoicesCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'si-new', ...(data as object) }),
  ),
};

const toastErrorMock = mock((_message: string) => {});

mock.module('../../utils/toast', () => ({
  toastError: (message: string) => toastErrorMock(message),
  toastSuccess: () => {},
  toast: { error: () => {}, success: () => {}, info: () => {} },
}));

mock.module('../../services/api', () => ({
  default: {
    supplierInvoices: {
      update: (id: string, updates: unknown) => apiMocks.supplierInvoicesUpdate(id, updates),
      delete: (id: string) => apiMocks.supplierInvoicesDelete(id),
      create: (data: unknown) => apiMocks.supplierInvoicesCreate(data),
    },
  },
  ApiError: ApiErrorStub,
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

clearSpyStateAfterAll();

const { makeSupplierInvoiceHandlers } = await import(
  '../../hooks/handlers/supplierInvoiceHandlers'
);

type SupplierInvoiceLike = {
  id: string;
  status?: string;
  supplierId?: string;
  total?: number;
};

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
  const originalError = console.error;
  console.error = mock(() => {}) as unknown as typeof console.error;
  toastErrorMock.mockClear();
  return () => {
    console.error = originalError;
  };
};

describe('makeSupplierInvoiceHandlers', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
  });

  test('update replaces matching invoice', async () => {
    apiMocks.supplierInvoicesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    const invoices = makeStubSetter<SupplierInvoiceLike>([
      { id: 'si-1', status: 'draft' },
      { id: 'si-2', status: 'sent' },
    ]);
    const setActiveView = mock(() => {}) as never;
    const handlers = makeSupplierInvoiceHandlers({
      setSupplierInvoices: invoices.setter,
      setActiveView,
    });

    await handlers.update('si-1', { status: 'paid' } as never);
    expect(invoices.get()[0]).toEqual({ id: 'si-1', status: 'paid' });
    expect(invoices.get()[1]).toEqual({ id: 'si-2', status: 'sent' });
  });

  test('update rethrows on api error', async () => {
    apiMocks.supplierInvoicesUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const handlers = makeSupplierInvoiceHandlers({
      setSupplierInvoices: makeStubSetter<SupplierInvoiceLike>([]).setter,
      setActiveView: mock(() => {}) as never,
    });

    const restore = silenceConsole();
    try {
      await expect(handlers.update('si-1', {} as never)).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('delete removes matching invoice', async () => {
    apiMocks.supplierInvoicesDelete.mockImplementation(() => Promise.resolve());
    const invoices = makeStubSetter<SupplierInvoiceLike>([{ id: 'si-1' }, { id: 'si-2' }]);
    const handlers = makeSupplierInvoiceHandlers({
      setSupplierInvoices: invoices.setter,
      setActiveView: mock(() => {}) as never,
    });

    await handlers.delete('si-1');
    expect(apiMocks.supplierInvoicesDelete).toHaveBeenCalledWith('si-1');
    expect(invoices.get()).toEqual([{ id: 'si-2' }]);
  });

  test('delete rethrows on api error', async () => {
    apiMocks.supplierInvoicesDelete.mockImplementation(() => Promise.reject(new Error('nope')));
    const handlers = makeSupplierInvoiceHandlers({
      setSupplierInvoices: makeStubSetter<SupplierInvoiceLike>([]).setter,
      setActiveView: mock(() => {}) as never,
    });

    const restore = silenceConsole();
    try {
      await expect(handlers.delete('si-1')).rejects.toThrow('nope');
    } finally {
      restore();
    }
  });

  test('createFromOrder builds invoice with computed totals and switches view', async () => {
    apiMocks.supplierInvoicesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'si-new', ...(data as object) }),
    );
    const invoices = makeStubSetter<SupplierInvoiceLike>([{ id: 'si-existing' }]);
    const setActiveView = mock(() => {});
    const handlers = makeSupplierInvoiceHandlers({
      setSupplierInvoices: invoices.setter,
      setActiveView: setActiveView as never,
    });

    const order = {
      id: 'order-1',
      supplierId: 'sup-1',
      supplierName: 'Acme',
      paymentTerms: '45 days',
      notes: 'note',
      items: [
        {
          productId: 'p1',
          productName: 'Widget',
          quantity: 2,
          unitPrice: 100,
          discount: 10,
          legacyDiscountRounding: true,
        },
        {
          productId: 'p2',
          productName: 'Gadget',
          quantity: 3,
          unitPrice: 50,
          // no discount → defaults to 0
        },
      ],
    };

    await handlers.createFromOrder(order as never);

    expect(apiMocks.supplierInvoicesCreate).toHaveBeenCalledTimes(1);
    const callArg = apiMocks.supplierInvoicesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.linkedSaleId).toBe('order-1');
    expect(callArg.supplierId).toBe('sup-1');
    expect(callArg.supplierName).toBe('Acme');
    expect(callArg.status).toBe('draft');
    // 2*100*(1-0.10) + 3*50 = 180 + 150 = 330
    expect(callArg.subtotal).toBe(330);
    expect(callArg.total).toBe(330);
    expect(callArg.amountPaid).toBe(0);
    expect(callArg.notes).toBe('note');
    expect(callArg.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(callArg.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const items = callArg.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0].discount).toBe(10);
    expect(items[0].legacyDiscountRounding).toBe(true);
    expect(items[1].discount).toBe(0);

    expect(invoices.get()[0].id).toBe('si-new');
    expect(setActiveView).toHaveBeenCalledWith('accounting/supplier-invoices');
  });

  test('createFromOrder carries the line duration and scales the total by it (issue #776/#775)', async () => {
    apiMocks.supplierInvoicesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'si-new', ...(data as object) }),
    );
    const handlers = makeSupplierInvoiceHandlers({
      setSupplierInvoices: makeStubSetter<SupplierInvoiceLike>([]).setter,
      setActiveView: mock(() => {}) as never,
    });

    await handlers.createFromOrder({
      id: 'order-dur',
      supplierId: 'sup-1',
      supplierName: 'Acme',
      paymentTerms: '30',
      notes: '',
      items: [
        // 12-month service: the invoice total must reflect the duration → 2 * 100 * 12 = 2400,
        // not 200 (the pre-fix bug that underbilled by the duration multiplier).
        {
          productId: 'p1',
          productName: 'Service',
          quantity: 2,
          unitPrice: 100,
          discount: 0,
          durationMonths: 12,
          durationUnit: 'months',
        },
        // N/A line: never multiplies regardless of the stored months → 1 * 50 * 1 = 50.
        {
          productId: 'p2',
          productName: 'Widget',
          quantity: 1,
          unitPrice: 50,
          discount: 0,
          durationMonths: 6,
          durationUnit: 'na',
        },
      ],
    } as never);

    const callArg = apiMocks.supplierInvoicesCreate.mock.calls[0][0] as Record<string, unknown>;
    // 2*100*12 + 1*50*1 = 2400 + 50 = 2450
    expect(callArg.subtotal).toBe(2450);
    expect(callArg.total).toBe(2450);
    const items = callArg.items as Array<Record<string, unknown>>;
    expect(items[0]).toEqual(
      expect.objectContaining({ durationMonths: 12, durationUnit: 'months' }),
    );
    expect(items[1]).toEqual(expect.objectContaining({ durationMonths: 6, durationUnit: 'na' }));
  });

  test('createFromOrder rounds the document total only after applying discount and quantity', async () => {
    apiMocks.supplierInvoicesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'si-new', ...(data as object) }),
    );
    const handlers = makeSupplierInvoiceHandlers({
      setSupplierInvoices: makeStubSetter<SupplierInvoiceLike>([]).setter,
      setActiveView: mock(() => {}) as never,
    });

    await handlers.createFromOrder({
      id: 'order-rounding',
      supplierId: 'sup-1',
      supplierName: 'Acme',
      paymentTerms: '30',
      notes: '',
      items: [
        {
          productId: 'p1',
          productName: 'Service',
          quantity: 150,
          unitPrice: 37.75,
          discount: 15,
          durationMonths: 1,
          durationUnit: 'months',
        },
      ],
    } as never);

    const callArg = apiMocks.supplierInvoicesCreate.mock.calls[0][0] as Record<string, unknown>;
    // 37.75 * 85% * 150 = 4813.125, rounded once at the invoice boundary.
    expect(callArg.subtotal).toBe(4813.13);
    expect(callArg.total).toBe(4813.13);
  });

  test('createFromOrder defaults paymentTerms to 30 days when missing', async () => {
    apiMocks.supplierInvoicesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'si-new', ...(data as object) }),
    );
    const handlers = makeSupplierInvoiceHandlers({
      setSupplierInvoices: makeStubSetter<SupplierInvoiceLike>([]).setter,
      setActiveView: mock(() => {}) as never,
    });

    await handlers.createFromOrder({
      id: 'order-1',
      supplierId: 's1',
      supplierName: 'S',
      paymentTerms: undefined,
      notes: '',
      items: [],
    } as never);

    expect(apiMocks.supplierInvoicesCreate).toHaveBeenCalled();
    const callArg = apiMocks.supplierInvoicesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.subtotal).toBe(0);
    expect(callArg.total).toBe(0);
  });

  test('createFromOrder surfaces error via toast and swallows on api error', async () => {
    apiMocks.supplierInvoicesCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const invoices = makeStubSetter<SupplierInvoiceLike>([{ id: 'si-existing' }]);
    const setActiveView = mock(() => {});
    const handlers = makeSupplierInvoiceHandlers({
      setSupplierInvoices: invoices.setter,
      setActiveView: setActiveView as never,
    });

    const restore = silenceConsole();
    try {
      await handlers.createFromOrder({
        id: 'o',
        supplierId: 's',
        supplierName: 'S',
        paymentTerms: '30',
        notes: '',
        items: [],
      } as never);
      expect(invoices.get()).toEqual([{ id: 'si-existing' }]);
      expect(setActiveView).not.toHaveBeenCalled();
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect((toastErrorMock.mock.calls[0]?.[0] as string) ?? '').toContain('boom');
    } finally {
      restore();
    }
  });
});
