import { describe, expect, test } from 'bun:test';
import {
  canTransitionClientQuote,
  effectiveQuoteStatus,
  effectiveQuoteStatusFromDate,
  effectiveSupplierQuoteStatus,
  effectiveSupplierQuoteStatusFromDate,
  isTerminalQuoteStatus,
  normalizeQuoteStatus,
  parseQuoteStatusInput,
  QUOTE_PIPELINE_STATUSES,
} from '../../utils/quote-status.ts';

describe('normalizeQuoteStatus', () => {
  test('passes canonical pipeline statuses through unchanged', () => {
    for (const s of QUOTE_PIPELINE_STATUSES) {
      expect(normalizeQuoteStatus(s)).toBe(s);
    }
  });

  test('folds legacy client-quote spellings', () => {
    expect(normalizeQuoteStatus('quoted')).toBe('draft');
    expect(normalizeQuoteStatus('confirmed')).toBe('accepted');
  });

  test('folds legacy supplier-quote spellings', () => {
    expect(normalizeQuoteStatus('received')).toBe('sent');
    expect(normalizeQuoteStatus('approved')).toBe('accepted');
    expect(normalizeQuoteStatus('rejected')).toBe('denied');
  });

  test('floors unknown values to draft', () => {
    expect(normalizeQuoteStatus('whatever')).toBe('draft');
    expect(normalizeQuoteStatus('')).toBe('draft');
    // `expired` is never stored, so it normalizes to the safe floor too.
    expect(normalizeQuoteStatus('expired')).toBe('draft');
  });
});

describe('effectiveQuoteStatus', () => {
  test('non-terminal statuses flip to expired once the expiration is past', () => {
    expect(effectiveQuoteStatus('draft', true)).toBe('expired');
    expect(effectiveQuoteStatus('sent', true)).toBe('expired');
    expect(effectiveQuoteStatus('offer', true)).toBe('expired');
  });

  test('non-terminal statuses are unchanged while still valid', () => {
    expect(effectiveQuoteStatus('draft', false)).toBe('draft');
    expect(effectiveQuoteStatus('sent', false)).toBe('sent');
    expect(effectiveQuoteStatus('offer', false)).toBe('offer');
  });

  test('terminal statuses freeze and never flip to expired (issue #779)', () => {
    expect(effectiveQuoteStatus('accepted', true)).toBe('accepted');
    expect(effectiveQuoteStatus('denied', true)).toBe('denied');
  });

  test('normalizes legacy input before applying the expiry overlay', () => {
    expect(effectiveQuoteStatus('confirmed', true)).toBe('accepted'); // terminal, frozen
    expect(effectiveQuoteStatus('quoted', true)).toBe('expired'); // → draft, then expired
  });
});

describe('isTerminalQuoteStatus', () => {
  test('only accepted/denied are terminal', () => {
    expect(isTerminalQuoteStatus('accepted')).toBe(true);
    expect(isTerminalQuoteStatus('denied')).toBe(true);
    expect(isTerminalQuoteStatus('draft')).toBe(false);
    expect(isTerminalQuoteStatus('sent')).toBe(false);
    expect(isTerminalQuoteStatus('offer')).toBe(false);
  });
});

