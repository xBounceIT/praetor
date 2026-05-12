import { describe, expect, mock, test } from 'bun:test';
import {
  ALL_MODULE_SCOPED_KEYS,
  clearStaleModuleScopedState,
  getStaleModuleScopedKeys,
  getStaleModulesAfterNavigation,
  type ModuleScopedStateKey,
} from '../../utils/moduleScopedState';

describe('moduleScopedState', () => {
  describe('getStaleModuleScopedKeys', () => {
    test('returns empty array for null module', () => {
      expect(getStaleModuleScopedKeys(null)).toEqual([]);
    });

    test('returns empty array for unknown module', () => {
      expect(getStaleModuleScopedKeys('unknown-module')).toEqual([]);
    });

    test('modules with no module-scoped state stale everything', () => {
      // Reports/settings own no module-scoped arrays, so every leftover key
      // is stale and should be cleared when entering them.
      expect(getStaleModuleScopedKeys('reports')).toEqual(ALL_MODULE_SCOPED_KEYS.slice());
      expect(getStaleModuleScopedKeys('settings')).toEqual(ALL_MODULE_SCOPED_KEYS.slice());
    });

    test('CRM keeps clients and suppliers but stales everything else', () => {
      const stale = getStaleModuleScopedKeys('crm');
      // CRM owns clients + suppliers, so those should NOT be in the stale list.
      expect(stale).not.toContain('clients');
      expect(stale).not.toContain('suppliers');
      // Cross-module data that CRM doesn't touch must be marked stale so it
      // doesn't leak in when navigating from another module into CRM.
      expect(stale).toContain('projects');
      expect(stale).toContain('projectTasks');
      expect(stale).toContain('entries');
      expect(stale).toContain('invoices');
      expect(stale).toContain('quotes');
      expect(stale).toContain('clientOffers');
      expect(stale).toContain('supplierOrders');
      expect(stale).toContain('supplierInvoices');
    });

    test('projects module keeps its arrays and stales sales/accounting-only data', () => {
      const stale = getStaleModuleScopedKeys('projects');
      // projects owns projects/projectTasks/clients/users/workUnits/clientsOrders
      expect(stale).not.toContain('projects');
      expect(stale).not.toContain('projectTasks');
      expect(stale).not.toContain('clients');
      expect(stale).not.toContain('users');
      expect(stale).not.toContain('workUnits');
      expect(stale).not.toContain('clientsOrders');
      // Projects doesn't touch sales/accounting data — must be cleared.
      expect(stale).toContain('quotes');
      expect(stale).toContain('clientOffers');
      expect(stale).toContain('invoices');
      expect(stale).toContain('supplierQuotes');
      expect(stale).toContain('supplierOrders');
      expect(stale).toContain('supplierInvoices');
      // projects doesn't touch suppliers/products either.
      expect(stale).toContain('suppliers');
      expect(stale).toContain('products');
      // projects doesn't touch entries.
      expect(stale).toContain('entries');
    });

    test('catalog (smallest module) stales nearly everything', () => {
      const stale = getStaleModuleScopedKeys('catalog');
      expect(stale).not.toContain('products');
      // Catalog only owns products, so 14 of 15 known keys are stale.
      expect(stale).toHaveLength(ALL_MODULE_SCOPED_KEYS.length - 1);
    });

    test('every stale key is a member of ALL_MODULE_SCOPED_KEYS', () => {
      const knownKeys = new Set<ModuleScopedStateKey>(ALL_MODULE_SCOPED_KEYS);
      const stale = getStaleModuleScopedKeys('crm');
      for (const key of stale) {
        expect(knownKeys.has(key)).toBe(true);
      }
    });
  });

  describe('clearStaleModuleScopedState', () => {
    test('invokes only the setters for stale keys', () => {
      const setClients = mock(() => {});
      const setSuppliers = mock(() => {});
      const setProjects = mock(() => {});
      const setEntries = mock(() => {});

      // Going INTO CRM. CRM keeps clients + suppliers. Projects/entries are
      // stale and their setters should fire.
      clearStaleModuleScopedState('crm', {
        clients: setClients,
        suppliers: setSuppliers,
        projects: setProjects,
        entries: setEntries,
      });

      expect(setClients).not.toHaveBeenCalled();
      expect(setSuppliers).not.toHaveBeenCalled();
      expect(setProjects).toHaveBeenCalledTimes(1);
      expect(setEntries).toHaveBeenCalledTimes(1);
    });

    test('returns the list of cleared keys', () => {
      // Only supply a subset of setters — the helper should only report
      // the keys it actually cleared.
      const cleared = clearStaleModuleScopedState('crm', {
        projects: () => {},
        invoices: () => {},
      });
      expect(cleared).toContain('projects');
      expect(cleared).toContain('invoices');
      // suppliers/clients are NOT stale for CRM, so even if a setter were
      // passed they wouldn't be in the result.
      expect(cleared).not.toContain('suppliers');
      expect(cleared).not.toContain('clients');
    });

    test('no-ops for null or unknown module', () => {
      const setClients = mock(() => {});
      clearStaleModuleScopedState(null, { clients: setClients });
      clearStaleModuleScopedState('mystery', { clients: setClients });
      expect(setClients).not.toHaveBeenCalled();
    });

    test('skips missing setters gracefully', () => {
      // We don't supply a setter for `quotes` even though it's stale for CRM —
      // helper should not throw and should report only what it cleared.
      const setProjects = mock(() => {});
      const cleared = clearStaleModuleScopedState('crm', {
        projects: setProjects,
      });
      expect(setProjects).toHaveBeenCalledTimes(1);
      expect(cleared).toEqual(['projects']);
    });

    test('repros the bug: switching from CRM to accounting clears stale CRM-only data', () => {
      // CRM had loaded suppliers; accounting also loads suppliers so that's
      // fine — but accounting doesn't touch CRM's "supplierQuotes" or
      // "quotes" if they happened to be lingering. (Test that "quotes" is
      // among the stale keys when entering accounting.)
      const setQuotes = mock(() => {});
      const setClientOffers = mock(() => {});
      const setSupplierQuotes = mock(() => {});
      const setEntries = mock(() => {});

      const cleared = clearStaleModuleScopedState('accounting', {
        quotes: setQuotes,
        clientOffers: setClientOffers,
        supplierQuotes: setSupplierQuotes,
        entries: setEntries,
      });

      expect(setQuotes).toHaveBeenCalledTimes(1);
      expect(setClientOffers).toHaveBeenCalledTimes(1);
      expect(setSupplierQuotes).toHaveBeenCalledTimes(1);
      expect(setEntries).toHaveBeenCalledTimes(1);
      const expected: ModuleScopedStateKey[] = [
        'clientOffers',
        'entries',
        'quotes',
        'supplierQuotes',
      ];
      expect([...cleared].sort()).toEqual([...expected].sort());
    });
  });

  describe('getStaleModulesAfterNavigation', () => {
    test('returns empty array for null module', () => {
      expect(getStaleModulesAfterNavigation(null)).toEqual([]);
    });

    test('navigating to reports stales every module with owned state', () => {
      // Reports owns nothing, so any module that owned state has its data
      // cleared and must be re-fetched on revisit.
      const stale = getStaleModulesAfterNavigation('reports');
      expect(stale).toContain('timesheets');
      expect(stale).toContain('crm');
      expect(stale).toContain('sales');
      expect(stale).toContain('accounting');
      expect(stale).toContain('catalog');
      expect(stale).toContain('projects');
      expect(stale).toContain('suppliers');
      expect(stale).toContain('hr');
      expect(stale).toContain('administration');
      // Modules without owned state are never stale (nothing to clear).
      expect(stale).not.toContain('reports');
      expect(stale).not.toContain('settings');
    });

    test('navigating from CRM to sales does not stale CRM (shared keys preserved)', () => {
      // CRM owns clients+suppliers; sales also owns clients+suppliers, so
      // CRM's data is not cleared and CRM should not be invalidated.
      const stale = getStaleModulesAfterNavigation('sales');
      expect(stale).not.toContain('crm');
    });

    test('navigating from timesheets to CRM stales timesheets', () => {
      // CRM owns only clients+suppliers; timesheets owns entries+clients+
      // projects+projectTasks+users — its non-overlapping keys get cleared.
      const stale = getStaleModulesAfterNavigation('crm');
      expect(stale).toContain('timesheets');
      // CRM itself should never appear.
      expect(stale).not.toContain('crm');
    });

    test('returns empty for unknown module', () => {
      expect(getStaleModulesAfterNavigation('does-not-exist')).toEqual([]);
    });
  });
});
