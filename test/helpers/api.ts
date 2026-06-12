import { mock } from 'bun:test';
import { ApiErrorStub } from './apiErrorStub';

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
  const noopList = mock((): Promise<unknown[]> => Promise.resolve([]));

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
      getPersonalAccessToken: noop,
      renewPersonalAccessToken: noop,
    },
    clients: { list: noopList, create: noop, update: noop, delete: noop },
    projects: {
      list: noopList,
      listOrderOptions: noopList,
      create: noop,
      update: noop,
      delete: noop,
    },
    products: { list: noopList, create: noop, update: noop, delete: noop },
    quotes: { list: noopList, create: noop, update: noop, delete: noop },
    clientOffers: { list: noopList, create: noop, update: noop, delete: noop },
    clientsOrders: { list: noopList, create: noop, update: noop, delete: noop },
    invoices: { list: noopList, create: noop, update: noop, delete: noop },
    suppliers: { list: noopList, create: noop, update: noop, delete: noop },
    supplierQuotes: { list: noopList, create: noop, update: noop, delete: noop },
    supplierOrders: { list: noopList, create: noop, update: noop, delete: noop },
    supplierInvoices: { list: noopList, create: noop, update: noop, delete: noop },
    entries: {
      list: noopList,
      listPage: mock(() => Promise.resolve({ entries: [] as unknown[], nextCursor: null })),
      create: noop,
      update: noop,
      delete: noop,
      generateRecurring: noop,
    },
    rilDrafts: {
      // Parameters are typed so `.mock.calls[i]` is a real tuple in tests.
      get: mock((_monthKey: string, _userId?: string) =>
        Promise.resolve({
          monthKey: '',
          rows: {} as Record<string, unknown>,
          updatedAt: null as string | null,
        }),
      ),
      save: mock(
        (
          _monthKey: string,
          _rows: Record<string, unknown>,
          _userId?: string,
          _changedDays?: number[],
        ) =>
          Promise.resolve({
            monthKey: '',
            rows: {} as Record<string, unknown>,
            updatedAt: null as string | null,
          }),
      ),
      // Dedicated mock (not the shared `noop`): RilView.handleReset awaits `remove(...).catch(...)`,
      // and tests that `mockReset()` the shared `noop` would otherwise make this return undefined.
      // `Promise<unknown>` lets tests pin any resolved value via `mockResolvedValue`.
      remove: mock(
        (_monthKey: string, _userId?: string): Promise<unknown> => Promise.resolve(undefined),
      ),
    },
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
    ApiError: ApiErrorStub,
    getAuthToken: () => null,
    setAuthToken: () => {},
  }));

  return apiObject;
};
