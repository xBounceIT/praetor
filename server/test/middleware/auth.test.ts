import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import jwt from 'jsonwebtoken';
import {
  __resetPatIdleTimeoutCacheForTests,
  authenticateToken,
  generateToken,
  getSessionAuth,
  requireAnyPermission,
  requirePermission,
  requireRole,
  requireSessionAuth,
} from '../../middleware/auth.ts';
import * as realAuditLogsRepo from '../../repositories/auditLogsRepo.ts';
import * as realPersonalAccessTokensRepo from '../../repositories/personalAccessTokensRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realPermissions from '../../utils/permissions.ts';
import { hashPersonalAccessToken } from '../../utils/personal-access-token.ts';
import {
  decodeForAssertion,
  signExpiredToken,
  signOverMaxSessionToken,
  signToken,
} from '../helpers/jwt.ts';

// hashPersonalAccessToken (HMAC-keyed) requires ENCRYPTION_KEY at call time.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-bytes-long!!';

// Snapshot the real exports BEFORE mock.module fires so afterAll can restore them. The
// `mock.module` calls inside beforeAll are NOT hoisted (verified empirically on Bun 1.3.14);
// only top-level mock.module calls get hoisted ahead of imports.
const usersRepoSnapshot = { ...realUsersRepo };
const rolesRepoSnapshot = { ...realRolesRepo };
const permissionsSnapshot = { ...realPermissions };
const personalAccessTokensRepoSnapshot = { ...realPersonalAccessTokensRepo };
const auditLogsRepoSnapshot = { ...realAuditLogsRepo };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const findPersonalAccessTokenByHashMock = mock();
const markPersonalAccessTokenUsedMock = mock();
const auditLogsCreateMock = mock();

beforeAll(() => {
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnapshot,
    findAuthUserById: findAuthUserByIdMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnapshot,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnapshot,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/personalAccessTokensRepo.ts', () => ({
    ...personalAccessTokensRepoSnapshot,
    findByTokenHash: findPersonalAccessTokenByHashMock,
    markUsed: markPersonalAccessTokenUsedMock,
  }));
  mock.module('../../repositories/auditLogsRepo.ts', () => ({
    ...auditLogsRepoSnapshot,
    create: auditLogsCreateMock,
  }));
});

afterAll(() => {
  // Restore: future imports of these modules see the real exports again.
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnapshot);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnapshot);
  mock.module('../../utils/permissions.ts', () => permissionsSnapshot);
  mock.module(
    '../../repositories/personalAccessTokensRepo.ts',
    () => personalAccessTokensRepoSnapshot,
  );
  mock.module('../../repositories/auditLogsRepo.ts', () => auditLogsRepoSnapshot);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
  tokenVersion: 1,
};

const HAPPY_PERMISSIONS = ['timesheets.tracker.view', 'timesheets.tracker.create'];

type FakeReply = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  sentCount: number;
  code(c: number): FakeReply;
  send(body: unknown): FakeReply | Promise<FakeReply>;
  header(name: string, value: string): FakeReply;
};

const buildFakeReply = (): FakeReply => {
  const reply: FakeReply = {
    statusCode: 0,
    body: undefined,
    headers: {},
    sentCount: 0,
    code(c: number) {
      reply.statusCode = c;
      return reply;
    },
    send(body: unknown) {
      reply.sentCount += 1;
      reply.body = body;
      return reply;
    },
    header(name: string, value: string) {
      reply.headers[name.toLowerCase()] = value;
      return reply;
    },
  };
  return reply;
};

const buildDeferredSendReply = () => {
  const reply = buildFakeReply();
  const sendNow = reply.send.bind(reply);
  let resolveSend!: () => void;
  const sendCompleted = new Promise<void>((resolve) => {
    resolveSend = resolve;
  });

  reply.send = (body: unknown) => {
    sendNow(body);
    return sendCompleted.then(() => reply);
  };

  return { reply, resolveSend };
};

type FakeRequest = {
  headers: Record<string, string | undefined>;
  auth?: {
    userId: string;
    sessionStart?: number;
    sessionVersion?: number;
    source?: 'session' | 'personalAccessToken';
  };
  user?: {
    id: string;
    name: string;
    username: string;
    role: string;
    avatarInitials: string;
    permissions: string[];
  };
};

