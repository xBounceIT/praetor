import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

// Stub fetch globally; the real client.ts (via fetchApi/fetchApiStream) calls it under the hood.
const respondWith = (body: unknown, status = 200) => buildResponse({ status, json: () => body });

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => respondWith({}),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

// Load the real branding service — it pulls in the real client.ts, which calls our fetch mock.
const { brandingApi } = await import('../../services/api/branding');
const { getApiBase, setAuthToken } = await import('../../services/api/client');

const logoUrlFor = (v: string) => `${getApiBase()}/branding/logo?v=${encodeURIComponent(v)}`;

beforeEach(() => {
  fetchMock.mockReset();
  // Safety net: an unprogrammed call returns an empty 200 instead of `undefined`.
  fetchMock.mockImplementation(async () => respondWith({}));
  setAuthToken(null);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('brandingApi.getPublic', () => {
  test('GETs /branding and derives a cache-busted logoUrl when a logo is present', async () => {
    const updatedAt = '2026-06-02T10:00:00.000Z';
    fetchMock.mockImplementation(async () =>
      respondWith({ companyName: 'Acme', hasLogo: true, logoUpdatedAt: updatedAt }),
    );

    const result = await brandingApi.getPublic();

    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/branding');
    expect(result).toEqual({ companyName: 'Acme', logoUrl: logoUrlFor(updatedAt) });
    // The ISO timestamp is URL-encoded so its ':' separators survive as a query value
    // (this is what busts the browser/img cache when the logo changes).
    expect(result.logoUrl).toContain('v=2026-06-02T10%3A00%3A00.000Z');
  });

  test('maps hasLogo:false to a null logoUrl and preserves a null companyName', async () => {
    fetchMock.mockImplementation(async () =>
      respondWith({ companyName: null, hasLogo: false, logoUpdatedAt: null }),
    );

    const result = await brandingApi.getPublic();

    expect(result).toEqual({ companyName: null, logoUrl: null });
  });

  test('does not send an Authorization header when unauthenticated', async () => {
    fetchMock.mockImplementation(async () =>
      respondWith({ companyName: null, hasLogo: false, logoUpdatedAt: null }),
    );

    await brandingApi.getPublic();

    const init = fetchMock.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(init.headers?.Authorization).toBeUndefined();
  });
});

describe('brandingApi.updateName', () => {
  test('PUTs the company name as JSON and maps the response', async () => {
    fetchMock.mockImplementation(async () =>
      respondWith({ companyName: 'Acme', hasLogo: false, logoUpdatedAt: null }),
    );

    const result = await brandingApi.updateName('Acme');

    const [url, init] = fetchMock.mock.calls[0] as [unknown, { method: string; body: string }];
    expect(String(url)).toContain('/branding');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ companyName: 'Acme' }));
    expect(result).toEqual({ companyName: 'Acme', logoUrl: null });
  });

  test('sends null to clear the company name', async () => {
    fetchMock.mockImplementation(async () =>
      respondWith({ companyName: null, hasLogo: false, logoUpdatedAt: null }),
    );

    await brandingApi.updateName(null);

    const init = fetchMock.mock.calls[0][1] as { body: string };
    expect(init.body).toBe(JSON.stringify({ companyName: null }));
  });
});

describe('brandingApi.uploadLogo', () => {
  test('POSTs multipart FormData (no JSON content-type) and maps the response', async () => {
    const updatedAt = '2026-06-02T11:22:33.000Z';
    fetchMock.mockImplementation(async () =>
      respondWith({ companyName: 'Acme', hasLogo: true, logoUpdatedAt: updatedAt }),
    );

    const file = new File(['imagedata'], 'logo.png', { type: 'image/png' });
    const result = await brandingApi.uploadLogo(file);

    const [url, init] = fetchMock.mock.calls[0] as [
      unknown,
      { method: string; body: unknown; headers?: Record<string, string> },
    ];
    expect(String(url)).toContain('/branding/logo');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    // fetchApiStream must NOT set a Content-Type — the browser supplies the multipart boundary.
    expect(init.headers?.['Content-Type']).toBeUndefined();
    expect(result).toEqual({ companyName: 'Acme', logoUrl: logoUrlFor(updatedAt) });
  });
});

describe('brandingApi.deleteLogo', () => {
  test('DELETEs /branding/logo and maps the response', async () => {
    fetchMock.mockImplementation(async () =>
      respondWith({ companyName: 'Acme', hasLogo: false, logoUpdatedAt: null }),
    );

    const result = await brandingApi.deleteLogo();

    const [url, init] = fetchMock.mock.calls[0] as [unknown, { method: string }];
    expect(String(url)).toContain('/branding/logo');
    expect(init.method).toBe('DELETE');
    expect(result).toEqual({ companyName: 'Acme', logoUrl: null });
  });
});
