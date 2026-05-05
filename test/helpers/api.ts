import { mock } from 'bun:test';

/**
 * Installs a permissive mock for `services/api`.
 * Every sub-API method becomes a jest-style mock that resolves to `{}` by default.
 * Tests override specific methods via `.mockImplementation(...)`.
 *
 * Call once at the top of a test file before importing the component under test.
 * Returns the api object so tests can override methods on it.
 */
export const installApiMock = () => {
  const noop = mock(() => Promise.resolve({}));
  const noopList = mock(() => Promise.resolve([]));

  const apiObject = {
    auth: {
      login: mock((_username: string, _password: string) =>
        Promise.resolve({ user: { id: 'u1' }, token: 't1' }),
      ),
      me: mock(() => Promise.resolve({ id: 'u1' })),
      switchRole: mock((_roleId: string) => Promise.resolve({ user: { id: 'u1' }, token: 't1' })),
      logout: noop,
    },
    settings: {
      get: noop,
      update: noop,
      updatePassword: noop,
    },
    clients: { list: noopList, create: noop, update: noop, delete: noop },
    projects: { list: noopList, create: noop, update: noop, delete: noop },
    products: { list: noopList, create: noop, update: noop, delete: noop },
    quotes: { list: noopList, create: noop, update: noop, delete: noop },
    clientOffers: { list: noopList, create: noop, update: noop, delete: noop },
    clientsOrders: { list: noopList, create: noop, update: noop, delete: noop },
    invoices: { list: noopList, create: noop, update: noop, delete: noop },
    suppliers: { list: noopList, create: noop, update: noop, delete: noop },
    supplierQuotes: { list: noopList, create: noop, update: noop, delete: noop },
    supplierOrders: { list: noopList, create: noop, update: noop, delete: noop },
    supplierInvoices: { list: noopList, create: noop, update: noop, delete: noop },
    entries: { list: noopList, create: noop, update: noop, delete: noop },
    tasks: { list: noopList, create: noop, update: noop, delete: noop },
    users: { list: noopList, create: noop, update: noop, delete: noop, updateRoles: noop },
    employees: { create: noop, update: noop, delete: noop },
    roles: { list: noopList, create: noop, rename: noop, updatePermissions: noop, delete: noop },
    workUnits: { list: noopList, create: noop, update: noop, delete: noop },
    notifications: { list: noopList },
    generalSettings: { get: noop, update: noop },
    ldap: { getConfig: noop, updateConfig: noop },
    email: { getConfig: noop, updateConfig: noop, sendTestEmail: noop },
  };

  mock.module('../../services/api', () => ({
    default: apiObject,
    getAuthToken: () => null,
    setAuthToken: () => {},
  }));

  return apiObject;
};
