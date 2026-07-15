import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const respondWith = (body: unknown, status = 200) => buildResponse({ status, json: () => body });

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => respondWith({}),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { emailApi } = await import('../../services/api/email');
const { setAuthToken } = await import('../../services/api/client');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => respondWith({}));
  setAuthToken(null);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('emailApi.testConnection', () => {
  test('POSTs the SMTP connection test and returns its structured result', async () => {
    fetchMock.mockImplementation(async () =>
      respondWith({
        success: true,
        code: 'CONNECTION_SUCCESS',
        params: null,
      }),
    );

    const result = await emailApi.testConnection();

    const [url, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect(String(url)).toContain('/email/test-connection');
    expect(init.method).toBe('POST');
    expect(result.success).toBe(true);
    expect(result.code).toBe('CONNECTION_SUCCESS');
    expect(result.params).toBeNull();
  });
});
