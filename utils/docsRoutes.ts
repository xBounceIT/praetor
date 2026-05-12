export type TechnicalDocsView = 'docs/api' | 'docs/frontend';

export const getTechnicalDocsViewFromPathname = (pathname: string): TechnicalDocsView | null => {
  if (/^\/docs(?:\/[^/]+)?\/api(?:\/|$)/.test(pathname)) return 'docs/api';
  if (/^\/docs(?:\/[^/]+)?\/frontend(?:\/|$)/.test(pathname)) return 'docs/frontend';
  return null;
};
