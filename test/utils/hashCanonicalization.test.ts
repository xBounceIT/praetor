import { describe, expect, test } from 'bun:test';
import { canonicalizeLegacyHash } from '../../utils/hashCanonicalization';

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
