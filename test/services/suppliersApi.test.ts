import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input?: unknown, _init?: unknown): Promise<unknown> => buildResponse({ status: 204 }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { suppliersApi } = await import('../../services/api/suppliers');

beforeEach(() => {
  fetchMock.mockReset();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('suppliersApi.createBulk', () => {
  test('posts the bulk envelope and normalizes only successful supplier results', async () => {
    fetchMock.mockImplementationOnce(async (input?: unknown, init?: unknown) => {
      expect(input).toBe('/api/suppliers/bulk');
      expect(init).toEqual(
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            suppliers: [{ supplierCode: 'SUP-1', name: 'Alpha', vatNumber: 'IT1' }],
          }),
        }),
      );
      return buildResponse({
        status: 200,
        json: () => ({
          summary: { total: 2, succeeded: 1, failed: 1 },
          results: [
            {
              index: 0,
              success: true,
              supplier: { id: 's1', name: 'Alpha', createdAt: '2026-01-02T00:00:00.000Z' },
            },
            {
              index: 1,
              success: false,
              errors: [{ code: 'duplicate', message: 'Duplicate' }],
            },
          ],
        }),
      });
    });

    const response = await suppliersApi.createBulk([
      { supplierCode: 'SUP-1', name: 'Alpha', vatNumber: 'IT1' },
    ]);

    expect(response.results.map((result) => result.index)).toEqual([0, 1]);
    expect(response.results[0]).toEqual(
      expect.objectContaining({
        success: true,
        supplier: expect.objectContaining({ id: 's1', name: 'Alpha' }),
      }),
    );
    expect(response.results[1]).toEqual(expect.objectContaining({ index: 1, success: false }));
  });
});
