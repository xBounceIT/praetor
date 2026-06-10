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

// Effective status for a supplier quote — FULLY DERIVED model (issue #779, extended): the
// visible status never comes from the supplier quote's own stored status, it follows the linked
// client document chain: unlinked → draft; linked quote (no offer) → the quote's effective
// status; linked quote with an offer → accepted/denied/expired per the offer, else `offer`. The
// supplier quote's OWN expiration overlays `expired` onto any non-terminal result.
export const effectiveSupplierQuoteStatus = (args: {
  linkedClientStatus: string | null;
  isPastOwnExpiration: boolean;
  isPastLinkedQuoteExpiration?: boolean;
  linkedOfferStatus?: string | null;
  isPastLinkedOfferExpiration?: boolean;
}): EffectiveQuoteStatus => {
  let base: EffectiveQuoteStatus;
  if (args.linkedClientStatus === null) {
    base = 'draft';
  } else if (args.linkedOfferStatus != null) {
    const offerEffective = effectiveQuoteStatus(
      args.linkedOfferStatus,
      args.isPastLinkedOfferExpiration ?? false,
    );
    // A live (draft/sent) offer reads as "in offer"; its terminal/expired states flow through.
    base = offerEffective === 'draft' || offerEffective === 'sent' ? 'offer' : offerEffective;
  } else {
    base = effectiveQuoteStatus(args.linkedClientStatus, args.isPastLinkedQuoteExpiration ?? false);
  }
  if (TERMINAL_STATUSES.has(base as QuotePipelineStatus)) return base;
  return args.isPastOwnExpiration ? 'expired' : base;
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
