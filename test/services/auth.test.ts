import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildResponse } from '../helpers/fetchMock';

// Stub fetch globally; the real client.ts will call it under the hood.
const respondWith = (body: unknown, status = 200) => buildResponse({ status, json: () => body });

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_input: unknown, _init?: unknown): Promise<unknown> => respondWith({}),
);
globalThis.fetch = fetchMock as unknown as typeof fetch;

// Load the real auth module - it pulls in the real client.ts, which calls our fetch mock.
const { authApi } = await import('../../services/api/auth');
const { getAuthToken, setAuthToken } = await import('../../services/api/client');

// Canonical user shape that passes every guard inside `normalizeAuthUser`.
// Mirrors the full server contract: email, costPerHour, employeeType, and
// authMethod must all be present - the normalizer rejects partial payloads.
const canonicalUser = {
  id: 'u-1',
  name: 'Canonical User',
  username: 'canonical',
  role: 'admin',
  avatarInitials: 'CU',
  email: 'canonical@example.com',
  costPerHour: 42.5,
  employeeType: 'app_user' as const,
  authMethod: 'local' as const,
  authProviderId: null,
  authProviderName: null,
  isDisabled: false,
  availableRoles: [{ id: 'admin', name: 'Admin', isAdmin: true, permissions: [] }],
  permissions: ['*'],
  hasTopManagerRole: false,
  isAdminOnly: false,
};

// Routes fetch by URL substring so each test can program just the responses it cares about.
const programRoutes = (routes: Record<string, unknown | (() => unknown)>) => {
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    for (const [pattern, response] of Object.entries(routes)) {
      if (url.endsWith(pattern)) {
        const body = typeof response === 'function' ? (response as () => unknown)() : response;
        return respondWith(body);
      }
    }
    throw new Error(`unexpected fetch URL: ${url}`);
  });
};

beforeEach(() => {
  fetchMock.mockReset();
  setAuthToken(null);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('authApi', () => {
  describe('login', () => {
    test('POSTs to /auth/login, persists token, fetches /auth/me, returns canonical response', async () => {
      programRoutes({
        '/auth/login': { token: 'login-token', user: { id: 'ignored' } },
        '/auth/me': { ...canonicalUser },
      });

      const result = await authApi.login('alice', 'secret');

      // First call sends credentials.
      const loginCall = fetchMock.mock.calls[0];
      expect(String(loginCall[0])).toContain('/auth/login');
      expect((loginCall[1] as { method: string }).method).toBe('POST');
      expect((loginCall[1] as { body: string }).body).toBe(
        JSON.stringify({ username: 'alice', password: 'secret' }),
      );

      // Second call fetches the canonical user.
      expect(String(fetchMock.mock.calls[1][0])).toContain('/auth/me');

      // Token was persisted via setAuthToken (visible through getAuthToken).
      expect(getAuthToken()).toBe('login-token');
      expect(result.token).toBe('login-token');
      expect(result.user.id).toBe('u-1');
      expect(result.user.username).toBe('canonical');
    });

    test('rejects when login response has a blank token, restores previous token', async () => {
      setAuthToken('old-token');
      programRoutes({ '/auth/login': { token: '   ', user: {} } });

      await expect(authApi.login('a', 'b')).rejects.toThrow('Invalid authentication response');
      expect(getAuthToken()).toBe('old-token');
    });

    test('restores previous token if /auth/me fails after login succeeds', async () => {
      setAuthToken('old-token');
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/auth/login')) return respondWith({ token: 'new-token', user: {} });
        // /auth/me returns an HTTP error → fetchApi throws.
        return respondWith({ message: 'me failed' }, 500);
      });

      await expect(authApi.login('a', 'b')).rejects.toThrow('me failed');
      // Previous token restored on error.
      expect(getAuthToken()).toBe('old-token');
    });

    test('rejects when canonical user fails normalization (missing username)', async () => {
      programRoutes({
        '/auth/login': { token: 't', user: {} },
        '/auth/me': { ...canonicalUser, username: '' },
      });

      await expect(authApi.login('a', 'b')).rejects.toThrow('Invalid authentication response');
    });

    test('rejects when active role is not in availableRoles', async () => {
      programRoutes({
        '/auth/login': { token: 't', user: {} },
        '/auth/me': {
          ...canonicalUser,
          role: 'manager',
          availableRoles: [{ id: 'admin', name: 'Admin', isAdmin: true, permissions: [] }],
        },
      });

      await expect(authApi.login('a', 'b')).rejects.toThrow('Invalid authentication response');
    });
  });

  describe('me', () => {
    test('fetches /auth/me and returns the normalized canonical user', async () => {
      programRoutes({ '/auth/me': { ...canonicalUser } });

      const user = await authApi.me();
      expect(user.id).toBe('u-1');
      expect(user.username).toBe('canonical');
      expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/me');
    });

    test('propagates canonical user fields (email, costPerHour, employeeType)', async () => {
      programRoutes({
        '/auth/me': {
          ...canonicalUser,
          email: 'real@user.com',
          costPerHour: 99.5,
          employeeType: 'internal',
        },
      });

      const user = await authApi.me();
      expect(user.email).toBe('real@user.com');
      expect(user.costPerHour).toBe(99.5);
      expect(user.employeeType).toBe('internal');
    });

    test('throws when /auth/me responds with an empty available roles list', async () => {
      programRoutes({ '/auth/me': { ...canonicalUser, availableRoles: [] } });
      await expect(authApi.me()).rejects.toThrow('Invalid authentication response');
    });

    test.each([
      ['email', { email: undefined }],
      ['costPerHour', { costPerHour: undefined }],
      ['employeeType', { employeeType: undefined }],
      ['authMethod', { authMethod: undefined }],
    ])('throws when /auth/me is missing %s instead of inventing a default', async (_field, patch) => {
      programRoutes({ '/auth/me': { ...canonicalUser, ...patch } });
      await expect(authApi.me()).rejects.toThrow('Invalid authentication response');
    });
  });

  describe('switchRole', () => {
    test('POSTs to /auth/switch-role with the requested roleId and returns canonical response', async () => {
      programRoutes({
        '/auth/switch-role': { token: 'role-token', user: {} },
        '/auth/me': { ...canonicalUser, role: 'admin' },
      });

      const result = await authApi.switchRole('admin');

      const switchCall = fetchMock.mock.calls[0];
      expect(String(switchCall[0])).toContain('/auth/switch-role');
      expect((switchCall[1] as { method: string }).method).toBe('POST');
      expect((switchCall[1] as { body: string }).body).toBe(JSON.stringify({ roleId: 'admin' }));

      expect(getAuthToken()).toBe('role-token');
      expect(result.token).toBe('role-token');
      expect(result.user.role).toBe('admin');
    });

    test('restores previous token if switch fails', async () => {
      setAuthToken('prev');
      fetchMock.mockImplementation(async () => respondWith({ message: 'switch failed' }, 500));

      await expect(authApi.switchRole('admin')).rejects.toThrow('switch failed');
      expect(getAuthToken()).toBe('prev');
    });
  });
});
