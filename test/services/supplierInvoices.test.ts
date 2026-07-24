import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const invoicePayload = {
  id: 'sinv-1',
  supplierId: 'supplier-1',
  supplierName: 'Supplier',
  issueDate: '2026-07-24',
  dueDate: '2026-08-24',
  status: 'draft',
  subtotal: 100,
  total: 100,
  amountPaid: 0,
  createdAt: 1,
  updatedAt: 1,
  items: [],
};

const originalFetch = globalThis.fetch;
const fetchMock = mock(async (_input: unknown, _init?: unknown) =>
  buildResponse({ json: () => invoicePayload }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { supplierInvoicesApi } = await import('../../services/api/supplierInvoices');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => buildResponse({ json: () => invoicePayload }));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('supplierInvoicesApi path segments', () => {
  test('keeps a legacy traversal-shaped invoice id inside its route segment', async () => {
    const invoiceId = '../supplier-orders/SORD-1?force=true#details';
    const encodedId = '..%2Fsupplier-orders%2FSORD-1%3Fforce%3Dtrue%23details';

    await supplierInvoicesApi.update(invoiceId, { notes: 'updated' });
    await supplierInvoicesApi.delete(invoiceId);

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      `/api/accounting/supplier-invoices/${encodedId}`,
      `/api/accounting/supplier-invoices/${encodedId}`,
    ]);
  });
});
