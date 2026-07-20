import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { authenticator } from '@otplib/preset-v11';
import * as realBcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realPersonalAccessTokensRepo from '../../repositories/personalAccessTokensRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realFirstLogin from '../../services/firstLogin.ts';
import * as realLdapService from '../../services/ldap.ts';
import * as realAudit from '../../utils/audit.ts';
import { encrypt, isEncrypted } from '../../utils/crypto.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

// crypto.encrypt/decrypt (used REAL here to build TOTP-secret fixtures and to exercise the
// route's own decrypt) requires ENCRYPTION_KEY. Must be set before the route module imports it.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-bytes-long!!';

// signPurposeToken is imported from the REAL middleware below — installAuthMiddlewareMock keeps it
// (it only wraps the response-sending guards), so the enroll tokens we mint here verify against the
// same JWT secret the route's requireEnrollOrSession guard uses.
const { signPurposeToken } = await import('../../middleware/auth.ts');

// Snapshot real exports so afterAll can restore them. Snapshot must run BEFORE mock.module
// fires (i.e., before beforeAll executes) — see comment in routes/auth.test.ts.
const usersRepoSnap = { ...realUsersRepo };
const personalAccessTokensRepoSnap = { ...realPersonalAccessTokensRepo };
const drizzleSnap = { ...realDrizzle };
const generalSettingsRepoSnap = { ...realGeneralSettingsRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const auditSnap = { ...realAudit };
const firstLoginSnap = { ...realFirstLogin };
const ldapServiceSnap = { ...(realLdapService as Record<string, unknown>) };
const bcryptSnap = { ...(realBcrypt as Record<string, unknown>) };

// Auth-middleware deps: the real authenticateToken / requireEnrollOrSession run end-to-end, so we
// mock their downstream calls (findAuthUserById, userHasRole, getRolePermissions).
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// usersRepo deps the 2FA route reaches.
const getTotpStateMock = mock();
const findCoreByIdMock = mock();
const setTotpEnrollmentMock = mock();
const enableTotpMock = mock();
const disableTotpMock = mock();
const markBackupCodeUsedMock = mock();
const setBackupCodesMock = mock();
const getPasswordHashMock = mock();
const bumpSessionVersionMock = mock();
const revokeUserCredentialsMock = mock();
const findLoginUserByIdMock = mock();
const listAvailableRolesForUserMock = mock();
const generalSettingsGetMock = mock<
  () => Promise<{
    enableTotp?: boolean;
    enforceTotp?: boolean;
    totpEnforcedRoleIds?: string[];
    totpExemptRoleIds?: string[];
    totpExemptUserIds?: string[];
  } | null>
>(async () => null);
const logAuditMock = mock(async () => undefined);
const bcryptCompareMock = mock();
const ldapAuthenticateWithProfileMock = mock();
// Personal-access-token auth path: lets tests forge a VALID PAT so authenticateToken populates
// request.auth.source = 'personalAccessToken' and the session-only guard is what rejects it.
const findPatByTokenHashMock = mock();
const markPatUsedMock = mock(async () => undefined);
const recordFirstInteractiveLoginMock = mock(async () => false);
const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

let twoFactorRoutePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    getTotpState: getTotpStateMock,
    findCoreById: findCoreByIdMock,
    setTotpEnrollment: setTotpEnrollmentMock,
    enableTotp: enableTotpMock,
    disableTotp: disableTotpMock,
    markBackupCodeUsed: markBackupCodeUsedMock,
    setBackupCodes: setBackupCodesMock,
    getPasswordHash: getPasswordHashMock,
    bumpSessionVersion: bumpSessionVersionMock,
    revokeUserCredentials: revokeUserCredentialsMock,
    findLoginUserById: findLoginUserByIdMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
    listAvailableRolesForUser: listAvailableRolesForUserMock,
  }));
  mock.module('../../repositories/generalSettingsRepo.ts', () => ({
    ...generalSettingsRepoSnap,
    get: generalSettingsGetMock,
  }));
  mock.module('../../repositories/personalAccessTokensRepo.ts', () => ({
    ...personalAccessTokensRepoSnap,
    findByTokenHash: findPatByTokenHashMock,
    markUsed: markPatUsedMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../services/firstLogin.ts', () => ({
    ...firstLoginSnap,
    recordFirstInteractiveLogin: recordFirstInteractiveLoginMock,
  }));
  mock.module('../../services/ldap.ts', () => ({
    default: { authenticateWithProfile: ldapAuthenticateWithProfileMock },
  }));
  // Override only `compare` (the disable-flow password check we want to control); keep the REAL
  // `hash` so totp.ts `hashBackupCode` still works on the setup/regenerate paths.
  mock.module('bcryptjs', () => ({
    ...bcryptSnap,
    default: { ...(bcryptSnap.default as Record<string, unknown>), compare: bcryptCompareMock },
    compare: bcryptCompareMock,
  }));

  twoFactorRoutePlugin = (await import('../../routes/two-factor.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../repositories/generalSettingsRepo.ts', () => generalSettingsRepoSnap);
  mock.module('../../repositories/personalAccessTokensRepo.ts', () => personalAccessTokensRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../services/firstLogin.ts', () => firstLoginSnap);
  mock.module('../../services/ldap.ts', () => ldapServiceSnap);
  mock.module('bcryptjs', () => bcryptSnap);
});

