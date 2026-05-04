import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realBcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realLdapService from '../../services/ldap.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { decodeForAssertion, signToken } from '../helpers/jwt.ts';

// Snapshot real exports so afterAll can restore them. Snapshot must run BEFORE mock.module
// fires (i.e., before beforeAll executes) — see comment in middleware/auth.test.ts.
const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const auditSnap = { ...realAudit };
const bcryptSnap = { ...(realBcrypt as Record<string, unknown>) };
const ldapServiceSnap = { ...(realLdapService as Record<string, unknown>) };

// Auth-middleware deps: the real authenticateToken runs end-to-end on /me and /switch-role,
// so we mock its three downstream calls.
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// Auth route deps
const findLoginUserByUsernameMock = mock();
const listAvailableRolesForUserMock = mock();
const logAuditMock = mock(async () => undefined);

// External: bcryptjs.compare and the LDAP service (dynamically imported by /login)
const bcryptCompareMock = mock();
const ldapAuthenticateMock = mock();

let authRoutePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    findLoginUserByUsername: findLoginUserByUsernameMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
    listAvailableRolesForUser: listAvailableRolesForUserMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('bcryptjs', () => ({
    default: { compare: bcryptCompareMock },
    compare: bcryptCompareMock,
  }));
  mock.module('../../services/ldap.ts', () => ({
    default: { authenticate: ldapAuthenticateMock },
  }));

  authRoutePlugin = (await import('../../routes/auth.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('bcryptjs', () => bcryptSnap);
  mock.module('../../services/ldap.ts', () => ldapServiceSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
};

const LOGIN_USER = {
  ...HAPPY_USER,
  passwordHash: '$2a$hashed',
};

const HAPPY_PERMISSIONS = ['timesheets.tracker.view', 'timesheets.tracker.create'];

const HAPPY_ROLES = [
  { id: 'manager', name: 'Manager', isSystem: true, isAdmin: false },
  { id: 'user', name: 'User', isSystem: true, isAdmin: false },
];

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  findLoginUserByUsernameMock,
  listAvailableRolesForUserMock,
  logAuditMock,
  bcryptCompareMock,
  ldapAuthenticateMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();

  // Defaults: happy auth path for /me and /switch-role
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(HAPPY_PERMISSIONS);
  listAvailableRolesForUserMock.mockResolvedValue(HAPPY_ROLES);
  logAuditMock.mockImplementation(async () => undefined);

  // Defaults for /login: LDAP off (returns false), bcrypt fails by default
  ldapAuthenticateMock.mockResolvedValue(false);
  bcryptCompareMock.mockResolvedValue(false);

  testApp = await buildRouteTestApp(authRoutePlugin, '/api/auth');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = (userId = 'u1', activeRole?: string, sessionStart?: number) => ({
  authorization: `Bearer ${signToken({ userId, activeRole, sessionStart })}`,
});

describe('POST /api/auth/login', () => {
  test('200 happy path: local password match', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(LOGIN_USER);
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toEqual({
      id: 'u1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      avatarInitials: 'AL',
      permissions: HAPPY_PERMISSIONS,
      availableRoles: HAPPY_ROLES,
    });

    // Token encodes userId and role
    const decoded = decodeForAssertion(body.token);
    expect(decoded.userId).toBe('u1');
    expect(decoded.activeRole).toBe('manager');

    // bcrypt was called with plaintext + stored hash
    expect(bcryptCompareMock).toHaveBeenCalledWith('secret', LOGIN_USER.passwordHash);

    // Audit emission
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.login',
        entityType: 'user',
        entityId: 'u1',
        userId: 'u1',
      }),
    );
  });

  test('200: LDAP success skips bcrypt', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(LOGIN_USER);
    ldapAuthenticateMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(ldapAuthenticateMock).toHaveBeenCalledWith('alice', 'secret');
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  test('200: LDAP returns false, bcrypt succeeds (fallback)', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(LOGIN_USER);
    ldapAuthenticateMock.mockResolvedValue(false);
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(bcryptCompareMock).toHaveBeenCalledTimes(1);
  });

  test('200: LDAP throws, bcrypt fallback succeeds', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(LOGIN_USER);
    ldapAuthenticateMock.mockRejectedValue(new Error('LDAP server unreachable'));
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(bcryptCompareMock).toHaveBeenCalledTimes(1);
  });

  test('200: empty availableRoles falls back to user.role synthetic role', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(LOGIN_USER);
    bcryptCompareMock.mockResolvedValue(true);
    listAvailableRolesForUserMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.availableRoles).toEqual([
      { id: 'manager', name: 'manager', isSystem: false, isAdmin: false },
    ]);
  });

  test('401 user not found', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ghost', password: 'whatever' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid username or password' });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  test('401 disabled user', async () => {
    findLoginUserByUsernameMock.mockResolvedValue({ ...LOGIN_USER, isDisabled: true });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid username or password' });
  });

  test('401 wrong password (LDAP off, bcrypt fails)', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(LOGIN_USER);
    ldapAuthenticateMock.mockResolvedValue(false);
    bcryptCompareMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'wrong' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid username or password' });
  });

  test('400 whitespace-only username triggers in-handler validator', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: '   ', password: 'secret' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'username is required' });
  });

  test('400 whitespace-only password triggers in-handler validator', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'password is required' });
  });

  test('400 missing username (Fastify schema rejection)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'secret' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  test('200 returns current user with availableRoles', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: authHeader('u1'),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({
      id: 'u1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      avatarInitials: 'AL',
      permissions: HAPPY_PERMISSIONS,
      availableRoles: HAPPY_ROLES,
    });
  });

  test('200 sets x-auth-token sliding-window header', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: authHeader('u1'),
    });

    expect(res.statusCode).toBe(200);
    const newToken = res.headers['x-auth-token'];
    expect(typeof newToken).toBe('string');
    expect(newToken).not.toBe('');
    const decoded = decodeForAssertion(newToken as string);
    expect(decoded.userId).toBe('u1');
  });

  test('401 missing Authorization header', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Access token required' });
  });
});

