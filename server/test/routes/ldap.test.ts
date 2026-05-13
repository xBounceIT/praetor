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
};

const BASE_CONFIG: realLdapRepo.LdapConfig = realLdapRepo.DEFAULT_CONFIG;

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  ldapGetMock,
  ldapUpdateMock,
  findExistingIdsMock,
  logAuditMock,
  invalidateConfigMock,
  syncUsersMock,
  authenticateWithProfileMock,
];

let testApp: FastifyInstance;
let validPemCert: string;

beforeAll(async () => {
  // Generate a real, parseable self-signed cert once per file. `selfsigned.generate` is async
  // when called without a callback. Using `selfsigned` (already a server dependency for the
  // dev HTTPS cert) avoids hand-rolled fake PEMs that X509Certificate would correctly reject.
  // `days` is supported at runtime but missing from the package's TS typing.
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'praetor-test-ca' }], {
    keySize: 2048,
    days: 1,
  } as Parameters<typeof selfsigned.generate>[1]);
  validPemCert = pems.cert;
  // Sanity check: the generated PEM must round-trip through node:crypto.
  new X509Certificate(validPemCert);
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
  logAuditMock.mockImplementation(async () => undefined);
  invalidateConfigMock.mockImplementation(() => {});
  authenticateWithProfileMock.mockResolvedValue({
    authenticated: false,
    groups: [],
    matchedRoleIds: [],
  });

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
    // The client must round-trip the SAME bindDn it received from GET when keeping the
    // mask sentinel - otherwise the request is rejected to prevent a silent DN edit.
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, bindDn: 'cn=admin,dc=example,dc=com' });
    const response = await putConfig({
      enabled: false,
      bindDn: 'cn=admin,dc=example,dc=com',
      bindPassword: MASKED_SECRET,
    });
    expect(response.statusCode).toBe(200);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.bindPassword).toBeUndefined();
    // bindDn must also be dropped (paired with bindPassword) so the stored credential survives
    // unchanged; otherwise the COALESCE-on-undefined trick can't preserve the pair atomically.
    expect(patch.bindDn).toBeUndefined();
  });

  test('rejects a bindDn change when bindPassword is masked (no silent DN swap)', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, bindDn: 'cn=admin,dc=example,dc=com' });
    const response = await putConfig({
      enabled: false,
      bindDn: 'cn=rotated,dc=example,dc=com',
      bindPassword: MASKED_SECRET,
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('bindDn cannot be changed');
    expect(ldapUpdateMock).not.toHaveBeenCalled();
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
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.autoProvisionAll).toBeUndefined();
  });

  test('passing autoProvisionAll=true forwards it to ldapRepo.update', async () => {
    const response = await putConfig({ enabled: false, autoProvisionAll: true });
    expect(response.statusCode).toBe(200);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.autoProvisionAll).toBe(true);
  });

  test('passing autoProvisionAll=false forwards it to ldapRepo.update', async () => {
    ldapGetMock.mockResolvedValue({ ...BASE_CONFIG, autoProvisionAll: true });
    const response = await putConfig({ enabled: false, autoProvisionAll: false });
    expect(response.statusCode).toBe(200);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.autoProvisionAll).toBe(false);
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
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.tlsCaCertificate).not.toContain('\r');
    expect(patch.tlsCaCertificate?.endsWith('\n')).toBe(true);
    expect(patch.tlsCaCertificate?.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
  });

  test('empty string clears the field (passes "" to repo.update)', async () => {
    const response = await putConfig({ enabled: false, tlsCaCertificate: '' });
    expect(response.statusCode).toBe(200);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.tlsCaCertificate).toBe('');
  });

  test('null clears the field (treated like empty)', async () => {
    const response = await putConfig({ enabled: false, tlsCaCertificate: null });
    expect(response.statusCode).toBe(200);
    const patch = ldapUpdateMock.mock.calls[0][0] as Partial<realLdapRepo.LdapConfig>;
    expect(patch.tlsCaCertificate).toBe('');
  });

  test('whitespace-only string is treated as clear', async () => {
    const response = await putConfig({ enabled: false, tlsCaCertificate: '   \n\t  ' });
    expect(response.statusCode).toBe(200);
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
    expect(authenticateWithProfileMock).toHaveBeenCalledWith('alice', 'secret');
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
