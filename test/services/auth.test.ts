import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LoginResponse } from '../../services/api/contracts';
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
const canonicalUser = {
  id: 'u-1',
  name: 'Canonical User',
  username: 'canonical',
  role: 'admin',
  avatarInitials: 'CU',
  availableRoles: [{ id: 'admin', name: 'Admin', isAdmin: true, permissions: [] }],
  permissions: ['*'],
  costPerHour: 0,
  hasTopManagerRole: false,
  isAdminOnly: false,
};

// `authApi.login` now returns a `LoginResult` union: the canonical { token, user }
// or one of the TOTP short-circuit branches. Narrow to the canonical branch (and
// assert we actually got it) so the token/user assertions type-check.
const assertLoginResponse = (result: unknown): LoginResponse => {
  expect(result).toBeTruthy();
  expect(typeof result).toBe('object');
  expect('token' in (result as object)).toBe(true);
  return result as LoginResponse;
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
    test('POSTs to /auth/login, persists token, uses response user without /auth/me', async () => {
      programRoutes({
        '/auth/login': { token: 'login-token', user: { ...canonicalUser } },
      });

      const result = assertLoginResponse(await authApi.login('alice', 'secret'));

      // Exactly one network call — /auth/me must not be invoked when the
      // login response already carries a canonical user (issue #616).
      expect(fetchMock.mock.calls).toHaveLength(1);
      const loginCall = fetchMock.mock.calls[0];
      expect(String(loginCall[0])).toContain('/auth/login');
      expect((loginCall[1] as { method: string }).method).toBe('POST');
      expect((loginCall[1] as { body: string }).body).toBe(
        JSON.stringify({ username: 'alice', password: 'secret' }),
      );

      // Token was persisted via setAuthToken (visible through getAuthToken).
      expect(getAuthToken()).toBe('login-token');
      expect(result.token).toBe('login-token');
      expect(result.user.id).toBe('u-1');
      expect(result.user.username).toBe('canonical');
    });

    test('falls back to /auth/me when the login response user fails normalization', async () => {
      programRoutes({
        '/auth/login': { token: 'login-token', user: { id: 'ignored' } },
        '/auth/me': { ...canonicalUser },
      });

      const result = assertLoginResponse(await authApi.login('alice', 'secret'));

      expect(fetchMock.mock.calls).toHaveLength(2);
      expect(String(fetchMock.mock.calls[1][0])).toContain('/auth/me');
      expect(result.user.id).toBe('u-1');
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

    test('returns the TOTP challenge branch without persisting a token', async () => {
      setAuthToken('old-token');
      programRoutes({
        '/auth/login': { totpRequired: true, challengeToken: 'challenge-123' },
      });

      const result = await authApi.login('alice', 'secret');

      expect(result).toEqual({ totpRequired: true, challengeToken: 'challenge-123' });
      // No session token issued yet — the challenge must be solved first. The
      // pre-existing token is left untouched (login did not clear it).
      expect(getAuthToken()).toBe('old-token');
      // Only the /auth/login probe ran; no /auth/me finalize.
      expect(fetchMock.mock.calls).toHaveLength(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/login');
    });

    test('returns the forced-enrollment branch without persisting a token', async () => {
      programRoutes({
        '/auth/login': { totpEnrollmentRequired: true, enrollToken: 'enroll-456' },
      });

      const result = await authApi.login('alice', 'secret');

      expect(result).toEqual({ totpEnrollmentRequired: true, enrollToken: 'enroll-456' });
      expect(getAuthToken()).toBeNull();
      expect(fetchMock.mock.calls).toHaveLength(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/login');
    });

    test('finalizes normally when neither TOTP branch is signalled', async () => {
      // A response carrying a challengeToken but `totpRequired` falsy must not
      // be mistaken for the challenge branch — it falls through to finalize.
      programRoutes({
        '/auth/login': { token: 'login-token', user: { ...canonicalUser }, totpRequired: false },
      });

      const result = assertLoginResponse(await authApi.login('alice', 'secret'));

      expect(result.token).toBe('login-token');
      expect(result.user.id).toBe('u-1');
      expect(getAuthToken()).toBe('login-token');
    });
  });

  describe('totpChallenge', () => {
    test('POSTs the challenge token + code, persists the issued token, returns the canonical user', async () => {
      programRoutes({
        '/auth/totp-challenge': { token: 'challenge-token', user: { ...canonicalUser } },
      });

      const result = await authApi.totpChallenge('challenge-123', '123456');

      expect(fetchMock.mock.calls).toHaveLength(1);
      const call = fetchMock.mock.calls[0];
      expect(String(call[0])).toContain('/auth/totp-challenge');
      expect((call[1] as { method: string }).method).toBe('POST');
      expect((call[1] as { body: string }).body).toBe(
        JSON.stringify({ challengeToken: 'challenge-123', code: '123456' }),
      );

      expect(getAuthToken()).toBe('challenge-token');
      expect(result.token).toBe('challenge-token');
      expect(result.user.id).toBe('u-1');
      expect(result.user.username).toBe('canonical');
    });

    test('falls back to /auth/me when the challenge response user fails normalization', async () => {
      programRoutes({
        '/auth/totp-challenge': { token: 'challenge-token', user: {} },
        '/auth/me': { ...canonicalUser },
      });

      const result = await authApi.totpChallenge('challenge-123', '123456');

      expect(fetchMock.mock.calls).toHaveLength(2);
      expect(String(fetchMock.mock.calls[1][0])).toContain('/auth/me');
      expect(result.user.id).toBe('u-1');
    });

    test('restores the previous token when the challenge fails', async () => {
      setAuthToken('prev');
      fetchMock.mockImplementation(async () => respondWith({ message: 'bad code' }, 401));

      await expect(authApi.totpChallenge('challenge-123', '000000')).rejects.toThrow('bad code');
      expect(getAuthToken()).toBe('prev');
    });
  });

  describe('totpSetup', () => {
    const setupBody = {
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/Praetor:alice?secret=JBSWY3DPEHPK3PXP',
      qrDataUri: 'data:image/png;base64,abc',
      backupCodes: ['code-1', 'code-2'],
    };

    test('POSTs to /auth/2fa/setup and returns the setup payload', async () => {
      programRoutes({ '/auth/2fa/setup': { ...setupBody } });

      const result = await authApi.totpSetup();

      expect(fetchMock.mock.calls).toHaveLength(1);
      const call = fetchMock.mock.calls[0];
      expect(String(call[0])).toContain('/auth/2fa/setup');
      expect((call[1] as { method: string }).method).toBe('POST');
      expect(result).toEqual(setupBody);
    });

    test('sends Authorization: Bearer <bearerToken> when an enroll token is supplied', async () => {
      // During forced enrollment there is no persisted session token yet, so the
      // caller passes the enroll token explicitly for this one request.
      programRoutes({ '/auth/2fa/setup': { ...setupBody } });

      await authApi.totpSetup('enroll-456');

      const call = fetchMock.mock.calls[0];
      const headers = (call[1] as { headers: Record<string, string> }).headers;
      expect(headers.Authorization).toBe('Bearer enroll-456');
    });
  });

  describe('totpConfirm', () => {
    test('persists the issued token + returns the canonical user when confirm completes enrollment', async () => {
      programRoutes({
        '/auth/2fa/confirm': { enabled: true, token: 'enroll-session', user: { ...canonicalUser } },
      });

      const result = await authApi.totpConfirm('123456', 'enroll-456');

      const call = fetchMock.mock.calls[0];
      expect(String(call[0])).toContain('/auth/2fa/confirm');
      expect((call[1] as { method: string }).method).toBe('POST');
      expect((call[1] as { body: string }).body).toBe(JSON.stringify({ code: '123456' }));
      // Enroll token forwarded as the bearer for this confirm request.
      expect((call[1] as { headers: Record<string, string> }).headers.Authorization).toBe(
        'Bearer enroll-456',
      );

      expect(getAuthToken()).toBe('enroll-session');
      expect(result.enabled).toBe(true);
      expect(result.token).toBe('enroll-session');
      expect(result.user?.id).toBe('u-1');
    });

    test('returns { enabled: true } without touching the token when no session is issued', async () => {
      programRoutes({ '/auth/2fa/confirm': { enabled: true } });

      const result = await authApi.totpConfirm('123456');

      expect(result).toEqual({ enabled: true });
      expect(result.token).toBeUndefined();
      expect(result.user).toBeUndefined();
      // Already-authenticated confirm path leaves the existing token unchanged.
      expect(getAuthToken()).toBeNull();
    });
  });

  describe('getTotpStatus', () => {
    test('GETs /auth/2fa/status and returns the body', async () => {
      programRoutes({ '/auth/2fa/status': { enabled: true, applicable: true } });

      const result = await authApi.getTotpStatus();

      const call = fetchMock.mock.calls[0];
      expect(String(call[0])).toContain('/auth/2fa/status');
      // GET has no explicit method override in the client call.
      expect((call[1] as { method?: string }).method).toBeUndefined();
      expect(result).toEqual({ enabled: true, applicable: true });
    });
  });

  describe('consumeSsoTicket', () => {
    test('POSTs to /auth/sso/consume and uses response user without /auth/me', async () => {
      programRoutes({
        '/auth/sso/consume': { token: 'sso-token', user: { ...canonicalUser } },
      });

      const result = await authApi.consumeSsoTicket('ticket-abc');

      // No fallback /auth/me when the response user is canonical (issue #616).
      expect(fetchMock.mock.calls).toHaveLength(1);
      const consumeCall = fetchMock.mock.calls[0];
      expect(String(consumeCall[0])).toContain('/auth/sso/consume');
      expect((consumeCall[1] as { method: string }).method).toBe('POST');
      expect((consumeCall[1] as { body: string }).body).toBe(
        JSON.stringify({ ticket: 'ticket-abc' }),
      );

      expect(getAuthToken()).toBe('sso-token');
      expect(result.token).toBe('sso-token');
      expect(result.user.id).toBe('u-1');
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

    test('throws when /auth/me responds with an empty available roles list', async () => {
      programRoutes({ '/auth/me': { ...canonicalUser, availableRoles: [] } });
      await expect(authApi.me()).rejects.toThrow('Invalid authentication response');
    });
  });

  describe('switchRole', () => {
    test('POSTs to /auth/switch-role and uses response user without /auth/me', async () => {
      programRoutes({
        '/auth/switch-role': { token: 'role-token', user: { ...canonicalUser, role: 'admin' } },
      });

      const result = await authApi.switchRole('admin');

      // No fallback /auth/me when the response user is canonical (issue #616).
      expect(fetchMock.mock.calls).toHaveLength(1);
      const switchCall = fetchMock.mock.calls[0];
      expect(String(switchCall[0])).toContain('/auth/switch-role');
      expect((switchCall[1] as { method: string }).method).toBe('POST');
      expect((switchCall[1] as { body: string }).body).toBe(JSON.stringify({ roleId: 'admin' }));

      expect(getAuthToken()).toBe('role-token');
      expect(result.token).toBe('role-token');
      expect(result.user.role).toBe('admin');
    });

    test('falls back to /auth/me when the switch-role response user fails normalization', async () => {
      programRoutes({
        '/auth/switch-role': { token: 'role-token', user: {} },
        '/auth/me': { ...canonicalUser, role: 'admin' },
      });

      const result = await authApi.switchRole('admin');

      expect(fetchMock.mock.calls).toHaveLength(2);
      expect(String(fetchMock.mock.calls[1][0])).toContain('/auth/me');
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
