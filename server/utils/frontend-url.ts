// Shared helper for building user-facing redirect URLs after SSO callbacks.
//
// Both branches (configured FRONTEND_URL and fallback) route the query string through
// `URLSearchParams` so the encoded output is byte-identical regardless of which one is in
// effect. Using a synthetic base in the fallback keeps the same encoding rules in play
// even when only a path is returned.
export const buildFrontendUrl = (param: string, value: string): string => {
  const configured = process.env.FRONTEND_URL?.trim();
  const url = configured ? new URL(configured) : new URL('/', 'http://localhost');
  url.searchParams.set(param, value);
  return configured ? url.href : `${url.pathname}${url.search}${url.hash}`;
};