const SECRET = authenticator.generateSecret();
const validCode = () => authenticator.generate(SECRET);

const AUTH_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
  tokenVersion: 0,
};

const LOGIN_USER = {
  ...AUTH_USER,
  passwordHash: '$2a$hashed',
  employeeType: 'app_user' as const,
  authMethod: 'local' as const,
  authProviderId: null,
  totpEnabled: true,
};

const userCore = (authMethod: 'local' | 'ldap' | 'oidc' | 'saml' = 'local') => ({
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  employeeType: 'app_user' as const,
  hireDate: null,
  terminationDate: null,
  authMethod,
  authProviderId: null,
});

const HAPPY_PERMISSIONS = ['timesheets.tracker.view'];
const HAPPY_ROLES = [{ id: 'manager', name: 'Manager', isSystem: true, isAdmin: false }];

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  getTotpStateMock,
  findCoreByIdMock,
  setTotpEnrollmentMock,
  enableTotpMock,
  disableTotpMock,
  markBackupCodeUsedMock,
  setBackupCodesMock,
  getPasswordHashMock,
  bumpSessionVersionMock,
  revokeUserCredentialsMock,
  findLoginUserByIdMock,
  listAvailableRolesForUserMock,
  logAuditMock,
  bcryptCompareMock,
  ldapAuthenticateWithProfileMock,
  generalSettingsGetMock,
  findPatByTokenHashMock,
  markPatUsedMock,
  recordFirstInteractiveLoginMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  resetWithDbTransactionMock();

  // Happy auth path for session-authenticated endpoints (authenticateToken end-to-end).
  findAuthUserByIdMock.mockResolvedValue(AUTH_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(HAPPY_PERMISSIONS);
  listAvailableRolesForUserMock.mockResolvedValue(HAPPY_ROLES);
  logAuditMock.mockImplementation(async () => undefined);

  // 2FA repo defaults — overridden per test.
  findCoreByIdMock.mockResolvedValue(userCore('local'));
  getTotpStateMock.mockResolvedValue(null);
  setTotpEnrollmentMock.mockResolvedValue(undefined);
  enableTotpMock.mockResolvedValue(true);
  disableTotpMock.mockResolvedValue(undefined);
  markBackupCodeUsedMock.mockResolvedValue(undefined);
  setBackupCodesMock.mockResolvedValue(undefined);
  getPasswordHashMock.mockResolvedValue(LOGIN_USER.passwordHash);
  bumpSessionVersionMock.mockResolvedValue(undefined);
  revokeUserCredentialsMock.mockResolvedValue(undefined);
  findLoginUserByIdMock.mockResolvedValue(LOGIN_USER);
  bcryptCompareMock.mockResolvedValue(false);
  ldapAuthenticateWithProfileMock.mockResolvedValue({
    authenticated: false,
    groups: [],
    matchedRoleIds: [],
    roleMappings: [],
  });
  generalSettingsGetMock.mockResolvedValue(null);
  // A forged-but-VALID PAT for u1 (tokenVersion matches AUTH_USER), so authenticateToken accepts it
  // and the session-only guard is what rejects the request. Only consulted when a praetor_pat_ token
  // is sent; session tests use signToken and never hit this path.
  findPatByTokenHashMock.mockResolvedValue({
    userId: 'u1',
    tokenVersionAtIssue: AUTH_USER.tokenVersion,
    lastUsedAt: null,
    updatedAt: new Date(),
  });
  markPatUsedMock.mockResolvedValue(undefined);

  testApp = await buildRouteTestApp(twoFactorRoutePlugin, '/api/auth/2fa');
});

