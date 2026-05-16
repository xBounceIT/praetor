import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realBcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realPersonalAccessTokensRepo from '../../repositories/personalAccessTokensRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realExternalAuth from '../../services/external-auth.ts';
import * as realLdapService from '../../services/ldap.ts';
import * as realSsoService from '../../services/sso.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realPermissions from '../../utils/permissions.ts';
import { hashPersonalAccessToken } from '../../utils/personal-access-token.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { decodeForAssertion, signToken } from '../helpers/jwt.ts';

// hashPersonalAccessToken (HMAC-keyed) requires ENCRYPTION_KEY at call time.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-bytes-long!!';

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
const ssoServiceSnap = { ...realSsoService };

// Auth-middleware deps: the real authenticateToken runs end-to-end on /me and /switch-role,
// so we mock its three downstream calls.
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const findPersonalAccessTokenByHashMock = mock();
const markPersonalAccessTokenUsedMock = mock();

// Auth route deps
const findLoginUserByNormalizedUsernameMock = mock();
const findLoginUserByIdMock = mock();
const bumpSessionVersionMock = mock();
const listAvailableRolesForUserMock = mock();
const logAuditMock = mock(async () => undefined);

// External: bcryptjs.compare and the LDAP service (dynamically imported by /login)
const bcryptCompareMock = mock();
const ldapAuthenticateMock = mock();
const ldapAuthenticateWithProfileMock = mock();
const ldapAuthenticateAndProvisionMock = mock();
const applyExternalRoleIdsForUserIfMatchedMock = mock();
const endOidcSessionMock = mock();

let authRoutePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    findLoginUserByNormalizedUsername: findLoginUserByNormalizedUsernameMock,
    findLoginUserById: findLoginUserByIdMock,
    bumpSessionVersion: bumpSessionVersionMock,
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
  mock.module('../../services/sso.ts', () => ({
    ...ssoServiceSnap,
    endOidcSession: endOidcSessionMock,
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
  mock.module('../../services/sso.ts', () => ssoServiceSnap);
  mock.module('../../services/ldap.ts', () => ldapServiceSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
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
  findLoginUserByNormalizedUsernameMock,
  findLoginUserByIdMock,
  bumpSessionVersionMock,
  listAvailableRolesForUserMock,
  logAuditMock,
  bcryptCompareMock,
  ldapAuthenticateMock,
  ldapAuthenticateWithProfileMock,
  ldapAuthenticateAndProvisionMock,
  applyExternalRoleIdsForUserIfMatchedMock,
  endOidcSessionMock,
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
    // Use "now" so the middleware's PAT idle-timeout check (30d default) never expires
    // these fixtures as wall-clock time advances past the test's authorship date.
    createdAt: new Date(),
    updatedAt: new Date(),
    lastUsedAt: null,
  });
  markPersonalAccessTokenUsedMock.mockResolvedValue(undefined);
  bumpSessionVersionMock.mockResolvedValue(undefined);
  listAvailableRolesForUserMock.mockResolvedValue(HAPPY_ROLES);
  logAuditMock.mockImplementation(async () => undefined);

  // Defaults for /login: LDAP off (returns false), bcrypt fails by default
  ldapAuthenticateMock.mockResolvedValue(false);
  ldapAuthenticateWithProfileMock.mockResolvedValue({
    authenticated: false,
    groups: [],
    matchedRoleIds: [],
  });
  ldapAuthenticateAndProvisionMock.mockResolvedValue({ authenticated: false });
  // Default: no OIDC session row for the test user. Tests opting into the RP-Initiated
  // Logout path mock this explicitly.
  endOidcSessionMock.mockResolvedValue(null);
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LOGIN_USER);
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'ldap' });
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      groups: ['admins'],
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'ldap' });
    // LDAP authenticates but the user's groups don't map to any configured role.
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      groups: ['cn=other,dc=corp,dc=local'],
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LOGIN_USER);
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: false,
      groups: [],
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

  test('503: LDAP user login returns ldap_unavailable when LDAP throws (regression #368)', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'ldap' });
    ldapAuthenticateWithProfileMock.mockRejectedValue(new Error('LDAP server unreachable'));
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Authentication service temporarily unavailable',
      errorCode: 'ldap_unavailable',
    });
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  test('503: unknown-user LDAP auto-provision returns ldap_unavailable when LDAP throws (regression #368)', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    ldapAuthenticateAndProvisionMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ghost', password: 'whatever' },
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Authentication service temporarily unavailable',
      errorCode: 'ldap_unavailable',
    });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  test('401: SSO-only user cannot sign in with local password', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LOGIN_USER);
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, isDisabled: true });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid username or password' });
  });

  test('401 non-app user cannot sign in with a local password', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LOGIN_USER,
      employeeType: 'internal',
    });
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LOGIN_USER);
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: false,
      groups: [],
      matchedRoleIds: [],
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

  // Regression #640: typed 'JDoe' must resolve to a canonical 'jdoe' row.
  test('200: typed mixed-case username resolves to canonical LDAP-bound row (#640)', async () => {
    findLoginUserByNormalizedUsernameMock.mockImplementation(async (username: string) =>
      username.trim().toLowerCase() === 'jdoe'
        ? { ...LOGIN_USER, username: 'jdoe', authMethod: 'ldap' as const }
        : null,
    );
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      groups: [],
      matchedRoleIds: [],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'JDoe', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(findLoginUserByNormalizedUsernameMock).toHaveBeenCalledWith('JDoe');
    const body = JSON.parse(res.body);
    expect(body.user.username).toBe('jdoe');
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

    // userHasRole called for the target role with a final enabled/session check
    expect(userHasRoleMock).toHaveBeenCalledWith('u1', 'admin', {
      requireEnabledUser: true,
      expectedSessionVersion: 1,
    });

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

  test('403 user lacks the target role (and audits the denial)', async () => {
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
    // The denial is audited so investigators can see failed role-switch attempts.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.role_switch.denied',
        entityType: 'role',
        entityId: 'admin',
      }),
    );
    // Authentication loaded the current role once; the denied target role must not load
    // permissions before authorization succeeds.
    expect(getRolePermissionsMock).toHaveBeenCalledTimes(1);
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

describe('POST /api/auth/logout', () => {
  test('401 when no token is provided', async () => {
    const res = await testApp.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(401);
    expect(bumpSessionVersionMock).not.toHaveBeenCalled();
  });

  test('200 happy path: bumps session_version, audits user.logout, returns null endSessionUrl', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: authHeader('u1'),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ endSessionUrl: null });
    expect(bumpSessionVersionMock).toHaveBeenCalledTimes(1);
    expect(bumpSessionVersionMock).toHaveBeenCalledWith('u1');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.logout',
        entityType: 'user',
        entityId: 'u1',
      }),
    );
    // Regression: the sliding-window refresh in authenticateToken issues a fresh token
    // BEFORE the handler bumps session_version. Returning that token to the client would
    // re-populate localStorage with an already-revoked token. The handler must strip it.
    expect(res.headers['x-auth-token']).toBeUndefined();
  });

  // Issue #610: OIDC RP-Initiated Logout. When the user authenticated via an OIDC provider
  // that has end_session_enabled, the response carries the IdP's end-session URL — the
  // frontend redirects the browser there so the IdP session cookie is also killed.
  test('200 with endSessionUrl when ssoService.endOidcSession returns one', async () => {
    endOidcSessionMock.mockResolvedValue(
      'https://idp.example.com/logout?id_token_hint=tok&post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2F',
    );
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: authHeader('u1'),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      endSessionUrl:
        'https://idp.example.com/logout?id_token_hint=tok&post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2F',
    });
    expect(endOidcSessionMock).toHaveBeenCalledWith('u1');
    // The local logout MUST still happen — a working IdP redirect is not a substitute for
    // bumping session_version.
    expect(bumpSessionVersionMock).toHaveBeenCalledWith('u1');
  });

  // A broken IdP (network failure, malformed discovery doc) must never block the local
  // logout. The handler logs and swallows the rejection.
  test('200 with null endSessionUrl when endOidcSession throws', async () => {
    endOidcSessionMock.mockRejectedValue(new Error('discovery failed'));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: authHeader('u1'),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ endSessionUrl: null });
    expect(bumpSessionVersionMock).toHaveBeenCalledWith('u1');
  });

  test('subsequent request with the old token (stale sessionVersion) is rejected', async () => {
    // First call bumps to v2 (mocked default). Simulate the DB now reflecting v2.
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, sessionVersion: 2 });
    // The old token was signed with sessionVersion: 1.
    const oldToken = signToken({ userId: 'u1', sessionVersion: 1 });
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${oldToken}` },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Session revoked',
      errorCode: 'session_revoked',
    });
  });

  test('403 when called with a personal access token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: 'Bearer praetor_pat_valid-token' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Session authentication required' });
    expect(bumpSessionVersionMock).not.toHaveBeenCalled();
  });
});
