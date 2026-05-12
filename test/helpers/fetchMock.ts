/**
 * Builds a Response-like object for use with `fetchMock.mockImplementation(...)`.
 *
 * Matches the surface area of `globalThis.fetch`'s Response that
 * `services/api/client.ts` consumes: `ok`, `status`, `headers.get(name)` and
 * `json()`. Headers are matched case-insensitively to mirror real Headers.
 */
export type FetchResponseInit = {
  status?: number;
  ok?: boolean;
  headers?: Record<string, string>;
  /** Sync or async producer for the JSON body. */
  json?: () => unknown | Promise<unknown>;
};

export const buildResponse = ({ status = 200, ok, headers = {}, json }: FetchResponseInit = {}) => {
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    headers: {
      get: (name: string) => lowerHeaders[name.toLowerCase()] ?? null,
    },
    json: json
      ? () => {
          try {
            return Promise.resolve(json());
          } catch (err) {
            return Promise.reject(err);
          }
        }
      : () => Promise.reject(new Error('json not implemented')),
  };
};
