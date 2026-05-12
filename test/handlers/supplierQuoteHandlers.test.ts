import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const apiMocks = {
  supplierOrdersCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'so-new', ...(data as object) }),
  ),
  supplierOrdersList: mock((): Promise<unknown[]> => Promise.resolve([])),
  supplierQuotesList: mock((): Promise<unknown[]> => Promise.resolve([])),
};

mock.module('../../services/api', () => ({
  default: {
    supplierOrders: {
      create: (data: unknown) => apiMocks.supplierOrdersCreate(data),
      list: () => apiMocks.supplierOrdersList(),
    },
    supplierQuotes: {
      list: () => apiMocks.supplierQuotesList(),
    },
    supplierInvoices: {
      list: () => Promise.resolve([]),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

const { makeSupplierQuoteHandlers } = await import('../../hooks/handlers/supplierQuoteHandlers');
type SupplierQuote = import('../../types').SupplierQuote;
type SupplierQuoteItem = import('../../types').SupplierQuoteItem;

const noopSetter = (() => {}) as never;

const baseQuote = (overrides: Partial<SupplierQuote> = {}): SupplierQuote => ({
  id: 'sq-1',
  supplierId: 'sup-1',
  supplierName: 'Supplier One',
  items: [],
  paymentTerms: 'immediate',
  status: 'accepted',
  expirationDate: '2026-12-31',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const baseItem = (overrides: Partial<SupplierQuoteItem> = {}): SupplierQuoteItem => ({
  id: 'sqi-1',
  quoteId: 'sq-1',
  productId: 'prod-1',
  productName: 'Widget',
  quantity: 1,
  unitPrice: 10,
  ...overrides,
});

const makeHandlers = () =>
  makeSupplierQuoteHandlers({
    supplierQuoteFilterId: null,
    setSupplierQuotes: noopSetter,
    setSupplierOrders: noopSetter,
    setSupplierInvoices: noopSetter,
    setSupplierQuoteFilterId: noopSetter,
    setActiveView: noopSetter,
  });

describe('createSupplierOrderFromQuote', () => {
  let alertSpy: ReturnType<typeof mock>;
  let originalAlert: typeof globalThis.alert;

  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
    alertSpy = mock((_msg?: string) => {});
    originalAlert = globalThis.alert;
    globalThis.alert = alertSpy as unknown as typeof globalThis.alert;
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
    globalThis.alert = originalAlert;
  });

  test('passes items with missing productId through as empty string (server coerces to null)', async () => {
    // SupplierQuotesView legitimately creates free-text quote lines without
    // a linked product; the backend canonicalizes missing/empty productId
    // to NULL in the DB. The handler must not block this workflow.
    apiMocks.supplierOrdersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'so-new', ...(data as object), items: [] }),
    );
    const handlers = makeHandlers();
    const quote = baseQuote({
      items: [
        baseItem({ id: 'sqi-1', productId: 'prod-1' }),
        baseItem({ id: 'sqi-2', productId: undefined, productName: 'Free text line' }),
      ],
    });

    await handlers.createSupplierOrderFromQuote(quote);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(apiMocks.supplierOrdersCreate).toHaveBeenCalledTimes(1);
    const payload = (apiMocks.supplierOrdersCreate.mock.calls[0] as [Record<string, unknown>])[0];
    const items = payload.items as Array<{ productId: string }>;
    expect(items).toHaveLength(2);
    expect(items[0].productId).toBe('prod-1');
    expect(items[1].productId).toBe('');
  });

  test('creates the order with all productIds when every item has one', async () => {
    apiMocks.supplierOrdersCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'so-new', ...(data as object), items: [] }),
    );
    const handlers = makeHandlers();
    const quote = baseQuote({
      items: [
        baseItem({ id: 'sqi-1', productId: 'prod-1' }),
        baseItem({ id: 'sqi-2', productId: 'prod-2' }),
      ],
    });

    await handlers.createSupplierOrderFromQuote(quote);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(apiMocks.supplierOrdersCreate).toHaveBeenCalledTimes(1);
    const payload = (apiMocks.supplierOrdersCreate.mock.calls[0] as [Record<string, unknown>])[0];
    const items = payload.items as Array<{ productId: string }>;
    expect(items).toHaveLength(2);
    expect(items[0].productId).toBe('prod-1');
    expect(items[1].productId).toBe('prod-2');
    for (const item of items) {
      expect(item.productId).not.toBe('');
    }
  });
});
