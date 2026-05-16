import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { X509Certificate } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Response as LightMyRequestResponse } from 'light-my-request';
import selfsigned from 'selfsigned';
import * as realLdapRepo from '../../repositories/ldapRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realLdapService from '../../services/ldap.ts';
import * as realAudit from '../../utils/audit.ts';
import { MASKED_SECRET } from '../../utils/crypto.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const ldapRepoSnap = { ...realLdapRepo };
const auditSnap = { ...realAudit };
const ldapServiceSnap = { ...(realLdapService as Record<string, unknown>) };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const ldapGetMock = mock();
const ldapUpdateMock = mock();
const ldapUpdatePreservingStoredBindPasswordMock = mock();
const findExistingIdsMock = mock();
const logAuditMock = mock(async () => undefined);
const invalidateConfigMock = mock();
const syncUsersMock = mock();
const authenticateWithProfileMock = mock();

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
    findExistingIds: findExistingIdsMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/ldapRepo.ts', () => ({
    ...ldapRepoSnap,
    get: ldapGetMock,
    update: ldapUpdateMock,
    updatePreservingStoredBindPassword: ldapUpdatePreservingStoredBindPasswordMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../services/ldap.ts', () => ({
    default: {
      authenticateWithProfile: authenticateWithProfileMock,
      invalidateConfig: invalidateConfigMock,
      syncUsers: syncUsersMock,
    },
  }));

  routePlugin = (await import('../../routes/ldap.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/ldapRepo.ts', () => ldapRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../services/ldap.ts', () => ldapServiceSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'admin',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

const BASE_CONFIG: realLdapRepo.LdapConfig = realLdapRepo.DEFAULT_CONFIG;

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  ldapGetMock,
  ldapUpdateMock,
  ldapUpdatePreservingStoredBindPasswordMock,
  findExistingIdsMock,
  logAuditMock,
  invalidateConfigMock,
  syncUsersMock,
  authenticateWithProfileMock,
];

let testApp: FastifyInstance;
let validPemCert: string;
let validPemCert2: string;

beforeAll(async () => {
  // Generate real, parseable self-signed certs once per file. `selfsigned.generate` is async
  // when called without a callback. Using `selfsigned` (already a server dependency for the
  // dev HTTPS cert) avoids hand-rolled fake PEMs that X509Certificate would correctly reject.
  // `days` is supported at runtime but missing from the package's TS typing.
  type SelfsignedOpts = Parameters<typeof selfsigned.generate>[1];
  const opts: SelfsignedOpts = { keySize: 2048, days: 1 } as SelfsignedOpts;
  const [pems, pems2] = await Promise.all([
    selfsigned.generate([{ name: 'commonName', value: 'praetor-test-ca' }], opts),
    selfsigned.generate([{ name: 'commonName', value: 'praetor-test-ca-2' }], opts),
  ]);
  validPemCert = pems.cert;
  validPemCert2 = pems2.cert;
  // Sanity check: the generated PEMs must round-trip through node:crypto.
  new X509Certificate(validPemCert);
  new X509Certificate(validPemCert2);
});

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue([
    'administration.authentication.view',
    'administration.authentication.update',
  ]);
  findExistingIdsMock.mockResolvedValue(new Set<string>());
  ldapGetMock.mockResolvedValue(BASE_CONFIG);
  ldapUpdateMock.mockImplementation(async (patch: Partial<realLdapRepo.LdapConfig>) => {
    // Mirror the repo's COALESCE semantics: undefined keys preserve, defined keys overwrite.
    const merged = { ...BASE_CONFIG };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
    }
    return merged;
  });
  ldapUpdatePreservingStoredBindPasswordMock.mockImplementation(
    async (patch: Partial<realLdapRepo.LdapConfig>) => {
      const stored = (await ldapGetMock()) ?? BASE_CONFIG;
      if (!stored.bindPassword) return null;
      const merged = { ...stored };
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'bindPassword') continue;
        if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
      }
      return merged;
    },
  );
  logAuditMock.mockImplementation(async () => undefined);
  invalidateConfigMock.mockImplementation(() => {});
  authenticateWithProfileMock.mockResolvedValue({
    authenticated: false,
    groups: [],
    matchedRoleIds: [],
  });
  syncUsersMock.mockResolvedValue({ synced: 0, created: 0 });

  testApp = await buildRouteTestApp(routePlugin, '/api/ldap');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

