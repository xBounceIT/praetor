import { describe, expect, test } from 'bun:test';
import type { View } from '../../types';
import { canonicalizeLegacyHash, resolveHashChange } from '../../utils/hashCanonicalization';

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
