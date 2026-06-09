// Canonical status model shared by client quotes and supplier quotes — issue #779. The five
// PIPELINE statuses below are the only values ever stored; `expired` (Scaduto) is NEVER stored —
// it is derived from each quote's own expiration date (see effectiveQuoteStatus). Mirrors the
// PURE CORE of the backend copy in `server/utils/quote-status.ts` — kept separate because the
// frontend can't import server modules (server is excluded from the frontend tsconfig). The
// backend file additionally carries server-only date adapters and the strict write-path parser.
export const QUOTE_PIPELINE_STATUSES = ['draft', 'sent', 'offer', 'accepted', 'denied'] as const;
export type QuotePipelineStatus = (typeof QUOTE_PIPELINE_STATUSES)[number];
export type EffectiveQuoteStatus = QuotePipelineStatus | 'expired';

// Terminal statuses freeze: once a quote is accepted or denied it never flips to `expired`,
// matching the long-standing UI behavior (accepted/denied were always excluded from expiry).
const TERMINAL_STATUSES: ReadonlySet<QuotePipelineStatus> = new Set(['accepted', 'denied']);

// Folds the legacy/pre-#779 status spellings onto the canonical set. Unknown values floor to
// `draft` so a stray value can never escape the pipeline.
export const normalizeQuoteStatus = (status: string): QuotePipelineStatus => {
  switch (status) {
    case 'draft':
    case 'sent':
    case 'offer':
    case 'accepted':
    case 'denied':
      return status;
    case 'quoted': // legacy client-quote DB-only value
      return 'draft';
    case 'confirmed': // legacy client-quote DB-only value (offer generated ⇒ post-acceptance)
      return 'accepted';
    case 'received': // legacy supplier-quote value
      return 'sent';
    case 'approved': // legacy supplier-quote value
      return 'accepted';
    case 'rejected': // legacy supplier-quote value
      return 'denied';
    default:
      return 'draft';
  }
};

export const isTerminalQuoteStatus = (status: string): boolean =>
  TERMINAL_STATUSES.has(normalizeQuoteStatus(status));

// Effective status for a single quote: `expired` overrides a non-terminal pipeline status once
// the quote's own expiration has passed; terminal statuses (accepted/denied) are frozen.
// `isPastExpiration` is injected (callers pass `isDateOnlyBeforeToday(expirationDate)`) to keep
// this pure and to mirror the backend signature exactly.
export const effectiveQuoteStatus = (
  status: string,
  isPastExpiration: boolean,
): EffectiveQuoteStatus => {
  const normalized = normalizeQuoteStatus(status);
  if (TERMINAL_STATUSES.has(normalized)) return normalized;
  return isPastExpiration ? 'expired' : normalized;
};

// Effective status for a supplier quote. When linked to a client quote (`linkedClientStatus` is
// non-null) the supplier quote MIRRORS the client quote's pipeline status; when unlinked it uses
// its own stored status. The `expired` overlay is always computed from the SUPPLIER quote's OWN
// expiration (issue #779: Scaduto is never inherited from the client quote).
export const effectiveSupplierQuoteStatus = (args: {
  ownStatus: string;
  linkedClientStatus: string | null;
  isPastOwnExpiration: boolean;
}): EffectiveQuoteStatus => {
  const base = args.linkedClientStatus ?? args.ownStatus;
  return effectiveQuoteStatus(base, args.isPastOwnExpiration);
};

// Whether a client quote may transition from `from` to `to`. The only structural restriction
// from issue #779 is back-to-draft: allowed ONLY from `sent` or `offer`. The expired-frozen rule
// and the linked-supplier-expired guard are enforced server-side with extra context; the UI
// mirrors them for affordance only.
export const canTransitionClientQuote = (from: string, to: string): boolean => {
  if (normalizeQuoteStatus(to) !== 'draft') return true;
  const source = normalizeQuoteStatus(from);
  return source === 'sent' || source === 'offer';
};
