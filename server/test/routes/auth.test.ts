import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realBcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realPersonalAccessTokensRepo from '../../repositories/personalAccessTokensRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realExternalAuth from '../../services/external-auth.ts';
import * as realLdapService from '../../services/ldap.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realPermissions from '../../utils/permissions.ts';
import { hashPersonalAccessToken } from '../../utils/personal-access-token.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { decodeForAssertion, signToken } from '../helpers/jwt.ts';

// Snapshot real exports so afterAll can restore them. Snapshot must run BEFORE mock.module
// fires (i.e., before beforeAll executes) - see comment in middleware/auth.test.ts.
const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const personalAccessTokensRepoSnap = { ...realPersonalAccessTokensRepo };
const auditSnap = { ...realAudit };
const bcryptSnap = { ...(realBcrypt as Record<string, unknown>) };
const ldapServiceSnap = { ...(realLdapService as Record<string, unknown>) };
const externalAuthSnap = { ...realExternalAuth };

// Auth-middleware deps: the real authenticateToken runs end-to-end on /me and /switch-role,
// so we mock its three downstream calls.
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const findPersonalAccessTokenByHashMock = mock();
const markPersonalAccessTokenUsedMock = mock();

// Auth route deps
const findLoginUserByUsernameMock = mock();
const findLoginUserByIdMock = mock();
const listAvailableRolesForUserMock = mock();
const logAuditMock = mock(async () => undefined);

// External: bcryptjs.compare and the LDAP service (dynamically imported by /login)
const bcryptCompareMock = mock();
const ldapAuthenticateMock = mock();
const ldapAuthenticateWithProfileMock = mock();
const ldapAuthenticateAndProvisionMock = mock();
const applyExternalRoleIdsForUserIfMatchedMock = mock();

let authRoutePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    findLoginUserByUsername: findLoginUserByUsernameMock,
    findLoginUserById: findLoginUserByIdMock,
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
  mock.module('../../repositories/personalAccessTokensRepo.ts', () => ({
    ...personalAccessTokensRepoSnap,
    findByTokenHash: findPersonalAccessTokenByHashMock,
    markUsed: markPersonalAccessTokenUsedMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('bcryptjs', () => ({
    default: { compare: bcryptCompareMock },
    compare: bcryptCompareMock,
  }));
  mock.module('../../services/external-auth.ts', () => ({
    ...externalAuthSnap,
    applyExternalRoleIdsForUserIfMatched: applyExternalRoleIdsForUserIfMatchedMock,
  }));
  mock.module('../../services/ldap.ts', () => ({
    default: {
      authenticate: ldapAuthenticateMock,
      authenticateWithProfile: ldapAuthenticateWithProfileMock,
      authenticateAndProvision: ldapAuthenticateAndProvisionMock,
    },
  }));

  authRoutePlugin = (await import('../../routes/auth.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/personalAccessTokensRepo.ts', () => personalAccessTokensRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('bcryptjs', () => bcryptSnap);
  mock.module('../../services/external-auth.ts', () => externalAuthSnap);
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
  employeeType: 'app_user' as const,
  authMethod: 'local' as const,
  authProviderId: null,
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
  findPersonalAccessTokenByHashMock,
  markPersonalAccessTokenUsedMock,
  findLoginUserByUsernameMock,
  findLoginUserByIdMock,
  listAvailableRolesForUserMock,
  logAuditMock,
  bcryptCompareMock,
  ldapAuthenticateMock,
  ldapAuthenticateWithProfileMock,
  ldapAuthenticateAndProvisionMock,
  applyExternalRoleIdsForUserIfMatchedMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();

  // Defaults: happy auth path for /me and /switch-role
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(HAPPY_PERMISSIONS);
  findPersonalAccessTokenByHashMock.mockResolvedValue({
    userId: 'u1',
    tokenHash: hashPersonalAccessToken('praetor_pat_valid-token'),
    tokenPrefix: 'praetor_pat_valid',
    createdAt: new Date('2026-05-11T08:00:00.000Z'),
    updatedAt: new Date('2026-05-11T09:00:00.000Z'),
    lastUsedAt: null,
  });
  markPersonalAccessTokenUsedMock.mockResolvedValue(undefined);
  listAvailableRolesForUserMock.mockResolvedValue(HAPPY_ROLES);
  logAuditMock.mockImplementation(async () => undefined);

  // Defaults for /login: LDAP off (returns false), bcrypt fails by default
  ldapAuthenticateMock.mockResolvedValue(false);
  ldapAuthenticateWithProfileMock.mockResolvedValue({
    authenticated: false,
    groups: [],
    roleIds: ['user'],
    matchedRoleIds: [],
  });
  ldapAuthenticateAndProvisionMock.mockResolvedValue({ authenticated: false });
  findLoginUserByIdMock.mockResolvedValue(null);
  applyExternalRoleIdsForUserIfMatchedMock.mockImplementation(
    async (_userId: string, roleIds: string[]) =>
      roleIds.length > 0 ? { applied: true, roleIds } : { applied: false, roleIds: [] },
  );
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
    findLoginUserByUsernameMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'ldap' });
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      groups: ['admins'],
      roleIds: ['admin'],
      matchedRoleIds: ['admin'],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(ldapAuthenticateWithProfileMock).toHaveBeenCalledWith('alice', 'secret');
    expect(applyExternalRoleIdsForUserIfMatchedMock).toHaveBeenCalledWith('u1', ['admin']);
    expect(bcryptCompareMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.user.role).toBe('admin');
  });

  test('200: LDAP login with no matching role mapping preserves admin-assigned role (regression #318)', async () => {
    findLoginUserByUsernameMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'ldap' });
    // LDAP authenticates but the user's groups don't map to any configured role.
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      groups: ['cn=other,dc=corp,dc=local'],
      roleIds: ['user'],
      matchedRoleIds: [],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(applyExternalRoleIdsForUserIfMatchedMock).toHaveBeenCalledWith('u1', []);
    const body = JSON.parse(res.body);
    expect(body.user.role).toBe('manager');
  });

  test('200: LDAP returns false, bcrypt succeeds (fallback)', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(LOGIN_USER);
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: false,
      groups: [],
      roleIds: ['user'],
      matchedRoleIds: [],
    });
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(ldapAuthenticateWithProfileMock).not.toHaveBeenCalled();
    expect(bcryptCompareMock).toHaveBeenCalledTimes(1);
  });

  test('401: LDAP user does not fall back to local password when LDAP fails', async () => {
    findLoginUserByUsernameMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'ldap' });
    ldapAuthenticateWithProfileMock.mockRejectedValue(new Error('LDAP server unreachable'));
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(401);
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  test('401: SSO-only user cannot sign in with local password', async () => {
    findLoginUserByUsernameMock.mockResolvedValue({
      ...LOGIN_USER,
      authMethod: 'oidc',
      authProviderId: 'sso-1',
    });
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(401);
    expect(ldapAuthenticateWithProfileMock).not.toHaveBeenCalled();
    expect(bcryptCompareMock).not.toHaveBeenCalled();
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

  test('401 user not found (LDAP auto-provision also fails)', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(null);
    ldapAuthenticateAndProvisionMock.mockResolvedValue({ authenticated: false });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ghost', password: 'whatever' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid username or password' });
    expect(ldapAuthenticateAndProvisionMock).toHaveBeenCalledWith('ghost', 'whatever');
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  test('200: unknown user auto-provisioned via LDAP on first login', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(null);
    ldapAuthenticateAndProvisionMock.mockResolvedValue({
      authenticated: true,
      userId: 'u-new',
      created: true,
      canonicalUsername: 'alice',
    });
    findLoginUserByIdMock.mockResolvedValue({
      id: 'u-new',
      name: 'Alice Provisioned',
      username: 'alice',
      role: 'user',
      avatarInitials: 'AP',
      passwordHash: '$2a$10$invalidpasswordhashforldapuser00000000000000',
      isDisabled: false,
      employeeType: 'app_user' as const,
      authMethod: 'ldap' as const,
      authProviderId: null,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ALICE@example.com', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.id).toBe('u-new');
    expect(body.user.username).toBe('alice');
    // Auto-provisioned login should NOT bcrypt-compare against the placeholder hash
    expect(bcryptCompareMock).not.toHaveBeenCalled();
    // It should NOT re-run authenticateWithProfile (already authenticated by the helper)
    expect(ldapAuthenticateWithProfileMock).not.toHaveBeenCalled();
    // It should NOT re-apply role mapping (the provision helper already did it)
    expect(applyExternalRoleIdsForUserIfMatchedMock).not.toHaveBeenCalled();
    // Audit emits both user.created and user.login
    const actions = logAuditMock.mock.calls.map(
      (call) => (call as unknown as [{ action: string }])[0].action,
    );
    expect(actions).toEqual(expect.arrayContaining(['user.created', 'user.login']));
  });

  test('200: typed alias resolves to existing canonical LDAP user (no creation)', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(null);
    ldapAuthenticateAndProvisionMock.mockResolvedValue({
      authenticated: true,
      userId: 'u-existing',
      created: false,
      canonicalUsername: 'alice',
    });
    findLoginUserByIdMock.mockResolvedValue({
      ...LOGIN_USER,
      id: 'u-existing',
      authMethod: 'ldap' as const,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice@example.com', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.id).toBe('u-existing');
    expect(body.user.username).toBe('alice');
    // user.created is NOT emitted for existing users
    const actions = logAuditMock.mock.calls.map(
      (call) => (call as unknown as [{ action: string }])[0].action,
    );
    expect(actions).not.toContain('user.created');
    expect(actions).toContain('user.login');
  });

  test('401: auto-provisioned user disabled is rejected', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(null);
    ldapAuthenticateAndProvisionMock.mockResolvedValue({
      authenticated: true,
      userId: 'u-new',
      created: true,
      canonicalUsername: 'alice',
    });
    findLoginUserByIdMock.mockResolvedValue({
      ...LOGIN_USER,
      id: 'u-new',
      authMethod: 'ldap' as const,
      isDisabled: true,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid username or password' });
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

  test('401 non-app user cannot sign in with a local password', async () => {
    findLoginUserByUsernameMock.mockResolvedValue({ ...LOGIN_USER, employeeType: 'internal' });
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid username or password' });
    expect(bcryptCompareMock).not.toHaveBeenCalled();
    expect(ldapAuthenticateWithProfileMock).not.toHaveBeenCalled();
  });

  test('401 wrong password (LDAP off, bcrypt fails)', async () => {
    findLoginUserByUsernameMock.mockResolvedValue(LOGIN_USER);
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: false,
      groups: [],
      roleIds: ['user'],
    });
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

  test('403 rejects personal access tokens because role switching is session-only', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/switch-role',
      headers: { authorization: 'Bearer praetor_pat_valid-token' },
      payload: { roleId: 'admin' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Session authentication required' });
    expect(res.headers['x-auth-token']).toBeUndefined();
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(userHasRoleMock).toHaveBeenCalledTimes(1);
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