const buildFakeRequest = (token?: string): FakeRequest => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
});

beforeEach(() => {
  findAuthUserByIdMock.mockReset();
  userHasRoleMock.mockReset();
  getRolePermissionsMock.mockReset();
  findPersonalAccessTokenByHashMock.mockReset();
  markPersonalAccessTokenUsedMock.mockReset();
  auditLogsCreateMock.mockReset();
  auditLogsCreateMock.mockResolvedValue(undefined);

  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(HAPPY_PERMISSIONS);
  findPersonalAccessTokenByHashMock.mockResolvedValue({
    userId: 'u1',
    tokenHash: hashPersonalAccessToken('praetor_pat_valid-token'),
    tokenPrefix: 'praetor_pat_valid',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastUsedAt: null,
    tokenVersionAtIssue: 1,
  });
  markPersonalAccessTokenUsedMock.mockResolvedValue(undefined);
});

describe('authenticateToken', () => {
  test('401 when Authorization header missing', async () => {
    const request = buildFakeRequest();
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'Access token required' });
  });

  test('403 when token is malformed (jwt.verify throws)', async () => {
    const request = buildFakeRequest('not-a-real-jwt');
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
  });

  test('403 when token is signed with alg=none (algorithm-confusion attack)', async () => {
    // Forge an unsigned token: jwt.sign with algorithm 'none' produces a token whose signature
    // is empty. If the server accepts `alg: 'none'`, anyone can forge an authenticated request.
    // The algorithm allowlist ({ algorithms: ['HS256'] }) must reject this token.
    const forgedToken = jwt.sign(
      { userId: 'u1', sessionStart: Date.now() },
      // jsonwebtoken requires `null` as the secret when using alg=none.
      null as unknown as string,
      { algorithm: 'none' as jwt.Algorithm, expiresIn: '30m' },
    );
    const request = buildFakeRequest(forgedToken);
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
    expect(findAuthUserByIdMock).not.toHaveBeenCalled();
  });

  test('403 when token uses a different HMAC algorithm than the verifier allows', async () => {
    // A token signed with HS512 (still using our shared secret) must be rejected because
    // the allowlist is HS256-only. This guards against future drift between sign/verify.
    const TEST_JWT_SECRET = process.env.JWT_SECRET || 'praetor-test-jwt-secret';
    const wrongAlgToken = jwt.sign({ userId: 'u1', sessionStart: Date.now() }, TEST_JWT_SECRET, {
      algorithm: 'HS512',
      expiresIn: '30m',
    });
    const request = buildFakeRequest(wrongAlgToken);
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
    expect(findAuthUserByIdMock).not.toHaveBeenCalled();
  });

  test('403 when token is idle-expired', async () => {
    const request = buildFakeRequest(signExpiredToken('u1'));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
  });

  test('401 when sessionStart is older than the 8h max session', async () => {
    const request = buildFakeRequest(signOverMaxSessionToken('u1'));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'Session expired (max duration exceeded)' });
  });

  test('401 when usersRepo.findAuthUserById returns null', async () => {
    findAuthUserByIdMock.mockResolvedValue(null);
    const request = buildFakeRequest(signToken({ userId: 'u1' }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'User not found' });
  });

  test('403 when user.isDisabled is true', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, isDisabled: true });
    const request = buildFakeRequest(signToken({ userId: 'u1' }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Account disabled', errorCode: 'account_disabled' });
  });

  test('403 when final constrained role check returns false', async () => {
    userHasRoleMock.mockResolvedValue(false);
    const request = buildFakeRequest(signToken({ userId: 'u1' }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
    expect(getRolePermissionsMock).toHaveBeenCalledWith('manager');
    expect(userHasRoleMock).toHaveBeenCalledWith('u1', 'manager', {
      requireEnabledUser: true,
      expectedSessionVersion: 1,
    });
  });

  const authContextErrorScenarios = [
    {
      name: 'missing user',
      setup: () => findAuthUserByIdMock.mockResolvedValue(null),
      token: () => signToken({ userId: 'u1' }),
      expectedStatus: 401,
      expectedBody: { error: 'User not found' },
    },
    {
      name: 'disabled user',
      setup: () => findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, isDisabled: true }),
      token: () => signToken({ userId: 'u1' }),
      expectedStatus: 403,
      expectedBody: { error: 'Account disabled', errorCode: 'account_disabled' },
    },
    {
      name: 'revoked session',
      setup: () => findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, sessionVersion: 5 }),
      token: () => signToken({ userId: 'u1', sessionVersion: 2 }),
      expectedStatus: 401,
      expectedBody: { error: 'Session revoked', errorCode: 'session_revoked' },
    },
    {
      name: 'unassigned role',
      setup: () => userHasRoleMock.mockResolvedValue(false),
      token: () => signToken({ userId: 'u1' }),
      expectedStatus: 403,
      expectedBody: { error: 'Invalid or expired token' },
    },
  ];

  for (const scenario of authContextErrorScenarios) {
    test(`waits for async ${scenario.name} response before resolving`, async () => {
      scenario.setup();
      const request = buildFakeRequest(scenario.token());
      const { reply, resolveSend } = buildDeferredSendReply();
      let completed = false;

      const inflight = authenticateToken(request as never, reply as never).then(() => {
        completed = true;
      });

      for (let i = 0; i < 5 && reply.body === undefined; i += 1) {
        await Promise.resolve();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reply.statusCode).toBe(scenario.expectedStatus);
      expect(reply.body).toEqual(scenario.expectedBody);
      expect(completed).toBe(false);

      resolveSend();
      await inflight;
      expect(completed).toBe(true);
    });
  }

  test('200 happy path: populates request.user and rotates the x-auth-token header', async () => {
    const sessionStart = Date.now() - 60_000;
    const request = buildFakeRequest(signToken({ userId: 'u1', sessionStart }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
    expect(request.user).toEqual({
      id: 'u1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      avatarInitials: 'AL',
      permissions: HAPPY_PERMISSIONS,
    });
    expect(request.auth).toEqual({
      userId: 'u1',
      sessionStart,
      sessionVersion: 1,
      source: 'session',
    });

    const rotated = reply.headers['x-auth-token'];
    expect(typeof rotated).toBe('string');
    const decoded = decodeForAssertion(rotated) as jwt.JwtPayload & {
      userId: string;
      sessionStart: number;
      activeRole?: string;
      sessionVersion?: number;
    };
    expect(decoded.userId).toBe('u1');
    expect(decoded.sessionStart).toBe(sessionStart);
    expect(decoded.activeRole).toBe('manager');
    expect(decoded.sessionVersion).toBe(1);
  });

  test('401 when token has no sessionVersion (pre-revocation-feature token)', async () => {
    const request = buildFakeRequest(signToken({ userId: 'u1', sessionVersion: null }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({
      error: 'Session token outdated, please log in again',
      errorCode: 'session_outdated',
    });
    expect(findAuthUserByIdMock).not.toHaveBeenCalled();
  });

  test('401 when token sessionVersion does not match the user (logout/revocation)', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, sessionVersion: 5 });
    const request = buildFakeRequest(signToken({ userId: 'u1', sessionVersion: 2 }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'Session revoked', errorCode: 'session_revoked' });
    expect(reply.headers['x-auth-token']).toBeUndefined();
  });

  test('rotated token preserves the user current sessionVersion', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, sessionVersion: 7 });
    const request = buildFakeRequest(signToken({ userId: 'u1', sessionVersion: 7 }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(0);
    const decoded = decodeForAssertion(reply.headers['x-auth-token']) as jwt.JwtPayload & {
      sessionVersion: number;
    };
    expect(decoded.sessionVersion).toBe(7);
  });

  test('decoded.activeRole overrides user.role when present', async () => {
    const request = buildFakeRequest(signToken({ userId: 'u1', activeRole: 'admin' }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(0);
    expect(request.user?.role).toBe('admin');
    expect(getRolePermissionsMock).toHaveBeenCalledWith('admin');
    expect(userHasRoleMock).toHaveBeenCalledWith('u1', 'admin', {
      requireEnabledUser: true,
      expectedSessionVersion: 1,
    });
  });

  test('final role check runs after permission loading with current user constraints', async () => {
    const calls: string[] = [];
    getRolePermissionsMock.mockImplementation(async () => {
      calls.push('permissions');
      return HAPPY_PERMISSIONS;
    });
    userHasRoleMock.mockImplementation(async () => {
      calls.push('role-check');
      return true;
    });

    const request = buildFakeRequest(signToken({ userId: 'u1' }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(0);
    expect(request.user).toBeDefined();
    expect(calls).toEqual(['permissions', 'role-check']);
    expect(userHasRoleMock).toHaveBeenCalledWith('u1', 'manager', {
      requireEnabledUser: true,
      expectedSessionVersion: 1,
    });
  });

  test('a rejection in the final role check produces a single 403 response', async () => {
    userHasRoleMock.mockRejectedValue(new Error('db down'));
    getRolePermissionsMock.mockResolvedValue(HAPPY_PERMISSIONS);

    const request = buildFakeRequest(signToken({ userId: 'u1' }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
    expect(reply.sentCount).toBe(1);
  });

  test('PAT happy path: populates request.user, marks last-used, and does not rotate token', async () => {
    const token = 'praetor_pat_valid-token';
    const request = buildFakeRequest(token);
    const reply = buildFakeReply();

    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(0);
    expect(reply.headers['x-auth-token']).toBeUndefined();
    expect(request.auth).toEqual({ userId: 'u1', source: 'personalAccessToken' });
    expect(request.user).toEqual({
      id: 'u1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      avatarInitials: 'AL',
      permissions: HAPPY_PERMISSIONS,
    });
    const expectedHash = hashPersonalAccessToken(token);
    expect(findPersonalAccessTokenByHashMock).toHaveBeenCalledWith(expectedHash);
    expect(markPersonalAccessTokenUsedMock).toHaveBeenCalledWith(expectedHash);
    expect(getRolePermissionsMock).toHaveBeenCalledWith('manager');
    expect(userHasRoleMock).toHaveBeenCalledWith('u1', 'manager', {
      requireEnabledUser: true,
      expectedSessionVersion: undefined,
    });
  });

  test('PAT remains authenticated when last-used tracking fails', async () => {
    markPersonalAccessTokenUsedMock.mockRejectedValue(new Error('write failed'));
    const token = 'praetor_pat_valid-token';
    const request = buildFakeRequest(token);
    const reply = buildFakeReply();

    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
    expect(request.auth).toEqual({ userId: 'u1', source: 'personalAccessToken' });
    expect(request.user?.id).toBe('u1');
    expect(reply.headers['x-auth-token']).toBeUndefined();
    expect(markPersonalAccessTokenUsedMock).toHaveBeenCalledWith(hashPersonalAccessToken(token));
  });

  test('PAT rejects stale or invalid token hashes', async () => {
    findPersonalAccessTokenByHashMock.mockResolvedValue(null);
    const request = buildFakeRequest('praetor_pat_stale-token');
    const reply = buildFakeReply();

    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
    expect(findAuthUserByIdMock).not.toHaveBeenCalled();
    expect(markPersonalAccessTokenUsedMock).not.toHaveBeenCalled();
  });

  test('PAT rejects disabled users', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, isDisabled: true });
    const request = buildFakeRequest('praetor_pat_valid-token');
    const reply = buildFakeReply();

    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Account disabled', errorCode: 'account_disabled' });
    expect(markPersonalAccessTokenUsedMock).not.toHaveBeenCalled();
  });

  test('PAT rejects users whose primary role is no longer assigned', async () => {
    userHasRoleMock.mockResolvedValue(false);
    const request = buildFakeRequest('praetor_pat_valid-token');
    const reply = buildFakeReply();

    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
    expect(markPersonalAccessTokenUsedMock).not.toHaveBeenCalled();
  });

  test('PAT rejects token whose tokenVersionAtIssue is behind users.token_version', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, tokenVersion: 7 });
    findPersonalAccessTokenByHashMock.mockResolvedValue({
      userId: 'u1',
      tokenHash: hashPersonalAccessToken('praetor_pat_valid-token'),
      tokenPrefix: 'praetor_pat_valid',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastUsedAt: null,
      tokenVersionAtIssue: 3,
    });
    const request = buildFakeRequest('praetor_pat_valid-token');
    const reply = buildFakeReply();

    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Token revoked', errorCode: 'token_revoked' });
    expect(markPersonalAccessTokenUsedMock).not.toHaveBeenCalled();
  });

  describe('PAT idle timeout', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    beforeEach(() => {
      delete process.env.PAT_IDLE_TIMEOUT_MS;
      __resetPatIdleTimeoutCacheForTests();
    });

    test('rejects when lastUsedAt is older than the idle window (default 30d)', async () => {
      const stale = new Date(Date.now() - 31 * DAY_MS);
      findPersonalAccessTokenByHashMock.mockResolvedValue({
        userId: 'u1',
        tokenHash: hashPersonalAccessToken('praetor_pat_valid-token'),
        tokenPrefix: 'praetor_pat_valid',
        createdAt: new Date(Date.now() - 60 * DAY_MS),
        updatedAt: stale,
        lastUsedAt: stale,
      });
      const request = buildFakeRequest('praetor_pat_valid-token');
      const reply = buildFakeReply();

      await authenticateToken(request as never, reply as never);

      expect(reply.statusCode).toBe(403);
      expect(reply.body).toEqual({ error: 'Invalid or expired token' });
      expect(findAuthUserByIdMock).not.toHaveBeenCalled();
      expect(markPersonalAccessTokenUsedMock).not.toHaveBeenCalled();
    });

    test('rejects when lastUsedAt is null and updatedAt is past the idle window', async () => {
      const ancient = new Date(Date.now() - 31 * DAY_MS);
      findPersonalAccessTokenByHashMock.mockResolvedValue({
        userId: 'u1',
        tokenHash: hashPersonalAccessToken('praetor_pat_valid-token'),
        tokenPrefix: 'praetor_pat_valid',
        createdAt: ancient,
        updatedAt: ancient,
        lastUsedAt: null,
      });
      const request = buildFakeRequest('praetor_pat_valid-token');
      const reply = buildFakeReply();

      await authenticateToken(request as never, reply as never);

      expect(reply.statusCode).toBe(403);
      expect(reply.body).toEqual({ error: 'Invalid or expired token' });
      expect(findAuthUserByIdMock).not.toHaveBeenCalled();
    });

    test('accepts a freshly renewed token whose row was originally created long ago', async () => {
      // renewForUser bumps updatedAt and clears lastUsedAt but leaves createdAt untouched.
      // The idle check must read from updatedAt (or it would 403 every renewed PAT whose
      // row predates the idle window).
      findPersonalAccessTokenByHashMock.mockResolvedValue({
        userId: 'u1',
        tokenHash: hashPersonalAccessToken('praetor_pat_valid-token'),
        tokenPrefix: 'praetor_pat_valid',
        createdAt: new Date(Date.now() - 365 * DAY_MS),
        updatedAt: new Date(),
        lastUsedAt: null,
      });
      const request = buildFakeRequest('praetor_pat_valid-token');
      const reply = buildFakeReply();

      await authenticateToken(request as never, reply as never);

      expect(reply.statusCode).toBe(0);
      expect(request.auth).toEqual({ userId: 'u1', source: 'personalAccessToken' });
      expect(markPersonalAccessTokenUsedMock).toHaveBeenCalled();
    });

    test('accepts when lastUsedAt is just inside the idle window', async () => {
      // 29 days ago — under the 30-day default.
      const fresh = new Date(Date.now() - 29 * DAY_MS);
      findPersonalAccessTokenByHashMock.mockResolvedValue({
        userId: 'u1',
        tokenHash: hashPersonalAccessToken('praetor_pat_valid-token'),
        tokenPrefix: 'praetor_pat_valid',
        createdAt: new Date(Date.now() - 60 * DAY_MS),
        updatedAt: fresh,
        lastUsedAt: fresh,
      });
      const request = buildFakeRequest('praetor_pat_valid-token');
      const reply = buildFakeReply();

      await authenticateToken(request as never, reply as never);

      expect(reply.statusCode).toBe(0);
      expect(request.auth).toEqual({ userId: 'u1', source: 'personalAccessToken' });
      expect(markPersonalAccessTokenUsedMock).toHaveBeenCalled();
    });

    test('honours the PAT_IDLE_TIMEOUT_MS override', async () => {
      process.env.PAT_IDLE_TIMEOUT_MS = '60000'; // 60 seconds
      __resetPatIdleTimeoutCacheForTests();
      const stale = new Date(Date.now() - 5 * 60_000); // 5 minutes ago
      findPersonalAccessTokenByHashMock.mockResolvedValue({
        userId: 'u1',
        tokenHash: hashPersonalAccessToken('praetor_pat_valid-token'),
        tokenPrefix: 'praetor_pat_valid',
        createdAt: stale,
        updatedAt: stale,
        lastUsedAt: stale,
      });
      const request = buildFakeRequest('praetor_pat_valid-token');
      const reply = buildFakeReply();

      await authenticateToken(request as never, reply as never);

      expect(reply.statusCode).toBe(403);
      expect(reply.body).toEqual({ error: 'Invalid or expired token' });
    });
  });
});

