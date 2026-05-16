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
