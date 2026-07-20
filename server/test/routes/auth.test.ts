import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { authenticator } from '@otplib/preset-v11';
import * as realBcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import { signPurposeToken, verifyPurposeToken } from '../../middleware/auth.ts';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realPersonalAccessTokensRepo from '../../repositories/personalAccessTokensRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSettingsRepo from '../../repositories/settingsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realExternalAuth from '../../services/external-auth.ts';
import * as realFirstLogin from '../../services/firstLogin.ts';
import * as realLdapService from '../../services/ldap.ts';
import * as realSsoService from '../../services/sso.ts';
import * as realAudit from '../../utils/audit.ts';
import { encrypt } from '../../utils/crypto.ts';
import * as realPermissions from '../../utils/permissions.ts';
import { hashPersonalAccessToken } from '../../utils/personal-access-token.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { decodeForAssertion, signToken } from '../helpers/jwt.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

// hashPersonalAccessToken (HMAC-keyed) requires ENCRYPTION_KEY at call time.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-bytes-long!!';

// Snapshot real exports so afterAll can restore them. Snapshot must run BEFORE mock.module
// fires (i.e., before beforeAll executes) - see comment in middleware/auth.test.ts.
const usersRepoSnap = { ...realUsersRepo };
const drizzleSnap = { ...realDrizzle };
const generalSettingsRepoSnap = { ...realGeneralSettingsRepo };
const rolesRepoSnap = { ...realRolesRepo };
const settingsRepoSnap = { ...realSettingsRepo };
const permissionsSnap = { ...realPermissions };
const personalAccessTokensRepoSnap = { ...realPersonalAccessTokensRepo };
const auditSnap = { ...realAudit };
const bcryptSnap = { ...(realBcrypt as Record<string, unknown>) };
const ldapServiceSnap = { ...(realLdapService as Record<string, unknown>) };
const externalAuthSnap = { ...realExternalAuth };
const firstLoginSnap = { ...realFirstLogin };
const ssoServiceSnap = { ...realSsoService };

// Auth-middleware deps: the real authenticateToken runs end-to-end on /me and /switch-role,
// so we mock its three downstream calls.
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const rolesFindByIdMock = mock();
const getRolePermissionsMock = mock();
const findPersonalAccessTokenByHashMock = mock();
const markPersonalAccessTokenUsedMock = mock();

// Auth route deps
const findLoginUserByNormalizedUsernameMock = mock();
const findLoginUserByIdMock = mock();
const getTotpStateMock = mock();
const markBackupCodeUsedMock = mock();
// Resolves null by default (no settings row). The TOTP-enforcement /login tests point it at an
// enforcing policy; the union return type keeps both the null default and that override valid.
// The real totpEnforcement service reads this repo, so the five policy fields drive enforcement:
// enableTotp (global kill-switch), enforceTotp (master), totpEnforcedRoleIds (empty = everyone),
// totpExemptRoleIds/totpExemptUserIds (exempt wins).
type TotpPolicySettings = {
  enableTotp: boolean;
  enforceTotp: boolean;
  totpEnforcedRoleIds: string[];
  totpExemptRoleIds: string[];
  totpExemptUserIds: string[];
};
const generalSettingsGetMock = mock<() => Promise<TotpPolicySettings | null>>(async () => null);
const updateDirectoryProfileMock = mock();
const bumpSessionVersionMock = mock();
const listAvailableRolesForUserMock = mock();
const logAuditMock = mock(async () => undefined);
const settingsUpsertForUserMock = mock();
const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

// External: bcryptjs.compare and the LDAP service (dynamically imported by /login)
const bcryptCompareMock = mock();
const ldapAuthenticateMock = mock();
const ldapAuthenticateWithProfileMock = mock();
const ldapAuthenticateAndProvisionMock = mock();
const externalGroupsYieldNoKnownRoleMock = mock();
const endOidcSessionMock = mock();
const recordFirstInteractiveLoginMock = mock(async () => false);

let authRoutePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    findLoginUserByNormalizedUsername: findLoginUserByNormalizedUsernameMock,
    findLoginUserById: findLoginUserByIdMock,
    getTotpState: getTotpStateMock,
    markBackupCodeUsed: markBackupCodeUsedMock,
    updateDirectoryProfile: updateDirectoryProfileMock,
    bumpSessionVersion: bumpSessionVersionMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));
  mock.module('../../repositories/generalSettingsRepo.ts', () => ({
    ...generalSettingsRepoSnap,
    get: generalSettingsGetMock,
  }));
  mock.module('../../repositories/settingsRepo.ts', () => ({
    ...settingsRepoSnap,
    upsertForUser: settingsUpsertForUserMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
    findById: rolesFindByIdMock,
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
    externalGroupsYieldNoKnownRole: externalGroupsYieldNoKnownRoleMock,
  }));
  mock.module('../../services/firstLogin.ts', () => ({
    ...firstLoginSnap,
    recordFirstInteractiveLogin: recordFirstInteractiveLoginMock,
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
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
  mock.module('../../repositories/generalSettingsRepo.ts', () => generalSettingsRepoSnap);
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/settingsRepo.ts', () => settingsRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/personalAccessTokensRepo.ts', () => personalAccessTokensRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('bcryptjs', () => bcryptSnap);
  mock.module('../../services/external-auth.ts', () => externalAuthSnap);
  mock.module('../../services/firstLogin.ts', () => firstLoginSnap);
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
  rolesFindByIdMock,
  getRolePermissionsMock,
  findPersonalAccessTokenByHashMock,
  markPersonalAccessTokenUsedMock,
  findLoginUserByNormalizedUsernameMock,
  findLoginUserByIdMock,
  getTotpStateMock,
  markBackupCodeUsedMock,
  updateDirectoryProfileMock,
  bumpSessionVersionMock,
  listAvailableRolesForUserMock,
  logAuditMock,
  settingsUpsertForUserMock,
  withDbTransactionMock,
  bcryptCompareMock,
  ldapAuthenticateMock,
  ldapAuthenticateWithProfileMock,
  ldapAuthenticateAndProvisionMock,
  externalGroupsYieldNoKnownRoleMock,
  endOidcSessionMock,
  recordFirstInteractiveLoginMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  resetWithDbTransactionMock();

  // Defaults: happy auth path for /me and /switch-role
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  // Default: custom roles resolve to a non-admin role record (admin/top_manager short-circuit
  // before findById is consulted). The enforcement tests rely on this baseline.
  rolesFindByIdMock.mockResolvedValue(null);
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
    roleMappings: [],
  });
  ldapAuthenticateAndProvisionMock.mockResolvedValue({ authenticated: false });
  // Default: no OIDC session row for the test user. Tests opting into the RP-Initiated
  // Logout path mock this explicitly.
  endOidcSessionMock.mockResolvedValue(null);
  findLoginUserByIdMock.mockResolvedValue(null);
  // Default: groups yield a known role (no warn fires). Tests that exercise the
  // "no group matched" or "matched role was deleted" diagnostic override with
  // mockResolvedValue(true).
  externalGroupsYieldNoKnownRoleMock.mockResolvedValue(false);
  bcryptCompareMock.mockResolvedValue(false);

  testApp = await buildRouteTestApp(authRoutePlugin, '/api/auth');
});

