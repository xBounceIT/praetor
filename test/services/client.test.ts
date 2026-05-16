import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => buildResponse({ status: 204 }),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { fetchApi, fetchApiStream, getAuthToken, setAuthToken } = await import(
  '../../services/api/client'
);

beforeEach(() => {
  fetchMock.mockReset();
  setAuthToken(null);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('services/api/client', () => {
  describe('setAuthToken / getAuthToken', () => {
    test('setAuthToken with a string persists it in localStorage and getAuthToken returns it', () => {
      setAuthToken('my-token');
      expect(localStorage.getItem('praetor_auth_token')).toBe('my-token');
      expect(getAuthToken()).toBe('my-token');
    });

    test('setAuthToken(null) clears localStorage and getAuthToken returns null', () => {
      setAuthToken('temp');
      setAuthToken(null);
      expect(localStorage.getItem('praetor_auth_token')).toBeNull();
      expect(getAuthToken()).toBeNull();
    });
  });

  describe('fetchApi', () => {
    test('successful JSON response is parsed and returned', async () => {
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({ status: 200, json: () => ({ hello: 'world' }) }),
      );

      const result = await fetchApi<{ hello: string }>('/things');
      expect(result).toEqual({ hello: 'world' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('returns empty object for 204 responses without parsing JSON', async () => {
      fetchMock.mockImplementationOnce(async () => buildResponse({ status: 204 }));

      const result = await fetchApi<Record<string, unknown>>('/empty');
      expect(result).toEqual({});
    });

    test('rotates the auth token when response includes x-auth-token header', async () => {
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({
          status: 200,
          headers: { 'x-auth-token': 'rotated-token' },
          json: () => ({ ok: true }),
        }),
      );

      await fetchApi('/anything');
      expect(getAuthToken()).toBe('rotated-token');
      expect(localStorage.getItem('praetor_auth_token')).toBe('rotated-token');
    });

    test('does not change token when response omits x-auth-token header', async () => {
      setAuthToken('pre-existing');
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({ status: 200, json: () => ({}) }),
      );

      await fetchApi('/x');
      expect(getAuthToken()).toBe('pre-existing');
    });

    test('attaches Authorization header when a token is present', async () => {
      setAuthToken('bearer-token');
      fetchMock.mockImplementationOnce(async (_input: unknown, init: unknown) => {
        const headers = (init as { headers: Record<string, string> }).headers;
        expect(headers.Authorization).toBe('Bearer bearer-token');
        return buildResponse({ status: 200, json: () => ({}) });
      });
      await fetchApi('/secure');
    });

    test('omits Authorization header when no token is set', async () => {
      fetchMock.mockImplementationOnce(async (_input: unknown, init: unknown) => {
        const headers = (init as { headers: Record<string, string> }).headers;
        expect(headers.Authorization).toBeUndefined();
        return buildResponse({ status: 200, json: () => ({}) });
      });
      await fetchApi('/public');
    });

    test('sets Content-Type=application/json automatically when a body is present', async () => {
      fetchMock.mockImplementationOnce(async (_input: unknown, init: unknown) => {
        const headers = (init as { headers: Record<string, string> }).headers;
        expect(headers['Content-Type']).toBe('application/json');
        return buildResponse({ status: 200, json: () => ({}) });
      });
      await fetchApi('/post', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    });

    test('does not set Content-Type when no body is provided', async () => {
      fetchMock.mockImplementationOnce(async (_input: unknown, init: unknown) => {
        const headers = (init as { headers: Record<string, string> }).headers;
        expect(headers['Content-Type']).toBeUndefined();
        return buildResponse({ status: 200, json: () => ({}) });
      });
      await fetchApi('/get');
    });

    test('error response with body.message throws Error with that message', async () => {
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({ status: 400, json: () => ({ message: 'Bad input' }) }),
      );
      await expect(fetchApi('/bad')).rejects.toThrow('Bad input');
    });

    test('error response with body.error throws Error with that message', async () => {
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({ status: 422, json: () => ({ error: 'validation failed' }) }),
      );
      await expect(fetchApi('/v')).rejects.toThrow('validation failed');
    });

    test('error response with unparseable JSON falls back to "Request failed"', async () => {
      // When response.json() rejects, the implementation defaults the parsed
      // payload to `{ error: 'Request failed' }`.
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({
          status: 500,
          json: () => Promise.reject(new Error('not json')),
        }),
      );
      await expect(fetchApi('/crash')).rejects.toThrow('Request failed');
    });

    test('error response with empty body falls back to "HTTP <status>"', async () => {
      // When the parsed body has neither `message` nor `error`, the implementation
      // throws `HTTP <status>`.
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({ status: 503, json: () => ({}) }),
      );
      await expect(fetchApi('/crash')).rejects.toThrow('HTTP 503');
    });

    test('401 response throws and still rotates the token if header present', async () => {
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({
          status: 401,
          headers: { 'x-auth-token': 'rotated-on-401' },
          json: () => ({ message: 'Unauthorized' }),
        }),
      );
      await expect(fetchApi('/me')).rejects.toThrow('Unauthorized');
      // The current implementation rotates the token whenever the header is set,
      // regardless of status code.
      expect(getAuthToken()).toBe('rotated-on-401');
    });

    test('network error from fetch propagates to caller', async () => {
      fetchMock.mockImplementationOnce(async () => {
        throw new TypeError('Failed to fetch');
      });
      await expect(fetchApi('/down')).rejects.toThrow('Failed to fetch');
    });

    test('passes an AbortSignal to fetch so requests time out instead of hanging forever', async () => {
      fetchMock.mockImplementationOnce(async (_input: unknown, init: unknown) => {
        const sig = (init as { signal?: AbortSignal }).signal;
        expect(sig).toBeInstanceOf(AbortSignal);
        return buildResponse({ status: 200, json: () => ({}) });
      });
      await fetchApi('/with-timeout');
    });

    test('maps a fetch TimeoutError to ApiError "Request timed out"', async () => {
      fetchMock.mockImplementationOnce(async () => {
        throw new DOMException('timed out', 'TimeoutError');
      });
      await expect(fetchApi('/slow')).rejects.toMatchObject({
        name: 'ApiError',
        status: 0,
        isNetworkError: true,
        message: 'Request timed out',
      });
    });

    test('combines caller-provided signal with the timeout signal', async () => {
      const callerController = new AbortController();
      fetchMock.mockImplementationOnce(async (_input: unknown, init: unknown) => {
        const sig = (init as { signal: AbortSignal }).signal;
        expect(sig.aborted).toBe(false);
        callerController.abort(new DOMException('caller cancelled', 'AbortError'));
        expect(sig.aborted).toBe(true);
        return buildResponse({ status: 200, json: () => ({}) });
      });
      await fetchApi('/cancellable', { signal: callerController.signal });
    });

    test('caller can override headers via options.headers', async () => {
      fetchMock.mockImplementationOnce(async (_input: unknown, init: unknown) => {
        const headers = (init as { headers: Record<string, string> }).headers;
        expect(headers['X-Custom']).toBe('yes');
        return buildResponse({ status: 200, json: () => ({}) });
      });
      await fetchApi('/custom', { headers: { 'X-Custom': 'yes' } });
    });
  });

  describe('fetchApiStream', () => {
    test('returns the raw Response without parsing the body', async () => {
      const fakeResponse = buildResponse({ status: 200, json: () => ({ wont: 'parse' }) });
      fetchMock.mockImplementationOnce(async () => fakeResponse);

      const result = await fetchApiStream('/stream');
      expect(result).toBe(fakeResponse as never);
    });

    test('rotates token from x-auth-token on stream responses too', async () => {
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({
          status: 200,
          headers: { 'x-auth-token': 'stream-rotated' },
          json: () => ({}),
        }),
      );
      await fetchApiStream('/stream');
      expect(getAuthToken()).toBe('stream-rotated');
    });

    test('attaches Authorization header but not Content-Type by default', async () => {
      setAuthToken('stream-token');
      fetchMock.mockImplementationOnce(async (_input: unknown, init: unknown) => {
        const headers = (init as { headers: Record<string, string> }).headers;
        expect(headers.Authorization).toBe('Bearer stream-token');
        expect(headers['Content-Type']).toBeUndefined();
        return buildResponse({ status: 200, json: () => ({}) });
      });
      await fetchApiStream('/stream');
    });

    test('throws ApiError carrying the HTTP status on non-ok stream responses', async () => {
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({ status: 500, json: () => ({ message: 'boom' }) }),
      );
      await expect(fetchApiStream('/bad-stream')).rejects.toMatchObject({
        name: 'ApiError',
        status: 500,
        message: 'boom',
      });
    });

    test('non-ok stream with unparseable body falls back to "Request failed"', async () => {
      fetchMock.mockImplementationOnce(async () =>
        buildResponse({
          status: 503,
          json: () => Promise.reject(new Error('not json')),
        }),
      );
      await expect(fetchApiStream('/crash-stream')).rejects.toThrow('Request failed');
    });

    test('network error from fetch surfaces as ApiError with isNetworkError=true', async () => {
      fetchMock.mockImplementationOnce(async () => {
        throw new TypeError('Failed to fetch');
      });
      await expect(fetchApiStream('/down-stream')).rejects.toMatchObject({
        name: 'ApiError',
        status: 0,
        isNetworkError: true,
      });
    });
  });
});
