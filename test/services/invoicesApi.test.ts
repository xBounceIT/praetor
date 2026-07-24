import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const originalFetch = globalThis.fetch;
const fetchMock = mock(async (): Promise<unknown> => buildResponse({ status: 204 }));
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { invoicesApi } = await import('../../services/api/invoices');

beforeEach(() => {
  fetchMock.mockReset();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('invoicesApi path construction', () => {
  test('encodes an invoice id as one opaque path segment for updates', async () => {
    fetchMock.mockResolvedValueOnce(
      buildResponse({
        json: () => ({ id: '../clients-orders/ORD-1?', items: [] }),
      }),
    );

    await invoicesApi.update('../clients-orders/ORD-1?', { notes: 'Updated' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/invoices/..%2Fclients-orders%2FORD-1%3F',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('encodes an invoice id as one opaque path segment for deletes', async () => {
    fetchMock.mockResolvedValueOnce(buildResponse({ status: 204 }));

    await invoicesApi.delete('../clients-orders/ORD-1?');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/invoices/..%2Fclients-orders%2FORD-1%3F',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
