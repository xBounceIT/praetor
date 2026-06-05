import { describe, expect, test } from 'bun:test';
import type { View } from '../../types';
import {
  buildViewDeepLink,
  canonicalizeLegacyHash,
  parseViewHash,
  resolveHashChange,
} from '../../utils/hashCanonicalization';

describe('canonicalizeLegacyHash', () => {
  test('maps each legacy alias to its current view', () => {
    expect(canonicalizeLegacyHash('suppliers/manage')).toBe('crm/suppliers');
    expect(canonicalizeLegacyHash('suppliers/quotes')).toBe('sales/supplier-quotes');
    expect(canonicalizeLegacyHash('sales/supplier-offers')).toBe('sales/supplier-quotes');
    expect(canonicalizeLegacyHash('administration/work-units')).toBe('hr/work-units');
  });

  test('returns non-legacy hashes unchanged', () => {
    for (const hash of [
      '',
      'timesheets/tracker',
      'crm/clients',
      'hr/work-units',
      'sales/supplier-quotes',
    ]) {
      expect(canonicalizeLegacyHash(hash)).toBe(hash);
    }
  });

  test('is idempotent — canonicalize(canonicalize(x)) === canonicalize(x)', () => {
    // Idempotency is required so the hash-sync effect in App.tsx cannot loop.
    // If a future edit adds an alias whose target is itself an alias, this
    // test catches it before the latent infinite loop can ship.
    const samples = [
      '',
      'login',
      'timesheets/tracker',
      'suppliers/manage',
      'suppliers/quotes',
      'sales/supplier-offers',
      'administration/work-units',
      'crm/suppliers',
      'sales/supplier-quotes',
      'hr/work-units',
      'unknown/route',
      '404',
    ];
    for (const hash of samples) {
      const once = canonicalizeLegacyHash(hash);
      const twice = canonicalizeLegacyHash(once);
      expect(twice).toBe(once);
    }
  });
});

describe('parseViewHash', () => {
  test('parses a plain view hash with no query', () => {
    expect(parseViewHash('#/sales/supplier-quotes')).toEqual({
      path: 'sales/supplier-quotes',
      filterId: null,
    });
  });

  test('extracts the filterId deep-link param', () => {
    expect(parseViewHash('#/sales/supplier-quotes?filterId=SQ-001')).toEqual({
      path: 'sales/supplier-quotes',
      filterId: 'SQ-001',
    });
  });

  test('canonicalizes legacy aliases while reading the param', () => {
    expect(parseViewHash('#/suppliers/quotes?filterId=SQ-7')).toEqual({
      path: 'sales/supplier-quotes',
      filterId: 'SQ-7',
    });
  });

  test('decodes percent-encoded filter ids', () => {
    expect(parseViewHash('#/catalog/internal-listing?filterId=a%2Fb%20c')).toEqual({
      path: 'catalog/internal-listing',
      filterId: 'a/b c',
    });
  });

  test('ignores unrelated query params and treats an empty filterId as null', () => {
    expect(parseViewHash('#/catalog/internal-listing?foo=bar')).toEqual({
      path: 'catalog/internal-listing',
      filterId: null,
    });
    expect(parseViewHash('#/catalog/internal-listing?filterId=')).toEqual({
      path: 'catalog/internal-listing',
      filterId: null,
    });
  });
});

describe('buildViewDeepLink', () => {
  test('builds a plain hash href without a filter', () => {
    expect(buildViewDeepLink('catalog/internal-listing')).toBe('#/catalog/internal-listing');
    expect(buildViewDeepLink('catalog/internal-listing', null)).toBe('#/catalog/internal-listing');
  });

  test('appends and encodes the filterId param', () => {
    expect(buildViewDeepLink('sales/supplier-quotes', 'SQ-001')).toBe(
      '#/sales/supplier-quotes?filterId=SQ-001',
    );
    expect(buildViewDeepLink('catalog/internal-listing', 'a/b c')).toBe(
      '#/catalog/internal-listing?filterId=a%2Fb+c',
    );
  });

  test('round-trips through parseViewHash', () => {
    const href = buildViewDeepLink('sales/supplier-quotes', 'SQ-42');
    expect(parseViewHash(href)).toEqual({ path: 'sales/supplier-quotes', filterId: 'SQ-42' });
  });
});

describe('resolveHashChange', () => {
  const validViews: View[] = [
    'timesheets/tracker',
    'crm/clients',
    'crm/suppliers',
    'sales/supplier-quotes',
    'hr/work-units',
  ];

  test('returns noop when hash already matches activeView', () => {
    expect(
      resolveHashChange({
        rawHash: 'crm/clients',
        activeView: 'crm/clients',
        validViews,
        hasUser: true,
      }),
    ).toEqual({ kind: 'noop' });
  });

  test('returns set-view when valid hash differs from activeView', () => {
    expect(
      resolveHashChange({
        rawHash: 'crm/clients',
        activeView: 'crm/suppliers',
        validViews,
        hasUser: true,
      }),
    ).toEqual({ kind: 'set-view', view: 'crm/clients' });
  });

  test('rewrite-hash carries the resolved view so it can be applied in one call', () => {
    // Regression test for PR #567 / issue #540 follow-up: previously the
    // handler rewrote the hash and returned, relying on a follow-up
    // hashchange to call setActiveView. The new programmatic-hash guard
    // short-circuits that follow-up, so the resolver must return the view
    // alongside the rewrite so the caller can set it synchronously.
    expect(
      resolveHashChange({
        rawHash: 'suppliers/manage',
        activeView: 'timesheets/tracker',
        validViews,
        hasUser: true,
      }),
    ).toEqual({
      kind: 'rewrite-hash',
      newHash: '#/crm/suppliers',
      view: 'crm/suppliers',
    });
  });

  test('rewrite-hash resolves all legacy aliases to their canonical view', () => {
    expect(
      resolveHashChange({
        rawHash: 'suppliers/quotes',
        activeView: 'timesheets/tracker',
        validViews,
        hasUser: true,
      }),
    ).toEqual({
      kind: 'rewrite-hash',
      newHash: '#/sales/supplier-quotes',
      view: 'sales/supplier-quotes',
    });
    expect(
      resolveHashChange({
        rawHash: 'administration/work-units',
        activeView: 'timesheets/tracker',
        validViews,
        hasUser: true,
      }),
    ).toEqual({
      kind: 'rewrite-hash',
      newHash: '#/hr/work-units',
      view: 'hr/work-units',
    });
  });

  test('resolves empty hash to tracker', () => {
    expect(
      resolveHashChange({
        rawHash: '',
        activeView: 'crm/clients',
        validViews,
        hasUser: true,
      }),
    ).toEqual({ kind: 'set-view', view: 'timesheets/tracker' });
  });

  test('resolves login to tracker when user is authenticated', () => {
    expect(
      resolveHashChange({
        rawHash: 'login',
        activeView: 'crm/clients',
        validViews,
        hasUser: true,
      }),
    ).toEqual({ kind: 'set-view', view: 'timesheets/tracker' });
  });

  test('returns noop for login when user is not authenticated', () => {
    expect(
      resolveHashChange({
        rawHash: 'login',
        activeView: 'timesheets/tracker',
        validViews,
        hasUser: false,
      }),
    ).toEqual({ kind: 'noop' });
  });

  test('resolves unknown hash to 404', () => {
    expect(
      resolveHashChange({
        rawHash: 'unknown/route',
        activeView: 'timesheets/tracker',
        validViews,
        hasUser: true,
      }),
    ).toEqual({ kind: 'set-view', view: '404' });
  });
});
