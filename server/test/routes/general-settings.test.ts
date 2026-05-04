import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
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
const generalSettingsRepoSnap = { ...realGeneralSettingsRepo };
const auditSnap = { ...realAudit };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const settingsGetMock = mock();
const settingsUpdateMock = mock();
const logAuditMock = mock(async () => undefined);

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
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/generalSettingsRepo.ts', () => ({
    ...generalSettingsRepoSnap,
    get: settingsGetMock,
    update: settingsUpdateMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));

  routePlugin = (await import('../../routes/general-settings.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/generalSettingsRepo.ts', () => generalSettingsRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
};

const SETTINGS_WITH_KEYS = {
  currency: 'EUR',
  dailyLimit: 8,
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: true,
  enableAiReporting: true,
  geminiApiKey: 'plaintext-gemini-key',
  aiProvider: 'gemini',
  openrouterApiKey: 'plaintext-openrouter-key',
  geminiModelId: 'gemini-2.5-flash',
  openrouterModelId: 'anthropic/claude-3-haiku',
  allowWeekendSelection: false,
  defaultLocation: 'remote',
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  settingsGetMock,
  settingsUpdateMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  // Default: viewer with admin perms (reveal API keys, allowed to PUT)
  getRolePermissionsMock.mockResolvedValue(['administration.general.update']);
  logAuditMock.mockImplementation(async () => undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/general-settings');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/general-settings', () => {
  test('200 with administration.general.update reveals API keys', async () => {
    settingsGetMock.mockResolvedValue(SETTINGS_WITH_KEYS);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/general-settings',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.geminiApiKey).toBe('plaintext-gemini-key');
    expect(body.openrouterApiKey).toBe('plaintext-openrouter-key');
  });

  test('200 without admin perm masks API keys', async () => {
    getRolePermissionsMock.mockResolvedValue([]); // no admin perm
    settingsGetMock.mockResolvedValue(SETTINGS_WITH_KEYS);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/general-settings',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.geminiApiKey).toBe(MASKED_SECRET);
    expect(body.openrouterApiKey).toBe(MASKED_SECRET);
  });

  test('200 returns DEFAULT_SETTINGS when repo returns null', async () => {
    settingsGetMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/general-settings',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.currency).toBe('EUR');
    expect(body.dailyLimit).toBe(8);
    expect(body.startOfWeek).toBe('Monday');
    expect(body.allowWeekendSelection).toBe(true);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/general-settings',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('PUT /api/general-settings', () => {
  test('200 round-trip: updates fields, emits audit, response unmasked', async () => {
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      aiProvider: 'openrouter',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { aiProvider: 'openrouter', currency: 'USD' },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ aiProvider: 'openrouter', currency: 'USD' }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.updated',
        entityType: 'settings',
      }),
    );
    const body = JSON.parse(res.body);
    expect(body.geminiApiKey).toBe('plaintext-gemini-key');
  });

  test('200 boolean strings parsed via parseBoolean', async () => {
    settingsUpdateMock.mockResolvedValue(SETTINGS_WITH_KEYS);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: {
        treatSaturdayAsHoliday: 'true',
        enableAiReporting: 'false',
        allowWeekendSelection: 'true',
      } as unknown as Record<string, unknown>,
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        treatSaturdayAsHoliday: true,
        enableAiReporting: false,
        allowWeekendSelection: true,
      }),
    );
  });

  test('400 invalid aiProvider enum', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { aiProvider: 'invalid_provider' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/aiProvider must be one of/);
  });

  test('403 missing administration.general.update', async () => {
    getRolePermissionsMock.mockResolvedValue([]); // no perm

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { currency: 'USD' },
    });

    expect(res.statusCode).toBe(403);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      payload: { currency: 'USD' },
    });
    expect(res.statusCode).toBe(401);
  });
});
