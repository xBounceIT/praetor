import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { authenticator } from '@otplib/preset-v11';
import * as realBcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import { encrypt, isEncrypted } from '../../utils/crypto.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';
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
const drizzleSnap = { ...realDrizzle };
const generalSettingsRepoSnap = { ...realGeneralSettingsRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const auditSnap = { ...realAudit };
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
const findLoginUserByIdMock = mock();
const listAvailableRolesForUserMock = mock();
const generalSettingsGetMock = mock<() => Promise<{ enforceTotpForAdmins: boolean } | null>>(
  async () => null,
);
const logAuditMock = mock(async () => undefined);
const bcryptCompareMock = mock();
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
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
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
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
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
  findLoginUserByIdMock,
  listAvailableRolesForUserMock,
  logAuditMock,
  bcryptCompareMock,
  generalSettingsGetMock,
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
  findLoginUserByIdMock.mockResolvedValue(LOGIN_USER);
  bcryptCompareMock.mockResolvedValue(false);
  generalSettingsGetMock.mockResolvedValue(null);

  testApp = await buildRouteTestApp(twoFactorRoutePlugin, '/api/auth/2fa');
});

afterEach(async () => {
  await testApp.close();
});

const sessionHeader = (userId = 'u1') => ({
  authorization: `Bearer ${signToken({ userId })}`,
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

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: sessionHeader(),
    });

    expect(res.statusCode).toBe(200);
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

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: sessionHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(setTotpEnrollmentMock).not.toHaveBeenCalled();
    expect(auditActions()).toContain('user.totp_setup.conflict');
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
    expect(enableTotpMock).toHaveBeenCalledWith('u1', expect.any(String));
    expect(auditActions()).toContain('user.totp_enabled');
    // A logged-in caller already logged user.login at their original sign-in; confirming 2FA from
    // an existing session must NOT emit a second user.login.
    expect(auditActions()).not.toContain('user.login');
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
    expect(enableTotpMock).toHaveBeenCalledWith('u1', expect.any(String));
    expect(auditActions()).toContain('user.totp_enabled');
    // This path mints a real session (the user only had an enroll token), so it must also record
    // user.login — otherwise sessions born from mandatory enrollment are missing from the audit.
    expect(auditActions()).toContain('user.login');
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
    expect(disableTotpMock).toHaveBeenCalledWith('u1');
    expect(bumpSessionVersionMock).toHaveBeenCalledWith('u1');
    expect(typeof res.headers['x-auth-token']).toBe('string');
    expect(auditActions()).toContain('user.totp_disabled');
  });

  test('403 (enforced admin): cannot disable TOTP while the admin 2FA mandate applies', async () => {
    // enforceTotpForAdmins is on and the user holds an admin role, so a self-service disable is
    // rejected — an enforced admin must keep their second factor (only an admin reset can clear it).
    getTotpStateMock.mockResolvedValue(enabledState());
    findCoreByIdMock.mockResolvedValue({ ...userCore('local'), role: 'admin' });
    bcryptCompareMock.mockResolvedValue(true);
    generalSettingsGetMock.mockResolvedValue({ enforceTotpForAdmins: true });

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
    expect(disableTotpMock).toHaveBeenCalledWith('u1');
    expect(bumpSessionVersionMock).toHaveBeenCalledWith('u1');
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
});

describe('GET /api/auth/2fa/status', () => {
  test('200: { enabled: true, applicable: true } for a local user with 2FA on', async () => {
    getTotpStateMock.mockResolvedValue({
      totpSecret: encrypt(SECRET),
      totpEnabled: true,
      totpConfirmedAt: new Date(),
      totpBackupCodes: null,
    });
    findCoreByIdMock.mockResolvedValue(userCore('local'));

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/auth/2fa/status',
      headers: sessionHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ enabled: true, applicable: true });
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
    expect(JSON.parse(res.body)).toEqual({ enabled: false, applicable: false });
  });

  test('401 without a session token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/auth/2fa/status' });
    expect(res.statusCode).toBe(401);
  });
});
