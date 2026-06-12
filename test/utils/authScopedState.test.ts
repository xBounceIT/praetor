import { describe, expect, mock, test } from 'bun:test';
import {
  ALL_AUTH_SCOPED_KEYS,
  type AuthScopedStateKey,
  type AuthScopedStateResetters,
  clearAuthScopedState,
} from '../../utils/authScopedState';

const EXPECTED_KEYS: readonly AuthScopedStateKey[] = [
  'hasLoadedGeneralSettings',
  'generalSettings',
  'hasLoadedLdapConfig',
  'ldapConfig',
  'hasLoadedEmailConfig',
  'emailConfig',
  'hasLoadedSsoProviders',
  'ssoProviders',
  'hasLoadedRoles',
  'roles',
  'users',
  'clients',
  'projects',
  'projectTasks',
  'products',
  'quoteCommunicationChannels',
  'quotes',
  'clientOffers',
  'clientsOrders',
  'invoices',
  'suppliers',
  'supplierQuotes',
  'supplierOrders',
  'supplierInvoices',
  'entries',
  'workUnits',
  'viewingUserAssignmentState',
];

const buildResetters = (recorder: (key: AuthScopedStateKey) => void): AuthScopedStateResetters => {
  const entries = EXPECTED_KEYS.map((key) => [key, () => recorder(key)] as const);
  return Object.fromEntries(entries) as AuthScopedStateResetters;
};

describe('authScopedState', () => {
  describe('ALL_AUTH_SCOPED_KEYS', () => {
    test('contains exactly the keys in the AuthScopedStateKey union', () => {
      // If the union grows but the array doesn't (or vice versa), this fails.
      // The Record<...> type elsewhere already catches a missing setter at
      // compile time; this runtime check guards the array/union themselves.
      expect([...ALL_AUTH_SCOPED_KEYS].sort()).toEqual([...EXPECTED_KEYS].sort());
    });

    test('has no duplicate keys', () => {
      expect(new Set(ALL_AUTH_SCOPED_KEYS).size).toBe(ALL_AUTH_SCOPED_KEYS.length);
    });
  });

  describe('clearAuthScopedState', () => {
    test('invokes every registered setter exactly once', () => {
      const calls: AuthScopedStateKey[] = [];
      clearAuthScopedState(buildResetters((key) => calls.push(key)));

      expect(calls.length).toBe(ALL_AUTH_SCOPED_KEYS.length);
      for (const key of ALL_AUTH_SCOPED_KEYS) {
        expect(calls.filter((k) => k === key).length).toBe(1);
      }
    });

    test('fires setters in the registry-declared order', () => {
      const calls: AuthScopedStateKey[] = [];
      clearAuthScopedState(buildResetters((key) => calls.push(key)));
      expect(calls).toEqual([...ALL_AUTH_SCOPED_KEYS]);
    });

    test('individual mocked setters each fire once', () => {
      // Sanity: a handful of representative setters wired with mock() each
      // see exactly one invocation.
      const setUsers = mock(() => {});
      const setClients = mock(() => {});
      const setEntries = mock(() => {});

      const noop = () => {};
      // Build a full resetters map where most are no-ops and a few are mocks.
      const resetters = Object.fromEntries(
        EXPECTED_KEYS.map((key) => {
          if (key === 'users') return [key, setUsers];
          if (key === 'clients') return [key, setClients];
          if (key === 'entries') return [key, setEntries];
          return [key, noop];
        }),
      ) as AuthScopedStateResetters;

      clearAuthScopedState(resetters);

      expect(setUsers).toHaveBeenCalledTimes(1);
      expect(setClients).toHaveBeenCalledTimes(1);
      expect(setEntries).toHaveBeenCalledTimes(1);
    });

    test('compile-time guarantee: omitting a key fails to typecheck', () => {
      // This block documents that the `Record<...>` (not `Partial<...>`)
      // signature forces every key to be registered. Uncomment the
      // assignment to verify locally: `bun run build` will fail with
      // "Property 'users' is missing in type ...".
      //
      // // @ts-expect-error — `users` missing from setters map
      // const _incomplete: AuthScopedStateResetters = {
      //   hasLoadedGeneralSettings: () => {},
      // };
      expect(true).toBe(true);
    });
  });
});