afterEach(async () => {
  await testApp.close();
  // The TOTP enforcement tests point generalSettingsGetMock at an enforcing config; reset it to
  // the file-wide default (no settings row) so the pre-existing /login cases keep their behavior.
  generalSettingsGetMock.mockResolvedValue(null);
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
      authMethod: 'local',
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
    expect(recordFirstInteractiveLoginMock).toHaveBeenCalledWith('u1', {
      createRilPreferencesTip: false,
    });
  });

  test('200: RIL access enables the first-login preferences tip', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LOGIN_USER);
    bcryptCompareMock.mockResolvedValue(true);
    getRolePermissionsMock.mockResolvedValue([...HAPPY_PERMISSIONS, 'timesheets.ril.view']);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(recordFirstInteractiveLoginMock).toHaveBeenCalledWith('u1', {
      createRilPreferencesTip: true,
    });
  });

  test('200: local password comparison keeps existing trim normalization', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LOGIN_USER);
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: ' secret ' },
    });

    expect(res.statusCode).toBe(200);
    expect(bcryptCompareMock).toHaveBeenCalledWith('secret', LOGIN_USER.passwordHash);
  });

  test('200: LDAP success skips bcrypt and preserves app-assigned role even when LDAP group still maps', async () => {
    // Bug fix: role mapping is bootstrap-only. The stored `manager` role must survive even
    // though the user's LDAP groups still resolve to `[admin]`.
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'ldap' });
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      canonicalUsername: 'alice',
      groups: ['admins'],
      matchedRoleIds: ['admin'],
      roleMappings: [{ externalGroup: 'admins', role: 'admin' }],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(ldapAuthenticateWithProfileMock).toHaveBeenCalledWith('alice', 'secret');
    expect(bcryptCompareMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.user.role).toBe('manager');
  });

  test('401: LDAP canonical identity must match the preselected Praetor user', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LOGIN_USER,
      username: 'victim',
      authMethod: 'ldap',
    });
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      canonicalUsername: 'attacker',
      groups: [],
      matchedRoleIds: [],
      roleMappings: [],
      displayName: 'Attacker Profile',
      email: 'attacker@example.com',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'victim', password: 'attacker-password' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid username or password' });
    expect(updateDirectoryProfileMock).not.toHaveBeenCalled();
    expect(settingsUpsertForUserMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  test('200: LDAP success refreshes provider-managed name and email', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LOGIN_USER,
      authMethod: 'ldap',
      name: 'Old Name',
      avatarInitials: 'ON',
    });
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      canonicalUsername: 'alice',
      groups: [],
      matchedRoleIds: [],
      roleMappings: [],
      displayName: 'Alice Provider',
      email: 'alice.provider@example.com',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateDirectoryProfileMock).toHaveBeenCalledWith(
      'u1',
      { name: 'Alice Provider', avatarInitials: 'AP' },
      expect.anything(),
    );
    expect(settingsUpsertForUserMock).toHaveBeenCalledWith(
      'u1',
      { fullName: 'Alice Provider', email: 'alice.provider@example.com', language: null },
      expect.anything(),
    );
    const body = JSON.parse(res.body);
    expect(body.user.name).toBe('Alice Provider');
    expect(body.user.avatarInitials).toBe('AP');
  });

  test('200: LDAP login sends the untrimmed password to the directory bind (#697)', async () => {
    const rawPassword = '   spaces   ';
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'ldap' });
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      canonicalUsername: 'alice',
      groups: [],
      matchedRoleIds: [],
      roleMappings: [],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: ' alice ', password: rawPassword },
    });

    expect(res.statusCode).toBe(200);
    expect(findLoginUserByNormalizedUsernameMock).toHaveBeenCalledWith('alice');
    expect(ldapAuthenticateWithProfileMock).toHaveBeenCalledWith('alice', rawPassword);
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  test('200: LDAP login with no matching role mapping preserves admin-assigned role (regression #318)', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'ldap' });
    // LDAP authenticates but the user's groups don't map to any configured role.
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      canonicalUsername: 'alice',
      groups: ['cn=other,dc=corp,dc=local'],
      matchedRoleIds: [],
      roleMappings: [{ externalGroup: 'admins', role: 'admin' }],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.role).toBe('manager');
  });

  // Iteration 3 added a diagnostic warning for the stale-config case: groups DO match a
  // configured mapping, but the target role has since been deleted from Praetor. The
  // login still succeeds and the stored role is preserved (bootstrap-only); the diagnostic
  // helps admins notice their mapping no longer points at an existing role.
  test('200: LDAP login with mapping pointing at a deleted role still preserves admin-assigned role', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'ldap' });
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      canonicalUsername: 'alice',
      groups: ['cn=admins,dc=corp,dc=local'],
      matchedRoleIds: ['ghost-admin'],
      roleMappings: [{ externalGroup: 'admins', role: 'ghost-admin' }],
    });
    // Helper reports that the user's groups yield no known role (the mapping points
    // at the deleted role 'ghost-admin') — simulating the diagnostic short-circuit.
    externalGroupsYieldNoKnownRoleMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(externalGroupsYieldNoKnownRoleMock).toHaveBeenCalledWith(
      ['cn=admins,dc=corp,dc=local'],
      [{ externalGroup: 'admins', role: 'ghost-admin' }],
    );
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

  test('401 user not found (LDAP auto-provision also fails with untrimmed password)', async () => {
    const rawPassword = '   spaces   ';
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    ldapAuthenticateAndProvisionMock.mockResolvedValue({ authenticated: false });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ghost', password: rawPassword },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid username or password' });
    expect(ldapAuthenticateAndProvisionMock).toHaveBeenCalledWith('ghost', rawPassword);
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
      canonicalUsername: 'jdoe',
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

  // ── 2FA gate (login path a/b) ──────────────────────────────────────────────────────────────
  // Once the password is confirmed and the account is enabled, /login branches before issuing a
  // session: (a) a TOTP-enabled local/ldap user gets a challenge instead of a token (skipped when
  // the feature is globally off — the kill-switch bypass); (b) an enforced user for whom enrollment
  // is mandated but not yet done is redirected into enrollment. In both detours `user.login` MUST
  // NOT fire — only the dedicated detour audit does. Enforcement is driven by the org policy
  // (enableTotp/enforceTotp/totpEnforcedRoleIds/totpExemptRoleIds) read via generalSettingsGetMock.

  test('200: local TOTP-enabled user receives a challenge token, not a session', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, totpEnabled: true });
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // The challenge response carries ONLY the 2FA fields — Fastify strips token/user.
    expect(body).toEqual({ totpRequired: true, challengeToken: expect.any(String) });
    expect(body.token).toBeUndefined();
    expect(body.user).toBeUndefined();

    // The challenge token is a single-purpose 'totp_challenge' token for this user — it must NOT
    // be usable as a session (authenticateToken rejects any 'purpose' claim).
    expect(verifyPurposeToken(body.challengeToken, 'totp_challenge')).toEqual({
      userId: 'u1',
      sessionVersion: 1,
    });

    // Audit: the challenge was issued; a real session was NOT granted.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.totp_challenge_issued',
        entityType: 'user',
        entityId: 'u1',
        userId: 'u1',
      }),
    );
    expect(recordFirstInteractiveLoginMock).not.toHaveBeenCalled();
    const actions = logAuditMock.mock.calls.map(
      (call) => (call as unknown as [{ action: string }])[0].action,
    );
    expect(actions).not.toContain('user.login');
  });

  test('200: LDAP TOTP-enabled user receives a challenge token after a successful bind', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LOGIN_USER,
      authMethod: 'ldap',
      totpEnabled: true,
    });
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      canonicalUsername: 'alice',
      groups: [],
      matchedRoleIds: [],
      roleMappings: [],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ totpRequired: true, challengeToken: expect.any(String) });
    expect(verifyPurposeToken(body.challengeToken, 'totp_challenge')).toEqual({
      userId: 'u1',
      sessionVersion: 1,
    });
    // LDAP bind ran; bcrypt did not.
    expect(ldapAuthenticateWithProfileMock).toHaveBeenCalledWith('alice', 'secret');
    expect(bcryptCompareMock).not.toHaveBeenCalled();
    const actions = logAuditMock.mock.calls.map(
      (call) => (call as unknown as [{ action: string }])[0].action,
    );
    expect(actions).toEqual(['user.totp_challenge_issued']);
  });

  test('200: kill-switch — feature globally off lets an enrolled user log in without a challenge', async () => {
    // enableTotp is the org-wide kill-switch: when 2FA is turned off, even a user who has TOTP
    // confirmed (totpEnabled) bypasses the challenge entirely and receives a normal session/token.
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, totpEnabled: true });
    bcryptCompareMock.mockResolvedValue(true);
    generalSettingsGetMock.mockResolvedValue({
      enableTotp: false,
      enforceTotp: false,
      totpEnforcedRoleIds: [],
      totpExemptRoleIds: [],
      totpExemptUserIds: [],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // A full session, not a challenge: token + user present, no 2FA detour fields.
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toEqual(
      expect.objectContaining({ id: 'u1', role: 'manager', permissions: HAPPY_PERMISSIONS }),
    );
    expect(body.totpRequired).toBeUndefined();
    expect(body.challengeToken).toBeUndefined();
    expect(body.totpEnrollmentRequired).toBeUndefined();

    // The bypass logs a normal login — never the challenge detour audit.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.login', entityId: 'u1' }),
    );
    const actions = logAuditMock.mock.calls.map(
      (call) => (call as unknown as [{ action: string }])[0].action,
    );
    expect(actions).not.toContain('user.totp_challenge_issued');
  });

  test('200: enforcement on + admin without TOTP is redirected into mandatory enrollment', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LOGIN_USER,
      role: 'admin',
      totpEnabled: false,
    });
    bcryptCompareMock.mockResolvedValue(true);
    // enforcedRoleIds = ['admin'] → only admins are forced; the primary role 'admin' matches.
    generalSettingsGetMock.mockResolvedValue({
      enableTotp: true,
      enforceTotp: true,
      totpEnforcedRoleIds: ['admin'],
      totpExemptRoleIds: [],
      totpExemptUserIds: [],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ totpEnrollmentRequired: true, enrollToken: expect.any(String) });
    expect(body.token).toBeUndefined();
    expect(body.user).toBeUndefined();

    // The enroll token is a single-purpose 'totp_enroll' token for this admin.
    expect(verifyPurposeToken(body.enrollToken, 'totp_enroll')).toEqual({
      userId: 'u1',
      sessionVersion: 1,
    });

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.totp_enrollment_required',
        entityType: 'user',
        entityId: 'u1',
        userId: 'u1',
      }),
    );
    const actions = logAuditMock.mock.calls.map(
      (call) => (call as unknown as [{ action: string }])[0].action,
    );
    expect(actions).not.toContain('user.login');
  });

  test('200: enforcement on + non-enforced primary role but an assignable enforced role → mandatory enrollment', async () => {
    // Multi-role bypass guard (P1): the primary role is not enforced, so the old primary-role-only
    // check would have issued a full session with no 2FA — and the user could then switch into the
    // enforced (admin) role they hold. Enforcement must consider every assignable role.
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LOGIN_USER,
      role: 'manager',
      totpEnabled: false,
    });
    bcryptCompareMock.mockResolvedValue(true);
    generalSettingsGetMock.mockResolvedValue({
      enableTotp: true,
      enforceTotp: true,
      totpEnforcedRoleIds: ['admin'],
      totpExemptRoleIds: [],
      totpExemptUserIds: [],
    });
    listAvailableRolesForUserMock.mockResolvedValue([
      { id: 'manager', name: 'Manager', isSystem: true, isAdmin: false },
      { id: 'admin', name: 'Admin', isSystem: true, isAdmin: true },
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ totpEnrollmentRequired: true, enrollToken: expect.any(String) });
    expect(body.token).toBeUndefined();
    expect(verifyPurposeToken(body.enrollToken, 'totp_enroll')).toEqual({
      userId: 'u1',
      sessionVersion: 1,
    });
    const actions = logAuditMock.mock.calls.map(
      (call) => (call as unknown as [{ action: string }])[0].action,
    );
    expect(actions).not.toContain('user.login');
    expect(actions).toContain('user.totp_enrollment_required');
  });

  test('200: enforcement on + an assignable enforced role (matched by id, not is_admin flag) → mandatory enrollment', async () => {
    // Enforcement keys off role ids in totpEnforcedRoleIds, independent of the role's is_admin flag.
    // top_manager carries is_admin=false yet, when listed as an enforced role, an assignable
    // top_manager must trigger enrollment just like any other enforced role.
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LOGIN_USER,
      role: 'manager',
      totpEnabled: false,
    });
    bcryptCompareMock.mockResolvedValue(true);
    generalSettingsGetMock.mockResolvedValue({
      enableTotp: true,
      enforceTotp: true,
      totpEnforcedRoleIds: ['top_manager'],
      totpExemptRoleIds: [],
      totpExemptUserIds: [],
    });
    listAvailableRolesForUserMock.mockResolvedValue([
      { id: 'manager', name: 'Manager', isSystem: true, isAdmin: false },
      { id: 'top_manager', name: 'Top Manager', isSystem: true, isAdmin: false },
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      totpEnrollmentRequired: true,
      enrollToken: expect.any(String),
    });
  });

  test('200: enforcement off (no settings row) + admin without TOTP gets a normal session (regression)', async () => {
    // generalSettingsGetMock resolves null by default (file-wide); getTotpPolicy then defaults
    // enforceTotp to false, so the admin logs in normally — the enrollment detour must NOT trigger.
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LOGIN_USER,
      role: 'admin',
      totpEnabled: false,
    });
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toEqual(
      expect.objectContaining({ id: 'u1', role: 'admin', permissions: HAPPY_PERMISSIONS }),
    );
    expect(body.totpEnrollmentRequired).toBeUndefined();
    expect(body.totpRequired).toBeUndefined();

    // Normal login → user.login, no detour audit.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.login', entityId: 'u1' }),
    );
  });

  test('200: enforcement on but a role outside the enforced list logs in normally', async () => {
    // The mandate is scoped to enforcedRoleIds = ['admin'] — a manager (whose assignable roles are
    // manager/user, none enforced) still gets a session, never an enrollment redirect.
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ ...LOGIN_USER, totpEnabled: false });
    bcryptCompareMock.mockResolvedValue(true);
    generalSettingsGetMock.mockResolvedValue({
      enableTotp: true,
      enforceTotp: true,
      totpEnforcedRoleIds: ['admin'],
      totpExemptRoleIds: [],
      totpExemptUserIds: [],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toEqual(expect.any(String));
    expect(body.totpEnrollmentRequired).toBeUndefined();
    const actions = logAuditMock.mock.calls.map(
      (call) => (call as unknown as [{ action: string }])[0].action,
    );
    expect(actions).toEqual(['user.login']);
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

  test('200 includes authMethod so the client can tailor 2FA management for LDAP users', async () => {
    // Without authMethod the client defaults LDAP users to "local" and demands a (nonexistent)
    // password in the Disable-2FA dialog. /me must carry the auth method.
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, authMethod: 'ldap' });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: authHeader('u1'),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).authMethod).toBe('ldap');
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
    expect(recordFirstInteractiveLoginMock).not.toHaveBeenCalled();
  });

  test('403: switching into an enforced role without TOTP is blocked when enforcement is on', async () => {
    // A session that predates enforcement (or a later enforced-role grant) must not elevate into an
    // enforced role without a second factor — switch-role rejects it with totp_enrollment_required.
    // enforcedRoleIds = ['admin'] scopes the mandate; the role being switched INTO (admin) is
    // folded into the user's role set by totpRoleSwitchBlocked, so it matches.
    userHasRoleMock.mockResolvedValue(true);
    generalSettingsGetMock.mockResolvedValue({
      enableTotp: true,
      enforceTotp: true,
      totpEnforcedRoleIds: ['admin'],
      totpExemptRoleIds: [],
      totpExemptUserIds: [],
    });
    findLoginUserByIdMock.mockResolvedValue({
      ...LOGIN_USER,
      authMethod: 'local',
      totpEnabled: false,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/switch-role',
      headers: authHeader('u1', undefined, Date.now() - 1000),
      payload: { roleId: 'admin' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorCode).toBe('totp_enrollment_required');
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

describe('POST /api/auth/totp-challenge', () => {
  // A real base32 TOTP secret; codes are produced with the same otplib preset the server uses, so
  // verifyTotpCode (which is NOT mocked — only bcryptjs is) accepts them. The stored secret is the
  // AES-256-GCM ciphertext, exactly as the route reads it before decrypt().
  const TOTP_SECRET = authenticator.generateSecret();

  // findLoginUserById must re-confirm an enabled, 2FA-on, app_user account when redeeming the
  // challenge — mirror LOGIN_USER but with totp on.
  const TOTP_LOGIN_USER = { ...LOGIN_USER, totpEnabled: true };

  // The bcrypt hash here is opaque: bcryptjs is mocked in this suite, so a backup-code match is
  // driven by bcryptCompareMock rather than a real hash comparison.
  const backupState = (overrides: Partial<Record<string, unknown>> = {}) => ({
    totpSecret: encrypt(TOTP_SECRET),
    totpEnabled: true,
    totpConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
    totpBackupCodes: [{ hash: '$2a$backup-code-hash', usedAt: null }],
    ...overrides,
  });

  const challengeTokenFor = (
    userId = 'u1',
    expiresIn: Parameters<typeof signPurposeToken>[1] = '5m',
    sessionVersion = 1,
  ) => signPurposeToken({ userId, purpose: 'totp_challenge', sessionVersion }, expiresIn);

  test('200 happy path: a valid TOTP code exchanges the challenge for a session', async () => {
    findLoginUserByIdMock.mockResolvedValue(TOTP_LOGIN_USER);
    getTotpStateMock.mockResolvedValue(backupState());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: {
        challengeToken: challengeTokenFor('u1'),
        code: authenticator.generate(TOTP_SECRET),
      },
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
      authMethod: 'local',
      permissions: HAPPY_PERMISSIONS,
      availableRoles: HAPPY_ROLES,
    });
    // The issued session token is a real session JWT (no purpose claim), anchored at "now".
    const decoded = decodeForAssertion(body.token);
    expect(decoded.userId).toBe('u1');
    expect(decoded.activeRole).toBe('manager');

    // getTotpState was read inside the transaction (TX_SENTINEL passed through).
    expect(getTotpStateMock).toHaveBeenCalledTimes(1);
    // A TOTP match never burns a backup code.
    expect(markBackupCodeUsedMock).not.toHaveBeenCalled();

    // Only a successful challenge logs user.login.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.login',
        entityType: 'user',
        entityId: 'u1',
        userId: 'u1',
      }),
    );
    expect(recordFirstInteractiveLoginMock).toHaveBeenCalledWith('u1', {
      createRilPreferencesTip: false,
    });
  });

  test('400 when the account was switched to an IdP-managed method after the challenge issued', async () => {
    // The 5-minute challenge token was issued while local/LDAP; if an admin switches the account to
    // OIDC/SAML in that window, the stale challenge must not mint a local session.
    findLoginUserByIdMock.mockResolvedValue({ ...TOTP_LOGIN_USER, authMethod: 'oidc' });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: {
        challengeToken: challengeTokenFor('u1'),
        code: authenticator.generate(TOTP_SECRET),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).errorCode).toBe('invalid_totp_code');
  });

  test('400 when the challenge token predates a credential/session rotation (sessionVersion mismatch)', async () => {
    // The token carries the pre-rotation sessionVersion; the reloaded user now has a bumped one
    // (password change / admin reset / disable), so the stale challenge cannot mint a session.
    findLoginUserByIdMock.mockResolvedValue({ ...TOTP_LOGIN_USER, sessionVersion: 2 });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: {
        challengeToken: challengeTokenFor('u1', '5m', 1),
        code: authenticator.generate(TOTP_SECRET),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).errorCode).toBe('invalid_totp_code');
  });

  test('400 when 2FA was turned off org-wide after the challenge was issued (kill-switch)', async () => {
    // The challenge token was issued while the feature was on; if an admin disables 2FA globally in
    // the window, the stale challenge must not mint a session even with a correct code. The user
    // re-logs in and, with the feature off, /login issues a password-only session instead.
    findLoginUserByIdMock.mockResolvedValue(TOTP_LOGIN_USER);
    getTotpStateMock.mockResolvedValue(backupState());
    generalSettingsGetMock.mockResolvedValue({
      enableTotp: false,
      enforceTotp: false,
      totpEnforcedRoleIds: [],
      totpExemptRoleIds: [],
      totpExemptUserIds: [],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: {
        challengeToken: challengeTokenFor('u1'),
        code: authenticator.generate(TOTP_SECRET),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).errorCode).toBe('invalid_totp_code');
  });

  test('200: a valid unused backup code succeeds and is burned via markBackupCodeUsed', async () => {
    findLoginUserByIdMock.mockResolvedValue(TOTP_LOGIN_USER);
    getTotpStateMock.mockResolvedValue(backupState());
    // verifyTotpCode rejects the backup-shaped code; verifyBackupCode (→ mocked bcrypt.compare)
    // then accepts the stored unused code.
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: { challengeToken: challengeTokenFor('u1'), code: 'abcde-fghij' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toEqual(expect.any(String));
    expect(body.user.id).toBe('u1');

    // The matched code is marked used inside the same transaction, with its usedAt stamped.
    expect(markBackupCodeUsedMock).toHaveBeenCalledTimes(1);
    const [userIdArg, updatedCodes] = markBackupCodeUsedMock.mock.calls[0] as unknown as [
      string,
      Array<{ hash: string; usedAt: string | null }>,
    ];
    expect(userIdArg).toBe('u1');
    expect(updatedCodes).toHaveLength(1);
    expect(updatedCodes[0].hash).toBe('$2a$backup-code-hash');
    expect(typeof updatedCodes[0].usedAt).toBe('string');

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.login', entityId: 'u1' }),
    );
  });

  test('400 invalid_totp_code: a wrong code is rejected generically', async () => {
    findLoginUserByIdMock.mockResolvedValue(TOTP_LOGIN_USER);
    getTotpStateMock.mockResolvedValue(backupState());
    // bcryptCompareMock defaults to false (no backup match), and 000000 is not the live TOTP.

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: { challengeToken: challengeTokenFor('u1'), code: '000000' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid code', errorCode: 'invalid_totp_code' });
    expect(markBackupCodeUsedMock).not.toHaveBeenCalled();
    // A failed challenge does NOT log user.login.
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  test('400 invalid_totp_code: an already-used backup code is not redeemable', async () => {
    findLoginUserByIdMock.mockResolvedValue(TOTP_LOGIN_USER);
    // The only stored backup code was already redeemed — the route skips used entries, so even a
    // bcrypt "match" can never fire (and the loop short-circuits before verifyBackupCode).
    getTotpStateMock.mockResolvedValue(
      backupState({
        totpBackupCodes: [{ hash: '$2a$backup-code-hash', usedAt: '2026-01-02T00:00:00.000Z' }],
      }),
    );
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: { challengeToken: challengeTokenFor('u1'), code: 'abcde-fghij' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid code', errorCode: 'invalid_totp_code' });
    expect(markBackupCodeUsedMock).not.toHaveBeenCalled();
  });

  test('400 invalid_totp_code: 2FA was disabled (in the user row) since the token was issued', async () => {
    // The login row no longer has TOTP on — the re-assert collapses to the generic 400 without
    // reading any TOTP state.
    findLoginUserByIdMock.mockResolvedValue({ ...TOTP_LOGIN_USER, totpEnabled: false });
    getTotpStateMock.mockResolvedValue(backupState());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: {
        challengeToken: challengeTokenFor('u1'),
        code: authenticator.generate(TOTP_SECRET),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid code', errorCode: 'invalid_totp_code' });
    expect(getTotpStateMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  test('400 invalid_totp_code: getTotpState reports 2FA off inside the transaction', async () => {
    // The user row still says totpEnabled, but the transactional read finds it off (or no secret) —
    // same generic 400, no oracle on which condition failed.
    findLoginUserByIdMock.mockResolvedValue(TOTP_LOGIN_USER);
    getTotpStateMock.mockResolvedValue(backupState({ totpEnabled: false }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: {
        challengeToken: challengeTokenFor('u1'),
        code: authenticator.generate(TOTP_SECRET),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid code', errorCode: 'invalid_totp_code' });
    expect(getTotpStateMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  test('400 invalid_totp_code: unknown user behind the challenge token', async () => {
    findLoginUserByIdMock.mockResolvedValue(null);
    getTotpStateMock.mockResolvedValue(backupState());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: {
        challengeToken: challengeTokenFor('ghost'),
        code: authenticator.generate(TOTP_SECRET),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid code', errorCode: 'invalid_totp_code' });
    expect(getTotpStateMock).not.toHaveBeenCalled();
  });

  test('401 totp_challenge_expired: an expired challenge token is reported distinctly', async () => {
    findLoginUserByIdMock.mockResolvedValue(TOTP_LOGIN_USER);
    getTotpStateMock.mockResolvedValue(backupState());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: {
        challengeToken: challengeTokenFor('u1', '-1s'),
        code: authenticator.generate(TOTP_SECRET),
      },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Two-factor challenge expired',
      errorCode: 'totp_challenge_expired',
    });
    // We never reach the user/state reads when the token is dead.
    expect(findLoginUserByIdMock).not.toHaveBeenCalled();
  });

  test('401 totp_challenge_expired: a garbage challenge token is rejected the same way', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: { challengeToken: 'not-a-jwt', code: '123456' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Two-factor challenge expired',
      errorCode: 'totp_challenge_expired',
    });
    expect(findLoginUserByIdMock).not.toHaveBeenCalled();
  });

  test('401 totp_challenge_expired: a wrong-purpose (totp_enroll) token cannot complete the challenge', async () => {
    // An enroll token must not be replayable against the challenge endpoint.
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: {
        challengeToken: signPurposeToken(
          { userId: 'u1', purpose: 'totp_enroll', sessionVersion: 1 },
          '15m',
        ),
        code: '123456',
      },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Two-factor challenge expired',
      errorCode: 'totp_challenge_expired',
    });
    expect(findLoginUserByIdMock).not.toHaveBeenCalled();
  });

  test('400 missing code (Fastify schema rejection)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/totp-challenge',
      payload: { challengeToken: challengeTokenFor('u1') },
    });

    expect(res.statusCode).toBe(400);
  });
});
