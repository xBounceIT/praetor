import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const respondWith = (body: unknown, status = 200) => buildResponse({ status, json: () => body });

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => respondWith({}),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { ldapApi } = await import(
  new URL('../../services/api/ldap.ts?ldap-sync-test', import.meta.url).href
);
const { setAuthToken } = await import('../../services/api/client');

beforeEach(() => {
  fetchMock.mockReset();
  setAuthToken(null);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('ldapApi', () => {
  test('syncUsers POSTs to /ldap/sync and returns sync counts', async () => {
    fetchMock.mockImplementation(async (_input: unknown, init?: unknown) => {
      expect((init as RequestInit).method).toBe('POST');
      return respondWith({ success: true, synced: 3, created: 12 });
    });

    const result = await ldapApi.syncUsers();

    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ldap/sync');
    expect(result).toEqual({ success: true, synced: 3, created: 12 });
  });
});
