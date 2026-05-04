import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type jwt from 'jsonwebtoken';
import {
  authenticateToken,
  generateToken,
  requireAnyPermission,
  requirePermission,
  requireRole,
} from '../../middleware/auth.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  decodeForAssertion,
  signExpiredToken,
  signOverMaxSessionToken,
  signToken,
} from '../helpers/jwt.ts';

// Snapshot the real exports BEFORE mock.module fires so afterAll can restore them. The
// `mock.module` calls inside beforeAll are NOT hoisted (verified empirically on Bun 1.3.13);
// only top-level mock.module calls get hoisted ahead of imports.
const usersRepoSnapshot = { ...realUsersRepo };
const rolesRepoSnapshot = { ...realRolesRepo };
const permissionsSnapshot = { ...realPermissions };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

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
});

afterAll(() => {
  // Restore: future imports of these modules see the real exports again.
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnapshot);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnapshot);
  mock.module('../../utils/permissions.ts', () => permissionsSnapshot);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
};

const HAPPY_PERMISSIONS = ['timesheets.tracker.view', 'timesheets.tracker.create'];

type FakeReply = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  sentCount: number;
  code(c: number): FakeReply;
  send(body: unknown): FakeReply;
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

type FakeRequest = {
  headers: Record<string, string | undefined>;
  auth?: { userId: string; sessionStart: number };
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

  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(HAPPY_PERMISSIONS);
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

  test('401 when user.isDisabled is true', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, isDisabled: true });
    const request = buildFakeRequest(signToken({ userId: 'u1' }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
  });

  test('403 when rolesRepo.userHasRole returns false', async () => {
    userHasRoleMock.mockResolvedValue(false);
    const request = buildFakeRequest(signToken({ userId: 'u1' }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
  });

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
    expect(request.auth).toEqual({ userId: 'u1', sessionStart });

    const rotated = reply.headers['x-auth-token'];
    expect(typeof rotated).toBe('string');
    const decoded = decodeForAssertion(rotated) as jwt.JwtPayload & {
      userId: string;
      sessionStart: number;
      activeRole?: string;
    };
    expect(decoded.userId).toBe('u1');
    expect(decoded.sessionStart).toBe(sessionStart);
    expect(decoded.activeRole).toBe('manager');
  });

  test('decoded.activeRole overrides user.role when present', async () => {
    const request = buildFakeRequest(signToken({ userId: 'u1', activeRole: 'admin' }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(0);
    expect(request.user?.role).toBe('admin');
    expect(userHasRoleMock).toHaveBeenCalledWith('u1', 'admin');
    expect(getRolePermissionsMock).toHaveBeenCalledWith('admin');
  });

  test('userHasRole and getRolePermissions are invoked concurrently (no serial await)', async () => {
    let resolveRole!: () => void;
    let resolvePerms!: () => void;
    let signalRoleCalled!: () => void;
    let signalPermsCalled!: () => void;

    const rolePromise = new Promise<void>((resolve) => {
      resolveRole = resolve;
    });
    const permsPromise = new Promise<void>((resolve) => {
      resolvePerms = resolve;
    });
    const roleCalledPromise = new Promise<void>((resolve) => {
      signalRoleCalled = resolve;
    });
    const permsCalledPromise = new Promise<void>((resolve) => {
      signalPermsCalled = resolve;
    });

    userHasRoleMock.mockImplementation(async () => {
      signalRoleCalled();
      await rolePromise;
      return true;
    });
    getRolePermissionsMock.mockImplementation(async () => {
      signalPermsCalled();
      await permsPromise;
      return HAPPY_PERMISSIONS;
    });

    const request = buildFakeRequest(signToken({ userId: 'u1' }));
    const reply = buildFakeReply();
    const inflight = authenticateToken(request as never, reply as never);

    // Deterministic sync point: both mocks signal as soon as their bodies start. If either
    // were awaiting the other, this Promise.all would hang past the test timeout instead
    // of relying on a fixed sleep that's flaky under CI load.
    await Promise.all([roleCalledPromise, permsCalledPromise]);
    expect(userHasRoleMock).toHaveBeenCalledTimes(1);
    expect(getRolePermissionsMock).toHaveBeenCalledTimes(1);

    resolveRole();
    resolvePerms();
    await inflight;
    expect(reply.statusCode).toBe(0);
    expect(request.user).toBeDefined();
  });

  test('a rejection in the parallel lookup produces a single 403 response', async () => {
    userHasRoleMock.mockRejectedValue(new Error('db down'));
    getRolePermissionsMock.mockResolvedValue(HAPPY_PERMISSIONS);

    const request = buildFakeRequest(signToken({ userId: 'u1' }));
    const reply = buildFakeReply();
    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or expired token' });
    expect(reply.sentCount).toBe(1);
  });
});

describe('requireRole', () => {
  test('401 when request.user is undefined', async () => {
    const reply = buildFakeReply();
    await requireRole('manager')({} as never, reply as never);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'Authentication required' });
  });

  test('403 when role is not in the allowed list', async () => {
    const reply = buildFakeReply();
    await requireRole('admin')(
      { user: { ...HAPPY_USER, permissions: [] } } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Insufficient permissions' });
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
      { user: { ...HAPPY_USER, permissions: ['timesheets.tracker.view'] } } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Insufficient permissions' });
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

  test('vacuous: empty perms list passes (Array.every over zero elements)', async () => {
    const reply = buildFakeReply();
    await requirePermission()(
      { user: { ...HAPPY_USER, permissions: [] } } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
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
      { user: { ...HAPPY_USER, permissions: ['c.view'] } } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Insufficient permissions' });
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
  test('embeds userId, sessionStart and activeRole; expires in 30m', () => {
    const sessionStart = 1_700_000_000_000;
    const token = generateToken('u1', sessionStart, 'admin');
    const decoded = decodeForAssertion(token) as jwt.JwtPayload & {
      userId: string;
      sessionStart: number;
      activeRole: string;
    };
    expect(decoded.userId).toBe('u1');
    expect(decoded.sessionStart).toBe(sessionStart);
    expect(decoded.activeRole).toBe('admin');
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(30 * 60);
  });

  test('default sessionStart is approximately Date.now()', () => {
    const before = Date.now();
    const token = generateToken('u1');
    const after = Date.now();
    const decoded = decodeForAssertion(token) as jwt.JwtPayload & { sessionStart: number };
    expect(decoded.sessionStart).toBeGreaterThanOrEqual(before);
    expect(decoded.sessionStart).toBeLessThanOrEqual(after);
  });
});