const putConfig = (payload: object): Promise<LightMyRequestResponse> =>
  testApp.inject({
    method: 'PUT',
    url: '/api/ldap/config',
    headers: { ...authHeader(), 'content-type': 'application/json' },
    payload,
  });

const testLdapAuth = (payload: object): Promise<LightMyRequestResponse> =>
  testApp.inject({
    method: 'POST',
    url: '/api/ldap/test',
    headers: { ...authHeader(), 'content-type': 'application/json' },
    payload,
  });

const syncLdap = (): Promise<LightMyRequestResponse> =>
  testApp.inject({
    method: 'POST',
    url: '/api/ldap/sync',
    headers: authHeader(),
  });

describe('GET /api/ldap/config', () => {
  test('returns the stored config including tlsCaCertificate', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, tlsCaCertificate: validPemCert });
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/ldap/config',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).tlsCaCertificate).toBe(validPemCert);
  });

  test('masks a stored bindPassword with MASKED_SECRET so the secret never leaves the server', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, bindPassword: 'super-secret-bind-pw' });
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/ldap/config',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.bindPassword).toBe(MASKED_SECRET);
    expect(response.body).not.toContain('super-secret-bind-pw');
  });

  test('returns empty bindPassword when none is stored (no spurious mask)', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, bindPassword: '' });
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/ldap/config',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).bindPassword).toBe('');
  });

  test('returns DEFAULT_CONFIG (with empty tlsCaCertificate) when no row exists', async () => {
    ldapGetMock.mockResolvedValue(null);
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/ldap/config',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).tlsCaCertificate).toBe('');
  });

  test('returns autoProvisionAll=false by default', async () => {
    ldapGetMock.mockResolvedValue(null);
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/ldap/config',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).autoProvisionAll).toBe(false);
  });

  test('returns stored autoProvisionAll=true when set', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, autoProvisionAll: true });
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/ldap/config',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).autoProvisionAll).toBe(true);
  });
});

