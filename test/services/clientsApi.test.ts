import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input?: unknown, _init?: unknown): Promise<unknown> => buildResponse({ status: 204 }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { clientsApi } = await import('../../services/api/clients');

beforeEach(() => {
  fetchMock.mockReset();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('clientsApi.createBulk', () => {
  test('posts the bulk envelope and preserves indexes while normalizing successful clients', async () => {
    fetchMock.mockImplementationOnce(async (_input?: unknown, init?: unknown) => {
      expect(_input).toBe('/api/clients/bulk');
      expect(init).toEqual(
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            clients: [{ clientCode: 'CLI-1', name: 'Alpha', fiscalCode: 'IT1' }],
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
              client: { id: 'c1', name: 'Alpha', createdAt: '2026-01-02T00:00:00.000Z' },
            },
            {
              index: 1,
              success: false,
              errors: [{ code: 'invalid', message: 'Invalid row' }],
            },
          ],
        }),
      });
    });

    const response = await clientsApi.createBulk([
      { clientCode: 'CLI-1', name: 'Alpha', fiscalCode: 'IT1' },
    ]);

    expect(response.results.map((result) => result.index)).toEqual([0, 1]);
    expect(response.results[0]).toEqual(
      expect.objectContaining({
        success: true,
        client: expect.objectContaining({ id: 'c1', name: 'Alpha' }),
      }),
    );
    expect(response.results[1]).toEqual(expect.objectContaining({ index: 1, success: false }));
  });
});