describe('requireRole', () => {
  test('401 when request.user is undefined', async () => {
    const reply = buildFakeReply();
    await requireRole('manager')({} as never, reply as never);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'Authentication required' });
    // 401 paths must not audit (no user identity is bound to the request).
    expect(auditLogsCreateMock).not.toHaveBeenCalled();
  });

  test('403 when role is not in the allowed list', async () => {
    const reply = buildFakeReply();
    await requireRole('admin')(
      {
        method: 'POST',
        url: '/api/users',
        routeOptions: { url: '/' },
        ip: '10.0.0.5',
        user: { ...HAPPY_USER, permissions: [] },
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Insufficient permissions' });
    expect(auditLogsCreateMock).toHaveBeenCalledTimes(1);
    const insert = auditLogsCreateMock.mock.calls[0][0];
    expect(insert).toMatchObject({
      userId: 'u1',
      action: 'auth.permission_denied',
      entityType: 'route',
      ipAddress: '10.0.0.5',
    });
    expect(insert.details).toMatchObject({
      secondaryLabel: 'role',
      changedFields: ['admin'],
    });
  });

  test('passes when role matches one of the allowed roles', async () => {
    const reply = buildFakeReply();
    await requireRole(
      'admin',
      'manager',
      'user',
    )({ user: { ...HAPPY_USER, permissions: [] } } as never, reply as never);
    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
    expect(auditLogsCreateMock).not.toHaveBeenCalled();
  });
});