describe('PUT /api/ldap/config - bindPassword masking', () => {
  test('bindPassword=MASKED_SECRET is dropped from the patch so the stored secret is preserved', async () => {
    // The client can round-trip the same bindDn it received from GET while keeping the
    // mask sentinel; only the stored password is preserved.
    ldapGetMock.mockResolvedValue({
      ...BASE_CONFIG,
      bindDn: 'cn=admin,dc=example,dc=com',
      bindPassword: 'stored-secret',
    });
    const response = await putConfig({
      enabled: false,
      bindDn: 'cn=admin,dc=example,dc=com',
      bindPassword: MASKED_SECRET,
    });
    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).not.toHaveBeenCalled();
    const patch = ldapUpdatePreservingStoredBindPasswordMock.mock
      .calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.bindPassword).toBeUndefined();
    // Unchanged bindDn is omitted from the patch, avoiding a no-op write to that column.
    expect(patch.bindDn).toBeUndefined();
  });

  test('allows a bindDn change when bindPassword is masked by preserving the stored secret', async () => {
    ldapGetMock.mockResolvedValue({
      ...BASE_CONFIG,
      bindDn: 'cn=admin,dc=example,dc=com',
      bindPassword: 'stored-secret',
    });
    const response = await putConfig({
      enabled: false,
      bindDn: 'cn=rotated,dc=example,dc=com',
      bindPassword: MASKED_SECRET,
    });
    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).not.toHaveBeenCalled();
    const patch = ldapUpdatePreservingStoredBindPasswordMock.mock
      .calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.bindDn).toBe('cn=rotated,dc=example,dc=com');
    expect(patch.bindPassword).toBeUndefined();
  });

  test('returns 409 if the stored bindPassword is cleared before the masked update writes', async () => {
    ldapGetMock.mockResolvedValue({
      ...BASE_CONFIG,
      bindDn: 'cn=admin,dc=example,dc=com',
      bindPassword: 'stored-secret',
    });
    ldapUpdatePreservingStoredBindPasswordMock.mockResolvedValue(null);
    const response = await putConfig({
      enabled: false,
      bindDn: 'cn=rotated,dc=example,dc=com',
      bindPassword: MASKED_SECRET,
    });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      error: 'LDAP bind credentials changed while saving; reload the configuration and try again',
      errorCode: 'ldap_bind_credentials_changed',
    });
    expect(ldapUpdateMock).not.toHaveBeenCalled();
    expect(invalidateConfigMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  test('rejects a masked bindPassword when there is no stored secret to preserve', async () => {
    ldapGetMock.mockResolvedValue({
      ...BASE_CONFIG,
      bindDn: 'cn=admin,dc=example,dc=com',
      bindPassword: '',
    });
    const response = await putConfig({
      enabled: false,
      bindDn: 'cn=rotated,dc=example,dc=com',
      bindPassword: MASKED_SECRET,
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain(
      'bindDn and bindPassword must be provided together',
    );
    expect(ldapUpdateMock).not.toHaveBeenCalled();
    expect(ldapUpdatePreservingStoredBindPasswordMock).not.toHaveBeenCalled();
  });

  test('a real new bindPassword (non-mask) is forwarded to ldapRepo.update', async () => {
    const response = await putConfig({
      enabled: false,
      bindDn: 'cn=admin,dc=example,dc=com',
      bindPassword: 'a-new-secret',
    });
    expect(response.statusCode).toBe(200);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.bindPassword).toBe('a-new-secret');
    expect(patch.bindDn).toBe('cn=admin,dc=example,dc=com');
  });

  test('PUT response masks bindPassword in the returned config', async () => {
    ldapUpdateMock.mockImplementation(async () => ({
      ...BASE_CONFIG,
      bindDn: 'cn=admin,dc=example,dc=com',
      bindPassword: 'a-new-secret',
    }));
    const response = await putConfig({
      enabled: false,
      bindDn: 'cn=admin,dc=example,dc=com',
      bindPassword: 'a-new-secret',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.bindPassword).toBe(MASKED_SECRET);
    expect(response.body).not.toContain('a-new-secret');
  });
});

describe('PUT /api/ldap/config - autoProvisionAll', () => {
  test('omitting autoProvisionAll does not pass the key to ldapRepo.update', async () => {
    const response = await putConfig({ enabled: false });
    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).toHaveBeenCalledTimes(1);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.autoProvisionAll).toBeUndefined();
  });

  test('passing autoProvisionAll=true forwards it to ldapRepo.update', async () => {
    const response = await putConfig({ enabled: false, autoProvisionAll: true });
    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).toHaveBeenCalledTimes(1);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.autoProvisionAll).toBe(true);
  });

  test('passing autoProvisionAll=false forwards it to ldapRepo.update', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, autoProvisionAll: true });
    const response = await putConfig({ enabled: false, autoProvisionAll: false });
    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).toHaveBeenCalledTimes(1);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.autoProvisionAll).toBe(false);
  });

  test('invalid enabled value does not update LDAP config', async () => {
    const response = await putConfig({ enabled: 'ture' } as unknown as object);

    expect(response.statusCode).toBe(400);
    expect(ldapUpdateMock).not.toHaveBeenCalled();
  });

  test('invalid autoProvisionAll value does not update LDAP config', async () => {
    const response = await putConfig({
      enabled: false,
      autoProvisionAll: 'ture',
    } as unknown as object);

    expect(response.statusCode).toBe(400);
    expect(ldapUpdateMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/ldap/config - tlsCaCertificate', () => {
  test('omitting tlsCaCertificate does not pass the key to ldapRepo.update', async () => {
    const response = await putConfig({ enabled: false });
    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).toHaveBeenCalledTimes(1);
    const patch = ldapUpdateMock.mock.calls[0][0];
    expect(patch).not.toHaveProperty('tlsCaCertificate');
  });

  test('valid PEM is normalized (trimmed + LF + trailing newline) before persistence', async () => {
    const messy = `\n\n${validPemCert.replace(/\n/g, '\r\n')}\n\n`;
    const response = await putConfig({ enabled: false, tlsCaCertificate: messy });
    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).toHaveBeenCalledTimes(1);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.tlsCaCertificate).not.toContain('\r');
    expect(patch.tlsCaCertificate?.endsWith('\n')).toBe(true);
    expect(patch.tlsCaCertificate?.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
  });

  test('empty string clears the field (passes "" to repo.update)', async () => {
    const response = await putConfig({ enabled: false, tlsCaCertificate: '' });
    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).toHaveBeenCalledTimes(1);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.tlsCaCertificate).toBe('');
  });

  test('null clears the field (treated like empty)', async () => {
    const response = await putConfig({ enabled: false, tlsCaCertificate: null });
    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).toHaveBeenCalledTimes(1);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.tlsCaCertificate).toBe('');
  });

  test('whitespace-only string is treated as clear', async () => {
    const response = await putConfig({ enabled: false, tlsCaCertificate: '   \n\t  ' });
    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).toHaveBeenCalledTimes(1);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.tlsCaCertificate).toBe('');
  });

  test('rejects PEM without BEGIN/END CERTIFICATE markers with 400', async () => {
    const response = await putConfig({
      enabled: false,
      tlsCaCertificate: 'not a real cert at all',
    });
    expect(response.statusCode).toBe(400);
    expect(ldapUpdateMock).not.toHaveBeenCalled();
    expect(JSON.parse(response.body).error).toMatch(/PEM-encoded.*BEGIN.*END/i);
  });

  test('rejects PEM with valid markers but garbage body via X509Certificate parse with 400', async () => {
    const malformed =
      '-----BEGIN CERTIFICATE-----\nnot-base64-at-all!@#\n-----END CERTIFICATE-----';
    const response = await putConfig({ enabled: false, tlsCaCertificate: malformed });
    expect(response.statusCode).toBe(400);
    expect(ldapUpdateMock).not.toHaveBeenCalled();
    expect(JSON.parse(response.body).error).toMatch(/not a valid PEM certificate/i);
  });

  test('strips non-CERTIFICATE blocks (incl. accidental PRIVATE KEY) and surrounding text before persistence', async () => {
    const accidentalPrivateKey =
      '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA\n-----END PRIVATE KEY-----';
    const payload = [
      '# operator note: trust chain assembled 2026-05-16',
      validPemCert.trim(),
      'free-text-between-blocks',
      accidentalPrivateKey,
      validPemCert2.trim(),
      '# trailing comment',
    ].join('\n');

    const response = await putConfig({ enabled: false, tlsCaCertificate: payload });

    expect(response.statusCode).toBe(200);
    expect(ldapUpdateMock).toHaveBeenCalledTimes(1);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    const persisted = patch.tlsCaCertificate ?? '';
    expect(persisted.match(/-----BEGIN CERTIFICATE-----/g)?.length).toBe(2);
    expect(persisted.match(/-----END CERTIFICATE-----/g)?.length).toBe(2);
    expect(persisted).not.toMatch(
      /PRIVATE KEY|operator note|free-text-between-blocks|trailing comment/,
    );
  });

  test('successful update invalidates the LDAP service config cache', async () => {
    const response = await putConfig({ enabled: false, tlsCaCertificate: validPemCert });
    expect(response.statusCode).toBe(200);
    expect(invalidateConfigMock).toHaveBeenCalledTimes(1);
  });

  test('audit details never include the cert content itself', async () => {
    ldapUpdateMock.mockImplementation(async () => ({
      ...BASE_CONFIG,
      tlsCaCertificate: validPemCert,
    }));
    await putConfig({ enabled: false, tlsCaCertificate: validPemCert });
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const calls = logAuditMock.mock.calls as unknown as { details?: unknown }[][];
    expect(JSON.stringify(calls[0][0].details)).not.toContain('BEGIN CERTIFICATE');
  });
});

