import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const orderPayload = {
  id: 'order-1',
  clientId: 'client-1',
  clientName: 'Client',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  createdAt: 1,
  updatedAt: 1,
  items: [],
};

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> =>
    buildResponse({ json: () => orderPayload }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { clientsOrdersApi } = await import('../../services/api/clientsOrders');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => buildResponse({ json: () => orderPayload }));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('clientsOrdersApi path segments', () => {
  test('keeps traversal-shaped order and version ids inside their route segments', async () => {
    const orderId = '../supplier-orders/SORD-1?scope=all#details';
    const versionId = '../restore?admin=true#now';
    const encodedOrderId = '..%2Fsupplier-orders%2FSORD-1%3Fscope%3Dall%23details';
    const encodedVersionId = '..%2Frestore%3Fadmin%3Dtrue%23now';

    await clientsOrdersApi.update(orderId, { notes: 'updated' });
    await clientsOrdersApi.delete(orderId);
    await clientsOrdersApi.listVersions(orderId);
    await clientsOrdersApi.getVersion(orderId, versionId);
    await clientsOrdersApi.restoreVersion(orderId, versionId);

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      `/api/clients-orders/${encodedOrderId}`,
      `/api/clients-orders/${encodedOrderId}`,
      `/api/clients-orders/${encodedOrderId}/versions`,
      `/api/clients-orders/${encodedOrderId}/versions/${encodedVersionId}`,
      `/api/clients-orders/${encodedOrderId}/versions/${encodedVersionId}/restore`,
    ]);
  });
});
