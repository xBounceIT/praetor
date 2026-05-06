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
    default: { invalidateConfig: invalidateConfigMock, syncUsers: syncUsersMock },
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

const BASE_CONFIG: realLdapRepo.LdapConfig = {
  enabled: false,
  serverUrl: 'ldap://ldap.example.com:389',
  baseDn: 'dc=example,dc=com',
  bindDn: '',
  bindPassword: '',
  userFilter: '(uid={0})',
  groupBaseDn: 'ou=groups,dc=example,dc=com',
  groupFilter: '(member={0})',
  roleMappings: [],
  tlsCaCertificate: '',
};

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
});

describe('PUT /api/ldap/config — tlsCaCertificate', () => {
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