describe('requireSessionAuth', () => {
  test('403s as a hook when request auth is not session-backed', async () => {
    const request = {
      auth: { userId: 'u1', source: 'personalAccessToken' },
    };
    const reply = buildFakeReply();

    await requireSessionAuth(request as never, reply as never);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Session authentication required' });
  });

  test('does not return nullable session data from the hook', async () => {
    const request = {
      auth: {
        userId: 'u1',
        source: 'session',
        sessionStart: 123,
        sessionVersion: 2,
      },
    };
    const reply = buildFakeReply();

    const result = await requireSessionAuth(request as never, reply as never);

    expect(result).toBeUndefined();
    expect(reply.statusCode).toBe(0);
    expect(getSessionAuth(request as never)).toEqual({
      userId: 'u1',
      sessionStart: 123,
      sessionVersion: 2,
    });
  });

  test('getSessionAuth throws a 403 error if the session guard was not satisfied', () => {
    const request = {
      auth: { userId: 'u1', source: 'personalAccessToken' },
    };

    expect(() => getSessionAuth(request as never)).toThrow('Session authentication required');
    try {
      getSessionAuth(request as never);
    } catch (error) {
      expect((error as { statusCode?: number }).statusCode).toBe(403);
    }
  });
});

describe('requirePermission (ALL semantics)', () => {
  test('401 when no request.user', async () => {
    const reply = buildFakeReply();
    await requirePermission('timesheets.tracker.view')({} as never, reply as never);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'Authentication required' });
  });

  test('403 when missing one of two required perms', async () => {
    const reply = buildFakeReply();
    await requirePermission('timesheets.tracker.view', 'crm.clients.view')(
      {
        method: 'GET',
        url: '/api/clients',
        routeOptions: { url: '/' },
        ip: '10.0.0.5',
        user: { ...HAPPY_USER, permissions: ['timesheets.tracker.view'] },
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Insufficient permissions' });
    expect(auditLogsCreateMock).toHaveBeenCalledTimes(1);
    const insert = auditLogsCreateMock.mock.calls[0][0];
    expect(insert).toMatchObject({
      userId: 'u1',
      action: 'auth.permission_denied',
      entityType: 'route',
    });
    expect(insert.details).toMatchObject({
      secondaryLabel: 'permission',
      // sorted
      changedFields: ['crm.clients.view', 'timesheets.tracker.view'],
    });
  });

  test('passes when all required perms are present', async () => {
    const reply = buildFakeReply();
    await requirePermission('a.view', 'b.view')(
      { user: { ...HAPPY_USER, permissions: ['a.view', 'b.view', 'c.view'] } } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
  });

  test('normalizes legacy permission aliases before checking all required perms', async () => {
    const reply = buildFakeReply();
    await requirePermission('configuration.general.view', 'suppliers.quotes.create')(
      {
        user: {
          ...HAPPY_USER,
          permissions: ['administration.general.view', 'sales.supplier_quotes.create'],
        },
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
  });

  test('rejects empty permission guards before a route can be registered', () => {
    // @ts-expect-error Regression coverage for runtime JavaScript callers.
    expect(() => requirePermission()).toThrow('requirePermission requires at least one permission');
  });
});

describe('requireAnyPermission (ANY semantics)', () => {
  test('401 when no request.user', async () => {
    const reply = buildFakeReply();
    await requireAnyPermission('timesheets.tracker.view')({} as never, reply as never);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'Authentication required' });
  });

  test('403 when none of the required perms are present', async () => {
    const reply = buildFakeReply();
    await requireAnyPermission('a.view', 'b.view')(
      {
        method: 'GET',
        url: '/api/a',
        routeOptions: { url: '/' },
        ip: '10.0.0.5',
        user: { ...HAPPY_USER, permissions: ['c.view'] },
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Insufficient permissions' });
    expect(auditLogsCreateMock).toHaveBeenCalledTimes(1);
    expect(auditLogsCreateMock.mock.calls[0][0]).toMatchObject({
      action: 'auth.permission_denied',
      entityType: 'route',
    });
  });

  test('passes when at least one matches', async () => {
    const reply = buildFakeReply();
    await requireAnyPermission('a.view', 'b.view')(
      { user: { ...HAPPY_USER, permissions: ['b.view'] } } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
  });

  test('normalizes legacy permission aliases before checking any required perm', async () => {
    const reply = buildFakeReply();
    await requireAnyPermission('crm.clients.view', 'configuration.general.update')(
      { user: { ...HAPPY_USER, permissions: ['administration.general.update'] } } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
  });

  test('vacuous: empty perms list returns 403 (Array.some over zero elements is false)', async () => {
    const reply = buildFakeReply();
    await requireAnyPermission()(
      { user: { ...HAPPY_USER, permissions: ['anything'] } } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Insufficient permissions' });
  });
});

describe('generateToken', () => {
  test('embeds userId, sessionStart, activeRole and sessionVersion; expires in 30m', () => {
    const sessionStart = 1_700_000_000_000;
    const token = generateToken('u1', sessionStart, 'admin', 4);
    const decoded = decodeForAssertion(token) as jwt.JwtPayload & {
      userId: string;
      sessionStart: number;
      activeRole: string;
      sessionVersion: number;
    };
    expect(decoded.userId).toBe('u1');
    expect(decoded.sessionStart).toBe(sessionStart);
    expect(decoded.activeRole).toBe('admin');
    expect(decoded.sessionVersion).toBe(4);
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(30 * 60);
  });
});
