import type { View } from '../types';

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
