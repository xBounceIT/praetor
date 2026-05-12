import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const respondWith = (body: unknown, status = 200) => buildResponse({ status, json: () => body });

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => respondWith({}),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { settingsApi } = await import('../../services/api/settings');
const { setAuthToken } = await import('../../services/api/client');

beforeEach(() => {
  fetchMock.mockReset();
  setAuthToken(null);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('settingsApi personal access token methods', () => {
  test('getPersonalAccessToken fetches the PAT metadata endpoint', async () => {
    fetchMock.mockImplementation(async () =>
      respondWith({
        tokenPrefix: 'praetor_pat_abc12345',
        createdAt: '2026-05-11T08:00:00.000Z',
        updatedAt: '2026-05-11T09:00:00.000Z',
        lastUsedAt: null,
      }),
    );

    const result = await settingsApi.getPersonalAccessToken();

    expect(String(fetchMock.mock.calls[0][0])).toContain('/settings/personal-access-token');
    expect(result.tokenPrefix).toBe('praetor_pat_abc12345');
    expect(result.token).toBeUndefined();
  });

  test('renewPersonalAccessToken POSTs and returns the one-time plaintext token', async () => {
    fetchMock.mockImplementation(async (_input: unknown, init?: unknown) => {
      expect((init as RequestInit).method).toBe('POST');
      return respondWith({
        tokenPrefix: 'praetor_pat_newtoken',
        createdAt: '2026-05-11T08:00:00.000Z',
        updatedAt: '2026-05-11T09:00:00.000Z',
        lastUsedAt: null,
        token: 'praetor_pat_newtoken-secret',
      });
    });

    const result = await settingsApi.renewPersonalAccessToken();

    expect(String(fetchMock.mock.calls[0][0])).toContain('/settings/personal-access-token/renew');
    expect(result.token).toBe('praetor_pat_newtoken-secret');
  });
});