describe('POST /api/ldap/test', () => {
  test('returns the server LDAP authentication profile for valid credentials', async () => {
    authenticateWithProfileMock.mockResolvedValue({
      authenticated: true,
      userDn: 'uid=alice,ou=people,dc=example,dc=com',
      groups: ['cn=admins,ou=groups,dc=example,dc=com'],
      matchedRoleIds: ['admin'],
    });

    const response = await testLdapAuth({ username: ' alice ', password: 'secret' });

    expect(response.statusCode).toBe(200);
    expect(authenticateWithProfileMock).toHaveBeenCalledWith('alice', 'secret', {
      allowDisabledConfig: true,
      reloadConfig: true,
    });
    expect(JSON.parse(response.body)).toEqual({
      success: true,
      authenticated: true,
      username: 'alice',
      message: 'LDAP authentication succeeded',
      userDn: 'uid=alice,ou=people,dc=example,dc=com',
      groups: ['cn=admins,ou=groups,dc=example,dc=com'],
      roleIds: ['admin'],
    });
  });

  test('returns an unsuccessful server response without groups or roles for failed auth', async () => {
    authenticateWithProfileMock.mockResolvedValue({
      authenticated: false,
      groups: ['cn=admins,ou=groups,dc=example,dc=com'],
      matchedRoleIds: ['admin'],
    });

    const response = await testLdapAuth({ username: 'alice', password: 'wrong' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      authenticated: false,
      username: 'alice',
      groups: [],
      roleIds: [],
    });
  });

  test('rejects blank tester credentials before reaching LDAP', async () => {
    const response = await testLdapAuth({ username: '   ', password: 'secret' });

    expect(response.statusCode).toBe(400);
    expect(authenticateWithProfileMock).not.toHaveBeenCalled();
    expect(JSON.parse(response.body).error).toMatch(/username/i);
  });
});

