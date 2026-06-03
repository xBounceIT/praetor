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
const bumpSessionVersionForUnenrolledAdminsMock = mock(async () => 0);
const logAuditMock = mock(async () => undefined);

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    bumpSessionVersionForUnenrolledAdmins: bumpSessionVersionForUnenrolledAdminsMock,
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
  sessionVersion: 1,
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
  rilCompanyName: 'ACME Consulting',
  rilDefaultStartTime: '08:30',
  rilDefaultExitTime: '17:30',
  rilLunchBreakMinutes: 45,
  rilNoteOptions: [
    { value: 'P', label: 'Ferie' },
    { value: 'P2', label: 'Permesso' },
    { value: 'M', label: 'Malattia' },
    { value: 'F', label: 'Festivita' },
  ],
  rilTransferOptions: ['In sede', 'Telelavoro'],
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  settingsGetMock,
  settingsUpdateMock,
  bumpSessionVersionForUnenrolledAdminsMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  // Default: viewer with admin perms (reveal API keys, allowed to PUT)
  getRolePermissionsMock.mockResolvedValue(['administration.general.update']);
  bumpSessionVersionForUnenrolledAdminsMock.mockResolvedValue(0);
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
    expect(body.rilCompanyName).toBe('');
    expect(body.rilDefaultStartTime).toBe('09:00');
    expect(body.rilDefaultExitTime).toBe('18:00');
    expect(body.rilLunchBreakMinutes).toBe(60);
    expect(body.rilNoteOptions).toEqual([
      { value: 'P', label: 'Ferie' },
      { value: 'P2', label: 'Permesso' },
      { value: 'M', label: 'Malattia' },
      { value: 'F', label: 'Festivita' },
    ]);
    expect(body.rilTransferOptions).toEqual(['In sede', 'Telelavoro']);
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

  test('200 enabling admin 2FA enforcement revokes unenrolled-admin sessions and audits it', async () => {
    // false -> true transition: pre-existing sessions of admin-capable users without TOTP must be
    // invalidated, or they keep admin privileges (incl. via /auth/switch-role) until expiry.
    settingsGetMock.mockResolvedValue({ ...SETTINGS_WITH_KEYS, enforceTotpForAdmins: false });
    settingsUpdateMock.mockResolvedValue({ ...SETTINGS_WITH_KEYS, enforceTotpForAdmins: true });
    bumpSessionVersionForUnenrolledAdminsMock.mockResolvedValue(3);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { enforceTotpForAdmins: true },
    });

    expect(res.statusCode).toBe(200);
    expect(bumpSessionVersionForUnenrolledAdminsMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.totp_enforcement_sessions_revoked',
        entityType: 'settings',
        details: expect.objectContaining({ secondaryLabel: '3' }),
      }),
    );
  });

  test('200 leaving enforcement already-on does not revoke sessions', async () => {
    settingsGetMock.mockResolvedValue({ ...SETTINGS_WITH_KEYS, enforceTotpForAdmins: true });
    settingsUpdateMock.mockResolvedValue({ ...SETTINGS_WITH_KEYS, enforceTotpForAdmins: true });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { enforceTotpForAdmins: true },
    });

    expect(res.statusCode).toBe(200);
    expect(bumpSessionVersionForUnenrolledAdminsMock).not.toHaveBeenCalled();
  });

  test('200 disabling enforcement does not revoke sessions', async () => {
    settingsGetMock.mockResolvedValue({ ...SETTINGS_WITH_KEYS, enforceTotpForAdmins: true });
    settingsUpdateMock.mockResolvedValue({ ...SETTINGS_WITH_KEYS, enforceTotpForAdmins: false });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { enforceTotpForAdmins: false },
    });

    expect(res.statusCode).toBe(200);
    expect(bumpSessionVersionForUnenrolledAdminsMock).not.toHaveBeenCalled();
  });

  test('200 accepts RIL settings and returns them', async () => {
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      rilCompanyName: 'Example Spa',
      rilDefaultStartTime: '09:15',
      rilDefaultExitTime: '17:45',
      rilLunchBreakMinutes: 30,
      rilNoteOptions: [{ value: 'HOL', label: 'Holiday' }],
      rilTransferOptions: ['Office', 'Remote'],
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: {
        rilCompanyName: 'Example Spa',
        rilDefaultStartTime: '09:15',
        rilDefaultExitTime: '17:45',
        rilLunchBreakMinutes: 30,
        rilNoteOptions: [{ value: 'HOL', label: 'Holiday' }],
        rilTransferOptions: ['Office', 'Remote'],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rilCompanyName: 'Example Spa',
        rilDefaultStartTime: '09:15',
        rilDefaultExitTime: '17:45',
        rilLunchBreakMinutes: 30,
        rilNoteOptions: [{ value: 'HOL', label: 'Holiday' }],
        rilTransferOptions: ['Office', 'Remote'],
      }),
    );
    const body = JSON.parse(res.body);
    expect(body.rilCompanyName).toBe('Example Spa');
    expect(body.rilDefaultStartTime).toBe('09:15');
    expect(body.rilDefaultExitTime).toBe('17:45');
    expect(body.rilLunchBreakMinutes).toBe(30);
    expect(body.rilNoteOptions).toEqual([{ value: 'HOL', label: 'Holiday' }]);
    expect(body.rilTransferOptions).toEqual(['Office', 'Remote']);
  });

  test('200 accepts blank RIL company name so admins can clear it', async () => {
    settingsUpdateMock.mockResolvedValue({ ...SETTINGS_WITH_KEYS, rilCompanyName: '' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { rilCompanyName: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ rilCompanyName: '' }),
    );
  });

  test('200 boolean strings parsed via strict boolean field validation', async () => {
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

  test('200 omitted boolean fields are preserved instead of coerced to false', async () => {
    settingsUpdateMock.mockResolvedValue(SETTINGS_WITH_KEYS);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { currency: 'USD' },
    });

    expect(res.statusCode).toBe(200);
    const patch = settingsUpdateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.currency).toBe('USD');
    expect(patch.treatSaturdayAsHoliday).toBeUndefined();
    expect(patch.enableAiReporting).toBeUndefined();
    expect(patch.allowWeekendSelection).toBeUndefined();
  });

  test('400 invalid boolean value does not update settings', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { enableAiReporting: 'ture' } as unknown as Record<string, unknown>,
    });

    expect(res.statusCode).toBe(400);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
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

  test('400 invalid startOfWeek enum, repo not called', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { startOfWeek: 'Tuesday' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/startOfWeek must be one of/);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('400 invalid defaultLocation enum, repo not called', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { defaultLocation: 'space_station' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/defaultLocation must be one of/);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('400 invalid RIL default start time, repo not called', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { rilDefaultStartTime: '24:01' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/rilDefaultStartTime must be in HH:mm format/);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('400 invalid RIL default exit time, repo not called', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { rilDefaultExitTime: '24:01' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/rilDefaultExitTime must be in HH:mm format/);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('400 invalid RIL lunch break, repo not called', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { rilLunchBreakMinutes: 241 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/rilLunchBreakMinutes must be an integer/);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('400 invalid RIL note options, repo not called', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { rilNoteOptions: [{ value: '', label: 'Blank' }] },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/rilNoteOptions\[0\]\.value cannot be blank/);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('400 invalid RIL transfer options, repo not called', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { rilTransferOptions: [''] },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/rilTransferOptions\[0\] cannot be blank/);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('200 accepts valid Sunday + customer_premise round-trip', async () => {
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      startOfWeek: 'Sunday',
      defaultLocation: 'customer_premise',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { startOfWeek: 'Sunday', defaultLocation: 'customer_premise' },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        startOfWeek: 'Sunday',
        defaultLocation: 'customer_premise',
      }),
    );
    const body = JSON.parse(res.body);
    expect(body.startOfWeek).toBe('Sunday');
    expect(body.defaultLocation).toBe('customer_premise');
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
