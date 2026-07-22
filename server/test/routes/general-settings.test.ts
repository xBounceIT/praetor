import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
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
import { decodeForAssertion, signToken } from '../helpers/jwt.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const generalSettingsRepoSnap = { ...realGeneralSettingsRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const settingsGetMock = mock();
const settingsUpdateMock = mock();
const revokeTokensForUnenrolledEnforcedUsersMock = mock(async () => 0);
// Run the callback with a throwaway tx so the route's atomic enable-enforcement branch executes its
// body; the repo calls inside are themselves mocked and ignore the executor.
const withDbTransactionMock = mock(async (fn: (tx: unknown) => unknown) => fn({}));
const logAuditMock = mock(async () => undefined);

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    revokeTokensForUnenrolledEnforcedUsers: revokeTokensForUnenrolledEnforcedUsersMock,
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
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
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
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
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
  anthropicApiKey: 'plaintext-anthropic-key',
  openaiApiKey: 'plaintext-openai-key',
  localApiKey: 'plaintext-local-key',
  localBaseUrl: 'http://inference:11434/v1',
  geminiModelId: 'gemini-2.5-flash',
  openrouterModelId: 'anthropic/claude-3-haiku',
  anthropicModelId: 'claude-sonnet-4-5',
  openaiModelId: 'gpt-5',
  localModelId: 'llama3.2',
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
  enableTotp: true,
  enforceTotp: false,
  totpEnforcedRoleIds: [],
  totpExemptRoleIds: [],
  totpExemptUserIds: [],
  sessionIdleTimeoutMinutes: 30,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  settingsGetMock,
  settingsUpdateMock,
  revokeTokensForUnenrolledEnforcedUsersMock,
  withDbTransactionMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  // Default: viewer with admin perms (allowed to PUT; API keys remain write-only)
  getRolePermissionsMock.mockResolvedValue(['administration.general.update']);
  revokeTokensForUnenrolledEnforcedUsersMock.mockResolvedValue(0);
  withDbTransactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
  logAuditMock.mockImplementation(async () => undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/general-settings');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/general-settings', () => {
  test('200 with administration.general.update masks write-only API keys and reveals MFA exemption user IDs', async () => {
    settingsGetMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      totpExemptUserIds: ['u2'],
    });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/general-settings',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.geminiApiKey).toBe(MASKED_SECRET);
    expect(body.openrouterApiKey).toBe(MASKED_SECRET);
    expect(body.anthropicApiKey).toBe(MASKED_SECRET);
    expect(body.openaiApiKey).toBe(MASKED_SECRET);
    expect(body.localApiKey).toBe(MASKED_SECRET);
    expect(body.localBaseUrl).toBe('http://inference:11434/v1');
    expect(body.totpExemptUserIds).toEqual(['u2']);
  });

  test('200 without admin perm masks API keys', async () => {
    getRolePermissionsMock.mockResolvedValue([]); // no admin perm
    settingsGetMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      totpExemptUserIds: ['u2'],
    });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/general-settings',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.geminiApiKey).toBe(MASKED_SECRET);
    expect(body.openrouterApiKey).toBe(MASKED_SECRET);
    expect(body.anthropicApiKey).toBe(MASKED_SECRET);
    expect(body.openaiApiKey).toBe(MASKED_SECRET);
    expect(body.localApiKey).toBe(MASKED_SECRET);
    expect(body.localBaseUrl).toBe('');
    expect(body).not.toHaveProperty('totpExemptUserIds');
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
    expect(body.sessionIdleTimeoutMinutes).toBe(30);
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
  test('200 round-trip: updates fields, emits audit, response masks API keys', async () => {
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      aiProvider: 'openai',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { aiProvider: 'openai', currency: 'USD' },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ aiProvider: 'openai', currency: 'USD' }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.updated',
        entityType: 'settings',
      }),
    );
    const body = JSON.parse(res.body);
    expect(body.geminiApiKey).toBe(MASKED_SECRET);
  });

  test('200 treats masked API keys as write-only preserve sentinels', async () => {
    settingsGetMock.mockResolvedValue(SETTINGS_WITH_KEYS);
    settingsUpdateMock.mockResolvedValue(SETTINGS_WITH_KEYS);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: {
        currency: 'USD',
        geminiApiKey: MASKED_SECRET,
        openrouterApiKey: MASKED_SECRET,
        anthropicApiKey: MASKED_SECRET,
        openaiApiKey: MASKED_SECRET,
        localApiKey: MASKED_SECRET,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'USD',
        geminiApiKey: undefined,
        openrouterApiKey: undefined,
        anthropicApiKey: undefined,
        openaiApiKey: undefined,
        localApiKey: undefined,
      }),
    );
    expect(JSON.parse(res.body).openaiApiKey).toBe(MASKED_SECRET);
  });

  test('200 enabling 2FA enforcement revokes unenrolled-enforced tokens atomically and audits it', async () => {
    // false -> true transition: pre-existing PAT/MCP tokens of now-enforced users without TOTP must
    // be invalidated, or they keep API privileges until expiry. Interactive sessions are left
    // alone (enforced at next login). The setting write + token revocation must commit in a single
    // transaction.
    settingsGetMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      enableTotp: true,
      enforceTotp: false,
    });
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      enableTotp: true,
      enforceTotp: true,
    });
    revokeTokensForUnenrolledEnforcedUsersMock.mockResolvedValue(3);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { enforceTotp: true },
    });

    expect(res.statusCode).toBe(200);
    expect(revokeTokensForUnenrolledEnforcedUsersMock).toHaveBeenCalledTimes(1);
    // The update + revocation run inside withDbTransaction so a crash can't persist the policy
    // while leaving the stale enforced-user tokens valid.
    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    expect(settingsUpdateMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.totp_enforcement_tokens_revoked',
        entityType: 'settings',
        details: expect.objectContaining({ secondaryLabel: '3' }),
      }),
    );
  });

  test('200 leaving enforcement already-on does not revoke tokens', async () => {
    settingsGetMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      enableTotp: true,
      enforceTotp: true,
    });
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      enableTotp: true,
      enforceTotp: true,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { enforceTotp: true },
    });

    expect(res.statusCode).toBe(200);
    expect(revokeTokensForUnenrolledEnforcedUsersMock).not.toHaveBeenCalled();
  });

  test('200 broadening the enforced role list (enforcement already on) revokes tokens', async () => {
    // Enforcement stays on but the role scope changes — the change-detection (sameIdSet) must
    // notice it and revoke the now-enforced users' tokens, passing the NEW enforced/exempt lists.
    settingsGetMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      enableTotp: true,
      enforceTotp: true,
      totpEnforcedRoleIds: ['admin'],
      totpExemptRoleIds: [],
    });
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      enableTotp: true,
      enforceTotp: true,
      totpEnforcedRoleIds: ['admin', 'manager'],
      totpExemptRoleIds: [],
    });
    revokeTokensForUnenrolledEnforcedUsersMock.mockResolvedValue(2);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { totpEnforcedRoleIds: ['admin', 'manager'] },
    });

    expect(res.statusCode).toBe(200);
    expect(revokeTokensForUnenrolledEnforcedUsersMock).toHaveBeenCalledTimes(1);
    expect(revokeTokensForUnenrolledEnforcedUsersMock).toHaveBeenCalledWith(
      ['admin', 'manager'],
      [],
      [],
      expect.anything(),
    );
  });

  test('200 disabling enforcement does not revoke tokens', async () => {
    settingsGetMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      enableTotp: true,
      enforceTotp: true,
    });
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      enableTotp: true,
      enforceTotp: false,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { enforceTotp: false },
    });

    expect(res.statusCode).toBe(200);
    expect(revokeTokensForUnenrolledEnforcedUsersMock).not.toHaveBeenCalled();
  });

  test('200 round-trips sessionIdleTimeoutMinutes', async () => {
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      sessionIdleTimeoutMinutes: 45,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { sessionIdleTimeoutMinutes: 45 },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionIdleTimeoutMinutes: 45 }),
    );
    expect(JSON.parse(res.body).sessionIdleTimeoutMinutes).toBe(45);
  });

  test('200 re-signs x-auth-token with the saved sessionIdleTimeoutMinutes', async () => {
    const sessionStart = Date.now() - 60_000;
    settingsGetMock.mockResolvedValue({ ...SETTINGS_WITH_KEYS, sessionIdleTimeoutMinutes: 5 });
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      sessionIdleTimeoutMinutes: 45,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: {
        authorization: `Bearer ${signToken({ userId: 'u1', sessionStart, expiresIn: '5m' })}`,
      },
      payload: { sessionIdleTimeoutMinutes: 45 },
    });

    expect(res.statusCode).toBe(200);
    const rotatedToken = res.headers['x-auth-token'];
    expect(typeof rotatedToken).toBe('string');
    const decoded = decodeForAssertion(rotatedToken as string);
    expect(decoded.sessionStart).toBe(sessionStart);
    expect(decoded.sessionMaxExpiresAt).toBeGreaterThan(sessionStart);
    if (typeof decoded.exp !== 'number' || typeof decoded.iat !== 'number') {
      throw new Error('Rotated token is missing exp or iat');
    }
    expect(decoded.exp - decoded.iat).toBe(45 * 60);
  });

  test('400 rejects sessionIdleTimeoutMinutes outside the allowed range', async () => {
    for (const value of [4, 1441]) {
      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/general-settings',
        headers: authHeader(),
        payload: { sessionIdleTimeoutMinutes: value },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/sessionIdleTimeoutMinutes must be an integer/);
    }
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('400 rejects non-integer sessionIdleTimeoutMinutes', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { sessionIdleTimeoutMinutes: 30.5 },
    });

    expect(res.statusCode).toBe(400);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('200 round-trips and deduplicates MFA role/user policy ids', async () => {
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      totpEnforcedRoleIds: ['admin'],
      totpExemptRoleIds: ['viewer'],
      totpExemptUserIds: ['u2', 'u3'],
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: {
        totpEnforcedRoleIds: ['admin'],
        totpExemptRoleIds: ['viewer'],
        totpExemptUserIds: ['u2', 'u2', 'u3'],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        totpEnforcedRoleIds: ['admin'],
        totpExemptRoleIds: ['viewer'],
        totpExemptUserIds: ['u2', 'u3'],
      }),
    );
    const body = JSON.parse(res.body);
    expect(body.totpEnforcedRoleIds).toEqual(['admin']);
    expect(body.totpExemptRoleIds).toEqual(['viewer']);
    expect(body.totpExemptUserIds).toEqual(['u2', 'u3']);
  });

  test('400 rejects overlong MFA user policy ids', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: { totpExemptUserIds: ['u'.repeat(51)] },
    });

    expect(res.statusCode).toBe(400);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
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

  test('200 accepts and normalizes a local provider configuration without an API key', async () => {
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      aiProvider: 'local',
      localApiKey: '',
      localBaseUrl: 'http://inference:11434/v1',
      localModelId: 'llama3.2',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: {
        enableAiReporting: true,
        aiProvider: 'local',
        localApiKey: '',
        localBaseUrl: ' http://inference:11434/v1/ ',
        localModelId: 'llama3.2',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        aiProvider: 'local',
        localApiKey: '',
        localBaseUrl: 'http://inference:11434/v1',
        localModelId: 'llama3.2',
      }),
    );
  });

  test('400 rejects local AI enabled without a base URL', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: {
        enableAiReporting: true,
        aiProvider: 'local',
        localBaseUrl: '',
        localModelId: 'llama3.2',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/localBaseUrl is required/);
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('400 rejects credentials, query strings, and fragments in the local base URL', async () => {
    for (const localBaseUrl of [
      'http://user:pass@inference:11434/v1',
      'http://inference:11434/v1?tenant=x',
      'http://inference:11434/v1#models',
    ]) {
      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/general-settings',
        headers: authHeader(),
        payload: { localBaseUrl },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  test('200 accepts Anthropic provider credentials and model', async () => {
    settingsUpdateMock.mockResolvedValue({
      ...SETTINGS_WITH_KEYS,
      aiProvider: 'anthropic',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/general-settings',
      headers: authHeader(),
      payload: {
        aiProvider: 'anthropic',
        anthropicApiKey: 'sk-ant-test',
        anthropicModelId: 'claude-sonnet-4-5',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        aiProvider: 'anthropic',
        anthropicApiKey: 'sk-ant-test',
        anthropicModelId: 'claude-sonnet-4-5',
      }),
    );
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