describe('POST /api/ldap/sync', () => {
  test('rejects manual sync when LDAP is disabled without calling the service', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, enabled: false });

    const response = await syncLdap();

    expect(response.statusCode).toBe(400);
    expect(syncUsersMock).not.toHaveBeenCalled();
    // The denial is audited via `replyError` so investigators can see failed sync attempts.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ldap.sync.invalid', entityType: 'ldap_config' }),
    );
    expect(JSON.parse(response.body)).toEqual({
      success: false,
      error: 'LDAP is not enabled',
      errorCode: 'ldap_not_enabled',
    });
  });

  test('returns success and writes an audit entry when LDAP sync completes', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, enabled: true });
    syncUsersMock.mockResolvedValue({ synced: 2, created: 1 });

    const response = await syncLdap();

    expect(response.statusCode).toBe(200);
    expect(syncUsersMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(response.body)).toEqual({ success: true, synced: 2, created: 1 });
  });

  test('does not report success when the LDAP service skips sync', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, enabled: true });
    syncUsersMock.mockResolvedValue({ skipped: true, reason: 'LDAP config not loaded' });

    const response = await syncLdap();

    expect(response.statusCode).toBe(400);
    // The skipped sync is audited so investigators can see when sync was attempted but bailed.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ldap.sync.invalid', entityType: 'ldap_config' }),
    );
    expect(JSON.parse(response.body)).toEqual({
      success: false,
      error: 'LDAP config not loaded',
      errorCode: 'ldap_sync_skipped',
      skipped: true,
      reason: 'LDAP config not loaded',
    });
  });

  test('returns a non-success service-unavailable response when LDAP sync fails', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, enabled: true });
    syncUsersMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const response = await syncLdap();

    expect(response.statusCode).toBe(503);
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(JSON.parse(response.body)).toEqual({
      success: false,
      error: 'LDAP sync failed: connect ECONNREFUSED',
      errorCode: 'ldap_sync_failed',
    });
  });
});
