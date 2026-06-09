import { isPastLocalDate } from './date.ts';

// Canonical status model shared by client quotes (`quotes`) and supplier quotes
// (`supplier_quotes`) — issue #779. The five PIPELINE statuses below are the only values ever
// stored; `expired` (Scaduto) is NEVER stored — it is derived from each quote's own expiration
// date (see effectiveQuoteStatus). The pure core below mirrors the frontend copy in
// `utils/quoteStatus.ts` (kept separate because routes/repos can't reach across the
// frontend/backend split); the date adapters and the strict input parser are server-only.
export const QUOTE_PIPELINE_STATUSES = ['draft', 'sent', 'offer', 'accepted', 'denied'] as const;
export type QuotePipelineStatus = (typeof QUOTE_PIPELINE_STATUSES)[number];
export type EffectiveQuoteStatus = QuotePipelineStatus | 'expired';

// Terminal statuses freeze: once a quote is accepted or denied it never flips to `expired`.
// This preserves long-standing behavior — the old `isQuoteExpired` exempted the legacy
// `confirmed` state, and the client UI already excludes accepted/denied from expiry — and keeps
// an accepted quote (which may have downstream offers/orders) from visually "expiring".
const TERMINAL_STATUSES: ReadonlySet<QuotePipelineStatus> = new Set(['accepted', 'denied']);

// Folds the legacy/pre-#779 status spellings onto the canonical set. Single source of truth
// replacing the three ad-hoc `normalizeSupplierQuoteStatus` copies and the client-side
// quoted/confirmed handling. Unknown values floor to `draft` so a stray value can never escape
// the pipeline (e.g. when restoring a very old version snapshot).
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

// Strict write-path variant of normalizeQuoteStatus: accepts the canonical set plus the known
// legacy spellings and returns null for everything else. Routes use this for request input so a
// typo'd or round-tripped status (e.g. the derived-only `expired` read back from a GET) becomes
// a 400 instead of normalizeQuoteStatus's draft floor — which would silently demote the quote.
// The floor stays correct for READS and trusted stored data (e.g. version snapshots).
const QUOTE_STATUS_INPUT_SPELLINGS: ReadonlySet<string> = new Set([
  ...QUOTE_PIPELINE_STATUSES,
  'quoted',
  'confirmed',
  'received',
  'approved',
  'rejected',
]);
export const parseQuoteStatusInput = (status: string): QuotePipelineStatus | null =>
  QUOTE_STATUS_INPUT_SPELLINGS.has(status) ? normalizeQuoteStatus(status) : null;

export const isTerminalQuoteStatus = (status: string): boolean =>
  TERMINAL_STATUSES.has(normalizeQuoteStatus(status));

// Effective status for a single quote: `expired` overrides a non-terminal pipeline status once
// the quote's own expiration has passed; terminal statuses (accepted/denied) are frozen and
// never expire. `isPastExpiration` is injected (callers pass `isPastLocalDate(expirationDate)`)
// to keep this pure and unit-testable.
export const effectiveQuoteStatus = (
  status: string,
  isPastExpiration: boolean,
): EffectiveQuoteStatus => {
  const normalized = normalizeQuoteStatus(status);
  if (TERMINAL_STATUSES.has(normalized)) return normalized;
  return isPastExpiration ? 'expired' : normalized;
};

// Effective status for a supplier quote. When linked to a client quote (`linkedClientStatus`
// is non-null) the supplier quote MIRRORS the client quote's pipeline status; when unlinked it
// uses its own stored status. In both cases the `expired` overlay is computed from the SUPPLIER
// quote's OWN expiration (issue #779: Scaduto is never inherited from the client quote).
export const effectiveSupplierQuoteStatus = (args: {
  ownStatus: string;
  linkedClientStatus: string | null;
  isPastOwnExpiration: boolean;
}): EffectiveQuoteStatus => {
  const base = args.linkedClientStatus ?? args.ownStatus;
  return effectiveQuoteStatus(base, args.isPastOwnExpiration);
};

// Date-accepting conveniences over the pure cores above. Every route used to hand-build the
// `expirationDate ? isPastLocalDate(expirationDate) : false` plumbing at each call site; these
// own that adapter once. A null/undefined expiration date never expires.
export const effectiveQuoteStatusFromDate = (
  status: string,
  expirationDate: string | null | undefined,
): EffectiveQuoteStatus =>
  effectiveQuoteStatus(status, expirationDate ? isPastLocalDate(expirationDate) : false);

export const effectiveSupplierQuoteStatusFromDate = (
  ownStatus: string,
  linkedClientStatus: string | null,
  expirationDate: string | null | undefined,
): EffectiveQuoteStatus =>
  effectiveSupplierQuoteStatus({
    ownStatus,
    linkedClientStatus,
    isPastOwnExpiration: expirationDate ? isPastLocalDate(expirationDate) : false,
  });

// Whether a client quote may transition from `from` to `to`. The only structural restriction
// from issue #779 is back-to-draft: allowed ONLY from `sent` or `offer` (never from
// accepted/denied/expired). Forward transitions, the expired-frozen rule, and the
// linked-supplier-expired guard are enforced in the route with extra context.
export const canTransitionClientQuote = (from: string, to: string): boolean => {
  if (normalizeQuoteStatus(to) !== 'draft') return true;
  const source = normalizeQuoteStatus(from);
  return source === 'sent' || source === 'offer';
};
