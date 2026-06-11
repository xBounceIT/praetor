import { describe, expect, test } from 'bun:test';
import {
  canTransitionClientQuote,
  effectiveQuoteStatus,
  effectiveSupplierQuoteStatus,
  isTerminalQuoteStatus,
  normalizeQuoteStatus,
  QUOTE_PIPELINE_STATUSES,
} from '../../utils/quoteStatus';

// `utils/quoteStatus.ts` is the frontend mirror of `server/utils/quote-status.ts` (the frontend
// cannot import server modules). These tests intentionally duplicate the backend suite so the two
// copies of the #779 status model cannot silently drift apart.

describe('normalizeQuoteStatus (frontend mirror)', () => {
  test('passes canonical pipeline statuses through unchanged', () => {
    for (const s of QUOTE_PIPELINE_STATUSES) {
      expect(normalizeQuoteStatus(s)).toBe(s);
    }
  });

  test('folds legacy spellings and floors unknown values to draft', () => {
    expect(normalizeQuoteStatus('quoted')).toBe('draft');
    expect(normalizeQuoteStatus('confirmed')).toBe('accepted');
    expect(normalizeQuoteStatus('received')).toBe('sent');
    expect(normalizeQuoteStatus('approved')).toBe('accepted');
    expect(normalizeQuoteStatus('rejected')).toBe('denied');
    expect(normalizeQuoteStatus('whatever')).toBe('draft');
    expect(normalizeQuoteStatus('expired')).toBe('draft');
  });
});

describe('effectiveQuoteStatus (frontend mirror)', () => {
  test('non-terminal statuses flip to expired once the expiration is past', () => {
    expect(effectiveQuoteStatus('draft', true)).toBe('expired');
    expect(effectiveQuoteStatus('sent', true)).toBe('expired');
    expect(effectiveQuoteStatus('offer', true)).toBe('expired');
    expect(effectiveQuoteStatus('sent', false)).toBe('sent');
  });

  test('terminal statuses freeze and never flip to expired (issue #779)', () => {
    expect(effectiveQuoteStatus('accepted', true)).toBe('accepted');
    expect(effectiveQuoteStatus('denied', true)).toBe('denied');
    expect(effectiveQuoteStatus('confirmed', true)).toBe('accepted'); // legacy → terminal, frozen
  });
});

describe('isTerminalQuoteStatus (frontend mirror)', () => {
  test('only accepted/denied are terminal', () => {
    expect(isTerminalQuoteStatus('accepted')).toBe(true);
    expect(isTerminalQuoteStatus('denied')).toBe(true);
    expect(isTerminalQuoteStatus('draft')).toBe(false);
    expect(isTerminalQuoteStatus('sent')).toBe(false);
    expect(isTerminalQuoteStatus('offer')).toBe(false);
  });
});

describe('effectiveSupplierQuoteStatus (frontend mirror, fully derived chain)', () => {
  test('linked: follows the client status; own expiry overrides; accepted stays frozen', () => {
    expect(
      effectiveSupplierQuoteStatus({ linkedClientStatus: 'sent', isPastOwnExpiration: false }),
    ).toBe('sent');
    expect(
      effectiveSupplierQuoteStatus({ linkedClientStatus: 'sent', isPastOwnExpiration: true }),
    ).toBe('expired');
    expect(
      effectiveSupplierQuoteStatus({ linkedClientStatus: 'accepted', isPastOwnExpiration: true }),
    ).toBe('accepted');
    // The linked QUOTE's own expiry flows through too.
    expect(
      effectiveSupplierQuoteStatus({
        linkedClientStatus: 'sent',
        isPastOwnExpiration: false,
        isPastLinkedQuoteExpiration: true,
      }),
    ).toBe('expired');
  });

  test('unlinked: always draft, with its own expiry overlay', () => {
    expect(
      effectiveSupplierQuoteStatus({ linkedClientStatus: null, isPastOwnExpiration: false }),
    ).toBe('draft');
    expect(
      effectiveSupplierQuoteStatus({ linkedClientStatus: null, isPastOwnExpiration: true }),
    ).toBe('expired');
  });

  test('a linked offer drives the chain: live → offer, terminal/expired flow through', () => {
    expect(
      effectiveSupplierQuoteStatus({
        linkedClientStatus: 'offer',
        linkedOfferStatus: 'sent',
        isPastOwnExpiration: false,
      }),
    ).toBe('offer');
    expect(
      effectiveSupplierQuoteStatus({
        linkedClientStatus: 'offer',
        linkedOfferStatus: 'denied',
        isPastOwnExpiration: false,
      }),
    ).toBe('denied');
    expect(
      effectiveSupplierQuoteStatus({
        linkedClientStatus: 'offer',
        linkedOfferStatus: 'sent',
        isPastLinkedOfferExpiration: true,
        isPastOwnExpiration: false,
      }),
    ).toBe('expired');
  });
});

describe('canTransitionClientQuote (frontend mirror)', () => {
  test('back-to-draft only from sent or offer; other transitions pass', () => {
    expect(canTransitionClientQuote('sent', 'draft')).toBe(true);
    expect(canTransitionClientQuote('offer', 'draft')).toBe(true);
    expect(canTransitionClientQuote('accepted', 'draft')).toBe(false);
    expect(canTransitionClientQuote('denied', 'draft')).toBe(false);
    expect(canTransitionClientQuote('draft', 'draft')).toBe(false);
    expect(canTransitionClientQuote('sent', 'offer')).toBe(true);
    expect(canTransitionClientQuote('sent', 'denied')).toBe(true);
  });
});
