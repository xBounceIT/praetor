import type { View } from '../types';

export const stripHashPrefix = (hash: string): string => hash.replace('#/', '').replace('#', '');

// Query-string key used by quick-view deep links (e.g.
// `#/sales/supplier-quotes?filterId=SQ-001`). Keep the reader in App.tsx and the
// `buildViewDeepLink` writer below in sync with this constant.
const VIEW_DEEP_LINK_FILTER_PARAM = 'filterId';

export interface ParsedViewHash {
  // View path with any query string stripped and legacy aliases canonicalized.
  path: string;
  // Value of the `filterId` deep-link param, or null when absent.
  filterId: string | null;
}

// Splits a raw `window.location.hash` into its (canonicalized) view path and the
// optional `filterId` deep-link param. Tolerates a missing or malformed query
// string. Used on initial load so a quick-view link opened in a fresh tab lands
// on the referenced record's pre-filtered page.
export const parseViewHash = (hash: string): ParsedViewHash => {
  const raw = stripHashPrefix(hash);
  const queryIndex = raw.indexOf('?');
  const path = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : raw.slice(queryIndex + 1);
  const filterId = new URLSearchParams(query).get(VIEW_DEEP_LINK_FILTER_PARAM);
  return { path: canonicalizeLegacyHash(path), filterId: filterId || null };
};

// Builds an in-app deep-link hash href to a view, optionally pre-filtered to a
// single record id. A relative hash href resolves against the current document,
// so it can be opened in a new tab (`target="_blank"`) without disturbing the
// current one. Keep in sync with `parseViewHash`.
export const buildViewDeepLink = (view: View, filterId?: string | null): string => {
  if (!filterId) return `#/${view}`;
  const params = new URLSearchParams({ [VIEW_DEEP_LINK_FILTER_PARAM]: filterId });
  return `#/${view}?${params.toString()}`;
};

// Maps legacy hash aliases to their current canonical form. Must remain
// idempotent: canonicalize(canonicalize(x)) === canonicalize(x) for all x.
// Non-idempotent additions would, in concert with the bidirectional
// hash<->activeView sync in App.tsx, risk an infinite hashchange loop.
export const canonicalizeLegacyHash = (hash: string): string => {
  if (hash === 'suppliers/manage') return 'crm/suppliers';
  if (hash === 'suppliers/quotes') return 'sales/supplier-quotes';
  if (hash === 'sales/supplier-offers') return 'sales/supplier-quotes';
  if (hash === 'administration/work-units') return 'hr/work-units';
  return hash;
};

export type HashChangeOutcome =
  | { kind: 'noop' }
  | { kind: 'set-view'; view: View | '404' }
  | { kind: 'rewrite-hash'; newHash: string; view: View | '404' };

// Decides what a hashchange event should do given the current state. The
// `rewrite-hash` outcome includes the resolved view so the caller can apply
// it synchronously in the same handler call — App.tsx's programmatic-hash
// guard short-circuits the follow-up hashchange fired by the rewrite, so the
// view must be applied here rather than relying on a second pass.
export const resolveHashChange = (params: {
  rawHash: string;
  activeView: View | '404';
  validViews: readonly View[];
  hasUser: boolean;
}): HashChangeOutcome => {
  const { rawHash, activeView, validViews, hasUser } = params;
  if (rawHash === 'login') {
    return hasUser ? { kind: 'set-view', view: 'timesheets/tracker' } : { kind: 'noop' };
  }
  const canonicalHash = canonicalizeLegacyHash(rawHash);
  const hash = canonicalHash as View;
  const view: View | '404' = validViews.includes(hash)
    ? hash
    : canonicalHash === ''
      ? 'timesheets/tracker'
      : '404';
  if (canonicalHash !== rawHash) {
    return { kind: 'rewrite-hash', newHash: `#/${canonicalHash}`, view };
  }
  return view !== activeView ? { kind: 'set-view', view } : { kind: 'noop' };
};