afterEach(async () => {
  await testApp.close();
});

const sessionHeader = (userId = 'u1') => ({
  authorization: `Bearer ${signToken({ userId })}`,
});

// A personal-access-token bearer header (praetor_pat_ prefix → authenticateToken's PAT path).
// Pairs with the default findPatByTokenHashMock so authenticateToken accepts it as a valid PAT.
const patHeader = () => ({
  authorization: 'Bearer praetor_pat_forged-test-token',
});

const enrollHeader = (userId = 'u1', sessionVersion = 1) => ({
  authorization: `Bearer ${signPurposeToken({ userId, purpose: 'totp_enroll', sessionVersion }, '15m')}`,
});

// Extracts the action strings passed to logAudit across all calls, in order.
const auditActions = () =>
  logAuditMock.mock.calls.map((call) => (call as unknown as [{ action: string }])[0].action);

describe('POST /api/auth/2fa/setup', () => {
  test('200 (session, local): returns secret/otpauthUri/qrDataUri/10 backup codes and stores an encrypted secret + 10 hashes', async () => {
    getTotpStateMock.mockResolvedValue(null);
    // Session path now requires step-up re-auth: the account password must verify before a secret
    // is written.
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: sessionHeader(),
      payload: { password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(bcryptCompareMock).toHaveBeenCalledWith('secret', LOGIN_USER.passwordHash);
    const body = JSON.parse(res.body);
    expect(body.secret).toEqual(expect.any(String));
    expect(body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Praetor:/);
    expect(body.otpauthUri).toContain('issuer=Praetor');
    expect(body.qrDataUri).toMatch(/^data:image\/png/);
    expect(Array.isArray(body.backupCodes)).toBe(true);
    expect(body.backupCodes).toHaveLength(10);
    for (const code of body.backupCodes) {
      expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    }

    // The persisted secret is encrypt() output (not plaintext), and exactly 10 hashes are stored.
    expect(setTotpEnrollmentMock).toHaveBeenCalledTimes(1);
    const [userIdArg, enrollmentArg] = setTotpEnrollmentMock.mock.calls[0] as unknown as [
      string,
      { encryptedSecret: string; backupCodeHashes: string[] },
    ];
    expect(userIdArg).toBe('u1');
    expect(isEncrypted(enrollmentArg.encryptedSecret)).toBe(true);
    expect(enrollmentArg.encryptedSecret).not.toBe(body.secret);
    expect(enrollmentArg.backupCodeHashes).toHaveLength(10);

    expect(auditActions()).toContain('user.totp_setup_started');
  });

  test('200 (enroll token): reachable with a totp_enroll purpose token', async () => {
    getTotpStateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: enrollHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(setTotpEnrollmentMock).toHaveBeenCalledTimes(1);
  });

  test('401 (enroll token): a sessionVersion rotation since the token was issued blocks setup and stores nothing', async () => {
    // A stale enroll token (e.g. an admin reset or credential rotation bumped sessionVersion after
    // /login minted it) must not overwrite the pending secret/backup codes. /setup mirrors the
    // /confirm guard so the stale token is rejected BEFORE any TOTP state is written.
    findLoginUserByIdMock.mockResolvedValue({ ...LOGIN_USER, sessionVersion: 2 });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: enrollHeader('u1', 1),
    });

    expect(res.statusCode).toBe(401);
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
  });

  test('401 (enroll token): a disabled account cannot store a new enrollment', async () => {
    findLoginUserByIdMock.mockResolvedValue({ ...LOGIN_USER, isDisabled: true });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: enrollHeader(),
    });

    expect(res.statusCode).toBe(401);
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
  });

  test('403 (oidc/saml): totp_not_applicable and no enrollment stored', async () => {
    findCoreByIdMock.mockResolvedValue(userCore('oidc'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: sessionHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorCode).toBe('totp_not_applicable');
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
  });

  test('403 (saml): totp_not_applicable', async () => {
    findCoreByIdMock.mockResolvedValue(userCore('saml'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: sessionHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorCode).toBe('totp_not_applicable');
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
  });

  test('409 when 2FA already enabled (audits user.totp_setup.conflict)', async () => {
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: true,
      totpConfirmedAt: new Date(),
      totpBackupCodes: null,
    });
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: sessionHeader(),
      payload: { password: 'secret' },
    });

    expect(res.statusCode).toBe(409);
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
    expect(auditActions()).toContain('user.totp_setup.conflict');
  });

  test('403 (feature disabled): the global kill-switch blocks new enrollment with totp_disabled', async () => {
    // When 2FA is turned off org-wide (enableTotp false), no new enrollment is allowed for anyone —
    // even an applicable local user. The gate fires before the step-up password check, and nothing
    // is persisted.
    getTotpStateMock.mockResolvedValue(null);
    findCoreByIdMock.mockResolvedValue(userCore('local'));
    generalSettingsGetMock.mockResolvedValue({ enableTotp: false });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: sessionHeader(),
      payload: { password: 'secret' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorCode).toBe('totp_disabled');
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
  });

  test('400 (session): missing password is rejected before any secret is written', async () => {
    // Step-up re-auth: a logged-in caller must supply their password. A stolen session alone (no
    // password) must not be able to enroll an attacker-controlled second factor.
    getTotpStateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: sessionHeader(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
  });

  test('400 (session, local): wrong password → totp_setup_reauth_failed, no secret written', async () => {
    getTotpStateMock.mockResolvedValue(null);
    bcryptCompareMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: sessionHeader(),
      payload: { password: 'wrong-password' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).errorCode).toBe('totp_setup_reauth_failed');
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
  });

  test('400 (session, ldap): rejects credentials for a different canonical LDAP identity', async () => {
    getTotpStateMock.mockResolvedValue(null);
    findCoreByIdMock.mockResolvedValue(userCore('ldap'));
    ldapAuthenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      canonicalUsername: 'attacker',
      groups: [],
      matchedRoleIds: [],
      roleMappings: [],
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: sessionHeader(),
      payload: { password: 'attacker-password' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).errorCode).toBe('totp_setup_reauth_failed');
    expect(ldapAuthenticateWithProfileMock).toHaveBeenCalledWith('alice', 'attacker-password');
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
  });

  test('200 (enroll token): no step-up password required (already login-verified)', async () => {
    // The enroll-token path must NOT require a password — the token was minted from a verified
    // login. bcryptCompare stays false (its default) to prove the password branch is never reached.
    getTotpStateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: enrollHeader(),
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(setTotpEnrollmentMock).toHaveBeenCalledTimes(1);
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  test('401 without any token', async () => {
    const res = await testApp.inject({ method: 'POST', url: '/api/auth/2fa/setup' });
    expect(res.statusCode).toBe(401);
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/2fa/confirm', () => {
  test('200 (session): correct code enables TOTP, audits user.totp_enabled, returns { enabled: true } only', async () => {
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/confirm',
      headers: sessionHeader(),
      payload: { code: validCode() },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ enabled: true });
    expect(body.token).toBeUndefined();
    // enableTotp is bound to the exact verified pending ciphertext (compare-and-swap), so the
    // verified secret is passed through, not just the user id.
    expect(enableTotpMock).toHaveBeenCalledWith('u1', expect.any(String), TX_SENTINEL);
    // Enabling 2FA rotates the user's other credentials in the same transaction (revoke pre-
    // enrollment sessions + PATs so they can't keep bypassing the new second factor).
    expect(revokeUserCredentialsMock).toHaveBeenCalledWith('u1', TX_SENTINEL);
    // The caller's own session is kept alive via a re-issued x-auth-token carrying the bumped
    // version (mirrors /disable) — enabling 2FA doesn't log the current device out.
    expect(typeof res.headers['x-auth-token']).toBe('string');
    expect(auditActions()).toContain('user.totp_enabled');
    // A logged-in caller already logged user.login at their original sign-in; confirming 2FA from
    // an existing session must NOT emit a second user.login.
    expect(auditActions()).not.toContain('user.login');
  });

  test('403 (session): the global kill-switch blocks confirming a pending enrollment with totp_disabled', async () => {
    // 2FA turned off org-wide between /setup and /confirm — finalizing enrollment must be refused
    // (mirrors the /setup gate), so a disabled feature can never activate a second factor.
    generalSettingsGetMock.mockResolvedValue({ enableTotp: false });
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/confirm',
      headers: sessionHeader(),
      payload: { code: validCode() },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorCode).toBe('totp_disabled');
    expect(enableTotpMock).not.toHaveBeenCalled();
  });

  test('403 (session): cannot confirm TOTP after the account is switched to an IdP-managed method', async () => {
    // A local user starts setup, then is switched to OIDC before submitting the code; their
    // still-valid session must not enable app TOTP on an IdP-managed account.
    findAuthUserByIdMock.mockResolvedValue({ ...AUTH_USER, authMethod: 'oidc' });
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/confirm',
      headers: sessionHeader(),
      payload: { code: validCode() },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorCode).toBe('totp_not_applicable');
    expect(enableTotpMock).not.toHaveBeenCalled();
  });

  test('400 (session): wrong code → invalid_totp_code, no enable, audits user.totp_enable.invalid_code', async () => {
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/confirm',
      headers: sessionHeader(),
      payload: { code: '000000' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).errorCode).toBe('invalid_totp_code');
    expect(enableTotpMock).not.toHaveBeenCalled();
    expect(auditActions()).toContain('user.totp_enable.invalid_code');
  });

  test('200 (enroll token): correct code returns { enabled, token, user } so the user is logged in', async () => {
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });
    findLoginUserByIdMock.mockResolvedValue(LOGIN_USER);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/confirm',
      headers: enrollHeader(),
      payload: { code: validCode() },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.enabled).toBe(true);
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toMatchObject({ id: 'u1', username: 'alice', role: 'manager' });
    expect(enableTotpMock).toHaveBeenCalledWith('u1', expect.any(String), TX_SENTINEL);
    // Enabling 2FA rotates the user's other credentials in the same transaction (revoke pre-
    // enrollment sessions + PATs so they can't keep bypassing the new second factor).
    expect(revokeUserCredentialsMock).toHaveBeenCalledWith('u1', TX_SENTINEL);
    expect(auditActions()).toContain('user.totp_enabled');
    // This path mints a real session (the user only had an enroll token), so it must also record
    // user.login — otherwise sessions born from mandatory enrollment are missing from the audit.
    expect(auditActions()).toContain('user.login');
    expect(recordFirstInteractiveLoginMock).toHaveBeenCalledWith('u1', {
      createRilPreferencesTip: false,
    });
  });

  test('401 (enroll token): account switched to OIDC/SAML since the token was issued is rejected', async () => {
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });
    findLoginUserByIdMock.mockResolvedValue({ ...LOGIN_USER, authMethod: 'oidc' });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/confirm',
      headers: enrollHeader(),
      payload: { code: validCode() },
    });

    expect(res.statusCode).toBe(401);
    // No local session is minted for an account no longer on a TOTP-applicable auth method.
    expect(JSON.parse(res.body).token).toBeUndefined();
    // The account is re-validated BEFORE any TOTP mutation, so a denied enroll never enables TOTP
    // or emits user.totp_enabled.
    expect(enableTotpMock).not.toHaveBeenCalled();
    expect(auditActions()).not.toContain('user.totp_enabled');
  });

  test('401 (enroll token): a sessionVersion rotation since the token was issued is rejected', async () => {
    // The enroll token carries the pre-rotation sessionVersion; the reloaded user has a bumped one
    // (password change / admin reset / disable), so confirm is rejected before enabling TOTP.
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });
    findLoginUserByIdMock.mockResolvedValue({ ...LOGIN_USER, sessionVersion: 2 });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/confirm',
      headers: enrollHeader('u1', 1),
      payload: { code: validCode() },
    });

    expect(res.statusCode).toBe(401);
    expect(enableTotpMock).not.toHaveBeenCalled();
  });

  test('400 when no pending enrollment exists', async () => {
    getTotpStateMock.mockResolvedValue({
      totpSecret: null,
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/confirm',
      headers: sessionHeader(),
      payload: { code: validCode() },
    });

    expect(res.statusCode).toBe(400);
    expect(enableTotpMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/2fa/disable', () => {
  const enabledState = () => ({
    totpSecret: encrypt(SECRET),
    totpEnabled: true,
    totpConfirmedAt: new Date(),
    totpBackupCodes: null,
  });

  test('200 (local): correct password AND valid code → disables, bumps session, sets x-auth-token', async () => {
    getTotpStateMock.mockResolvedValue(enabledState());
    findCoreByIdMock.mockResolvedValue(userCore('local'));
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/disable',
      headers: sessionHeader(),
      payload: { password: 'secret', code: validCode() },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ enabled: false });
    expect(bcryptCompareMock).toHaveBeenCalledWith('secret', LOGIN_USER.passwordHash);
    // disable + session-version bump run inside ONE transaction (shared TX sentinel), so the
    // account is never left disabled-but-not-revoked if a write fails between them.
    expect(withDbTransactionMock).toHaveBeenCalled();
    expect(disableTotpMock).toHaveBeenCalledWith('u1', TX_SENTINEL);
    expect(bumpSessionVersionMock).toHaveBeenCalledWith('u1', TX_SENTINEL);
    expect(typeof res.headers['x-auth-token']).toBe('string');
    expect(auditActions()).toContain('user.totp_disabled');
  });

  test('403 (enforced admin): cannot disable TOTP while the 2FA mandate applies to their role', async () => {
    // The feature + enforcement are on and the admin role is in the enforced set, so a self-service
    // disable is rejected — an enforced user must keep their second factor (only an admin reset can
    // clear it). isTotpMandatory runs for real here against the mocked policy + role lookups.
    getTotpStateMock.mockResolvedValue(enabledState());
    findCoreByIdMock.mockResolvedValue({ ...userCore('local'), role: 'admin' });
    bcryptCompareMock.mockResolvedValue(true);
    generalSettingsGetMock.mockResolvedValue({
      enableTotp: true,
      enforceTotp: true,
      totpEnforcedRoleIds: ['admin'],
      totpExemptRoleIds: [],
      totpExemptUserIds: [],
    });
    // The user's primary role ('admin') already satisfies the enforced set; no extra assignable
    // roles needed.
    listAvailableRolesForUserMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/disable',
      headers: sessionHeader(),
      payload: { password: 'secret', code: validCode() },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorCode).toBe('totp_required_for_admin');
    expect(disableTotpMock).not.toHaveBeenCalled();
    expect(bumpSessionVersionMock).not.toHaveBeenCalled();
  });

  test('400 (local): wrong code → invalid_totp_code, no disable, audits user.totp_disable.invalid_code', async () => {
    getTotpStateMock.mockResolvedValue(enabledState());
    findCoreByIdMock.mockResolvedValue(userCore('local'));
    bcryptCompareMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/disable',
      headers: sessionHeader(),
      payload: { password: 'secret', code: '000000' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).errorCode).toBe('invalid_totp_code');
    expect(disableTotpMock).not.toHaveBeenCalled();
    expect(bumpSessionVersionMock).not.toHaveBeenCalled();
    expect(auditActions()).toContain('user.totp_disable.invalid_code');
  });

  test('400 (local): wrong password short-circuits before the code is checked', async () => {
    getTotpStateMock.mockResolvedValue(enabledState());
    findCoreByIdMock.mockResolvedValue(userCore('local'));
    bcryptCompareMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/disable',
      headers: sessionHeader(),
      payload: { password: 'wrong', code: validCode() },
    });

    expect(res.statusCode).toBe(400);
    expect(disableTotpMock).not.toHaveBeenCalled();
  });

  test('200 (ldap): a valid code alone disables (no password required)', async () => {
    getTotpStateMock.mockResolvedValue(enabledState());
    findCoreByIdMock.mockResolvedValue(userCore('ldap'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/disable',
      headers: sessionHeader(),
      payload: { code: validCode() },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ enabled: false });
    expect(bcryptCompareMock).not.toHaveBeenCalled();
    // disable + session bump run atomically inside the same transaction (shared TX sentinel).
    expect(disableTotpMock).toHaveBeenCalledWith('u1', TX_SENTINEL);
    expect(bumpSessionVersionMock).toHaveBeenCalledWith('u1', TX_SENTINEL);
  });

  test('403 (PAT): a personal-access token cannot disable 2FA — session auth required', async () => {
    // A leaked PAT plus one current/recovery code must not be able to turn off the second factor;
    // requireSessionAuth rejects non-interactive credentials before the handler runs.
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/disable',
      headers: patHeader(),
      payload: { password: 'secret', code: validCode() },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('Session authentication required');
    expect(disableTotpMock).not.toHaveBeenCalled();
    expect(bumpSessionVersionMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/2fa/backup-codes/regenerate', () => {
  const enabledState = () => ({
    totpSecret: encrypt(SECRET),
    totpEnabled: true,
    totpConfirmedAt: new Date(),
    totpBackupCodes: null,
  });

  test('200: valid code → setBackupCodes with 10 codes, returns 10 plaintext codes', async () => {
    getTotpStateMock.mockResolvedValue(enabledState());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/backup-codes/regenerate',
      headers: sessionHeader(),
      payload: { code: validCode() },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.backupCodes).toHaveLength(10);
    for (const code of body.backupCodes) {
      expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    }

    expect(setBackupCodesMock).toHaveBeenCalledTimes(1);
    const [userIdArg, codesArg] = setBackupCodesMock.mock.calls[0] as unknown as [
      string,
      Array<{ hash: string; usedAt: string | null }>,
    ];
    expect(userIdArg).toBe('u1');
    expect(codesArg).toHaveLength(10);
    expect(codesArg.every((c) => typeof c.hash === 'string' && c.usedAt === null)).toBe(true);
    expect(auditActions()).toContain('user.totp_backup_codes_regenerated');
  });

  test('400: wrong code → invalid_totp_code, audits user.totp_backup_codes_regenerate.invalid_code', async () => {
    getTotpStateMock.mockResolvedValue(enabledState());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/backup-codes/regenerate',
      headers: sessionHeader(),
      payload: { code: '000000' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).errorCode).toBe('invalid_totp_code');
    expect(setBackupCodesMock).not.toHaveBeenCalled();
    expect(auditActions()).toContain('user.totp_backup_codes_regenerate.invalid_code');
  });

  test('403 (PAT): a personal-access token cannot regenerate backup codes — session auth required', async () => {
    // A leaked PAT plus one valid code must not be able to mint a fresh set of recovery codes;
    // requireSessionAuth rejects non-interactive credentials before the handler runs.
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/backup-codes/regenerate',
      headers: patHeader(),
      payload: { code: validCode() },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('Session authentication required');
    expect(setBackupCodesMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/2fa/status', () => {
  test('200: { enabled, applicable, featureEnabled, required } for a local user with 2FA on', async () => {
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: true,
      totpConfirmedAt: new Date(),
      totpBackupCodes: null,
    });
    findCoreByIdMock.mockResolvedValue(userCore('local'));
    // Default policy (null settings → feature on, enforcement off), so the feature is enabled but
    // 2FA isn't mandated for this user.
    generalSettingsGetMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/auth/2fa/status',
      headers: sessionHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      enabled: true,
      applicable: true,
      featureEnabled: true,
      required: false,
    });
  });

  test('200: required:true when the feature + enforcement are on and the role is enforced', async () => {
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: true,
      totpConfirmedAt: new Date(),
      totpBackupCodes: null,
    });
    findCoreByIdMock.mockResolvedValue({ ...userCore('local'), role: 'admin' });
    generalSettingsGetMock.mockResolvedValue({
      enableTotp: true,
      enforceTotp: true,
      totpEnforcedRoleIds: ['admin'],
      totpExemptRoleIds: [],
      totpExemptUserIds: [],
    });
    listAvailableRolesForUserMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/auth/2fa/status',
      headers: sessionHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      enabled: true,
      applicable: true,
      featureEnabled: true,
      required: true,
    });
  });

  test('200: featureEnabled:false when the org-wide 2FA feature is off', async () => {
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: true,
      totpConfirmedAt: new Date(),
      totpBackupCodes: null,
    });
    findCoreByIdMock.mockResolvedValue(userCore('local'));
    // Kill-switch off: the feature is disabled org-wide, so nothing is required even for an enrolled
    // applicable user.
    generalSettingsGetMock.mockResolvedValue({ enableTotp: false, enforceTotp: true });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/auth/2fa/status',
      headers: sessionHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      enabled: true,
      applicable: true,
      featureEnabled: false,
      required: false,
    });
  });

  test('200: { enabled: false, applicable: false } for an oidc user', async () => {
    getTotpStateMock.mockResolvedValue(null);
    findCoreByIdMock.mockResolvedValue(userCore('oidc'));

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/auth/2fa/status',
      headers: sessionHeader(),
    });

    expect(res.statusCode).toBe(200);
    // SSO users are never applicable and never required (their IdP owns MFA), but the org feature
    // can still be enabled.
    expect(JSON.parse(res.body)).toEqual({
      enabled: false,
      applicable: false,
      featureEnabled: true,
      required: false,
    });
  });

  test('401 without a session token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/auth/2fa/status' });
    expect(res.statusCode).toBe(401);
  });
});
