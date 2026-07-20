import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const offerPayload = {
  id: 'off-1',
  linkedQuoteId: 'quote-1',
  clientId: 'client-1',
  clientName: 'Client',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  deliveryDate: null,
  expirationDate: '2999-12-31',
  createdAt: 1,
  updatedAt: 1,
  items: [],
};

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> =>
    buildResponse({ json: () => offerPayload }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { clientOffersApi } = await import('../../services/api/clientOffers');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => buildResponse({ json: () => offerPayload }));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('clientOffersApi path segments', () => {
  test('keeps legacy traversal-shaped offer and version ids inside their route segments', async () => {
    const offerId = '../../clients/victim?scope=all#details';
    const versionId = '../restore?admin=true#now';
    const encodedOfferId = '..%2F..%2Fclients%2Fvictim%3Fscope%3Dall%23details';
    const encodedVersionId = '..%2Frestore%3Fadmin%3Dtrue%23now';

    await clientOffersApi.update(offerId, { notes: 'updated' });
    await clientOffersApi.revertToDraft(offerId, 'reason');
    await clientOffersApi.delete(offerId);
    await clientOffersApi.listVersions(offerId);
    await clientOffersApi.getVersion(offerId, versionId);
    await clientOffersApi.restoreVersion(offerId, versionId);

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      `/api/sales/client-offers/${encodedOfferId}`,
      `/api/sales/client-offers/${encodedOfferId}/revert-to-draft`,
      `/api/sales/client-offers/${encodedOfferId}`,
      `/api/sales/client-offers/${encodedOfferId}/versions`,
      `/api/sales/client-offers/${encodedOfferId}/versions/${encodedVersionId}`,
      `/api/sales/client-offers/${encodedOfferId}/versions/${encodedVersionId}/restore`,
    ]);
  });
});