describe('effectiveSupplierQuoteStatus', () => {
  test('linked: mirrors the client quote pipeline status', () => {
    expect(
      effectiveSupplierQuoteStatus({
        ownStatus: 'draft',
        linkedClientStatus: 'sent',
        isPastOwnExpiration: false,
      }),
    ).toBe('sent');
  });

  test('linked: own expiry overrides the mirrored status (Scaduto is never inherited)', () => {
    // Client quote still valid (e.g. sent) but the supplier quote is past its own date.
    expect(
      effectiveSupplierQuoteStatus({
        ownStatus: 'draft',
        linkedClientStatus: 'sent',
        isPastOwnExpiration: true,
      }),
    ).toBe('expired');
  });

  test('linked to an accepted client quote: frozen, never expired even if own date passed', () => {
    expect(
      effectiveSupplierQuoteStatus({
        ownStatus: 'draft',
        linkedClientStatus: 'accepted',
        isPastOwnExpiration: true,
      }),
    ).toBe('accepted');
  });

  test('unlinked: uses its own status with its own expiry overlay', () => {
    expect(
      effectiveSupplierQuoteStatus({
        ownStatus: 'sent',
        linkedClientStatus: null,
        isPastOwnExpiration: false,
      }),
    ).toBe('sent');
    expect(
      effectiveSupplierQuoteStatus({
        ownStatus: 'sent',
        linkedClientStatus: null,
        isPastOwnExpiration: true,
      }),
    ).toBe('expired');
  });
});

describe('canTransitionClientQuote', () => {
  test('back-to-draft only from sent or offer', () => {
    expect(canTransitionClientQuote('sent', 'draft')).toBe(true);
    expect(canTransitionClientQuote('offer', 'draft')).toBe(true);
    expect(canTransitionClientQuote('accepted', 'draft')).toBe(false);
    expect(canTransitionClientQuote('denied', 'draft')).toBe(false);
    expect(canTransitionClientQuote('draft', 'draft')).toBe(false);
  });

  test('forward and lateral transitions are allowed (other guards apply in the route)', () => {
    expect(canTransitionClientQuote('draft', 'sent')).toBe(true);
    expect(canTransitionClientQuote('sent', 'offer')).toBe(true);
    expect(canTransitionClientQuote('offer', 'accepted')).toBe(true);
    expect(canTransitionClientQuote('sent', 'denied')).toBe(true);
  });
});

describe('parseQuoteStatusInput', () => {
  test('accepts canonical and legacy spellings', () => {
    for (const s of QUOTE_PIPELINE_STATUSES) {
      expect(parseQuoteStatusInput(s)).toBe(s);
    }
    expect(parseQuoteStatusInput('quoted')).toBe('draft');
    expect(parseQuoteStatusInput('confirmed')).toBe('accepted');
    expect(parseQuoteStatusInput('received')).toBe('sent');
    expect(parseQuoteStatusInput('approved')).toBe('accepted');
    expect(parseQuoteStatusInput('rejected')).toBe('denied');
  });

  test('rejects unknown values instead of flooring them (write-path safety)', () => {
    expect(parseQuoteStatusInput('expired')).toBeNull(); // derived-only, never writable
    expect(parseQuoteStatusInput('Draft')).toBeNull(); // case-sensitive
    expect(parseQuoteStatusInput('')).toBeNull();
    expect(parseQuoteStatusInput('whatever')).toBeNull();
  });
});

describe('date-accepting wrappers', () => {
  test('effectiveQuoteStatusFromDate expires past dates and keeps null/future ones', () => {
    expect(effectiveQuoteStatusFromDate('sent', '2000-01-01')).toBe('expired');
    expect(effectiveQuoteStatusFromDate('sent', '2999-12-31')).toBe('sent');
    expect(effectiveQuoteStatusFromDate('sent', null)).toBe('sent');
    // Terminal statuses stay frozen regardless of the date.
    expect(effectiveQuoteStatusFromDate('accepted', '2000-01-01')).toBe('accepted');
  });

  test('effectiveSupplierQuoteStatusFromDate mirrors the link with own-date overlay', () => {
    expect(effectiveSupplierQuoteStatusFromDate('draft', 'sent', '2999-12-31')).toBe('sent');
    expect(effectiveSupplierQuoteStatusFromDate('draft', 'sent', '2000-01-01')).toBe('expired');
    expect(effectiveSupplierQuoteStatusFromDate('draft', 'accepted', '2000-01-01')).toBe(
      'accepted',
    );
    expect(effectiveSupplierQuoteStatusFromDate('sent', null, null)).toBe('sent');
  });
});