describe('POST /api/auth/switch-role', () => {
  test('200 switches role, sets x-auth-token, audits user.role_switched', async () => {
    userHasRoleMock.mockResolvedValue(true);
    getRolePermissionsMock.mockResolvedValueOnce(HAPPY_PERMISSIONS); // for authenticateToken
    getRolePermissionsMock.mockResolvedValueOnce(['admin.everything']); // for switch-role handler
    listAvailableRolesForUserMock.mockResolvedValue(HAPPY_ROLES);

    const sessionStart = Date.now() - 1000;
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/switch-role',
      headers: authHeader('u1', undefined, sessionStart),
      payload: { roleId: 'admin' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.role).toBe('admin');
    expect(body.user.permissions).toEqual(['admin.everything']);

    // Header rotation
    const headerToken = res.headers['x-auth-token'];
    expect(typeof headerToken).toBe('string');
    const decoded = decodeForAssertion(headerToken as string);
    expect(decoded.activeRole).toBe('admin');
    // sessionStart preserved
    expect(decoded.sessionStart).toBe(sessionStart);

    // userHasRole called for the target role
    expect(userHasRoleMock).toHaveBeenCalledWith('u1', 'admin');

    // Audit emission with from/to
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.role_switched',
        entityType: 'user',
        entityId: 'u1',
        details: expect.objectContaining({
          fromValue: 'manager',
          toValue: 'admin',
        }),
      }),
    );
  });

  test('403 user lacks the target role', async () => {
    // First userHasRole (in authenticateToken) succeeds; second (in switch-role handler) fails
    userHasRoleMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/switch-role',
      headers: authHeader('u1'),
      payload: { roleId: 'admin' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Insufficient permissions' });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  test('400 whitespace-only roleId', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/switch-role',
      headers: authHeader('u1'),
      payload: { roleId: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'roleId is required' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/switch-role',
      payload: { roleId: 'admin' },
    });
    expect(res.statusCode).toBe(401);
  });
});
