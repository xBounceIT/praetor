import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realLdapService from '../../services/ldap.ts';
import * as realPermissions from '../../utils/permissions.ts';
import * as realRateLimit from '../../utils/rate-limit.ts';
import { signToken } from '../helpers/jwt.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const ldapServiceSnap = { ...(realLdapService as Record<string, unknown>) };
const rateLimitSnap = { ...realRateLimit };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const authenticateWithProfileMock = mock();

let routePlugin: FastifyPluginAsync;
let testApp: FastifyInstance | undefined;

beforeAll(async () => {
  mock.module('../../utils/rate-limit.ts', () => ({
    ...rateLimitSnap,
    LOGIN_RATE_LIMIT: { max: 2, timeWindow: '1 minute' },
  }));
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../services/ldap.ts', () => ({
    default: {
      authenticateWithProfile: authenticateWithProfileMock,
    },
  }));

  routePlugin = (await import('../../routes/ldap.ts')).default as FastifyPluginAsync;
});

afterAll(async () => {
  if (testApp) await testApp.close();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../services/ldap.ts', () => ldapServiceSnap);
  mock.module('../../utils/rate-limit.ts', () => rateLimitSnap);
});

beforeEach(async () => {
  if (testApp) await testApp.close();

  findAuthUserByIdMock.mockReset();
  userHasRoleMock.mockReset();
  getRolePermissionsMock.mockReset();
  authenticateWithProfileMock.mockReset();

  findAuthUserByIdMock.mockResolvedValue({
    id: 'u1',
    name: 'Alice',
    username: 'alice',
    role: 'admin',
    avatarInitials: 'AL',
    isDisabled: false,
    sessionVersion: 1,
    tokenVersion: 1,
  });
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(['administration.authentication.update']);
  authenticateWithProfileMock.mockResolvedValue({
    authenticated: false,
    groups: [],
    matchedRoleIds: [],
  });

  const app = Fastify({ logger: false });
  await app.register(rateLimit, {
    ...realRateLimit.GLOBAL_RATE_LIMIT,
    global: true,
    hook: 'onRequest',
  });
  await app.register(routePlugin, { prefix: '/api/ldap' });
  await app.ready();
  testApp = app;
});

const injectLdapTest = () => {
  if (!testApp) throw new Error('testApp not initialized');
  return testApp.inject({
    method: 'POST',
    url: '/api/ldap/test',
    headers: {
      authorization: `Bearer ${signToken({ userId: 'u1' })}`,
      'content-type': 'application/json',
    },
    payload: { username: 'alice', password: 'wrong-password' },
  });
};

describe('POST /api/ldap/test rate limiting', () => {
  test('applies LOGIN_RATE_LIMIT before authentication for repeated credential tests', async () => {
    const first = await injectLdapTest();
    const second = await injectLdapTest();
    const third = await injectLdapTest();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    expect(findAuthUserByIdMock).toHaveBeenCalledTimes(2);
    expect(authenticateWithProfileMock).toHaveBeenCalledTimes(2);
  });
});
