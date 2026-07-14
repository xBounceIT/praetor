import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
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

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const getGeneralSettingsMock = mock();

let routePlugin: FastifyPluginAsync;
let originalFetch: typeof fetch;
const fetchMock = mock();

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
    get: getGeneralSettingsMock,
  }));

  routePlugin = (await import('../../routes/ai.ts')).default as FastifyPluginAsync;

  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/generalSettingsRepo.ts', () => generalSettingsRepoSnap);
  globalThis.fetch = originalFetch;
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Admin',
  username: 'admin',
  role: 'admin',
  avatarInitials: 'AD',
  isDisabled: false,
  sessionVersion: 1,
};

const ADMIN_PERMS = ['administration.general.update'];

let testApp: FastifyInstance;

beforeEach(async () => {
  findAuthUserByIdMock.mockReset();
  userHasRoleMock.mockReset();
  getRolePermissionsMock.mockReset();
  getGeneralSettingsMock.mockReset();
  fetchMock.mockReset();

  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(ADMIN_PERMS);
  getGeneralSettingsMock.mockResolvedValue({
    geminiApiKey: 'test-gemini-key',
    openrouterApiKey: 'test-openrouter-key',
    anthropicApiKey: 'test-anthropic-key',
  });

  testApp = await buildRouteTestApp(routePlugin, '/api/ai');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

const okResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

describe('POST /api/ai/validate-model', () => {
  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      payload: { provider: 'gemini', modelId: 'gemini-pro' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing administration.general.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'gemini', modelId: 'gemini-pro' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('400 invalid provider', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'unknown', modelId: 'gemini-pro' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 modelId missing', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'gemini', modelId: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('200 ok=false MISSING_API_KEY when no key in body or settings', async () => {
    getGeneralSettingsMock.mockResolvedValue({
      geminiApiKey: '',
      openrouterApiKey: '',
      anthropicApiKey: '',
    });
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'gemini', modelId: 'gemini-pro' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('MISSING_API_KEY');
  });

  test('200 ok=true gemini happy path', async () => {
    fetchMock.mockResolvedValue(okResponse({}, 200));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'gemini', modelId: 'gemini-pro', apiKey: 'inline-key' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.normalizedModelId).toMatch(/gemini-pro/);
    expect(fetchMock).toHaveBeenCalled();
  });

  test('200 ok=false NOT_FOUND for gemini 404', async () => {
    fetchMock.mockResolvedValue(okResponse({}, 404));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'gemini', modelId: 'gemini-pro', apiKey: 'inline-key' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('NOT_FOUND');
  });

  test('200 ok=false PROVIDER_ERROR when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'gemini', modelId: 'gemini-pro', apiKey: 'inline-key' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('PROVIDER_ERROR');
    expect(body.message).toMatch(/network down/);
  });

  test('200 ok=true openrouter happy path', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ data: [{ id: 'openai/gpt-4o', name: 'GPT-4o' }] }, 200),
    );
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'openrouter', modelId: 'openai/gpt-4o', apiKey: 'inline-key' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.normalizedModelId).toBe('openai/gpt-4o');
    expect(body.name).toBe('GPT-4o');
  });

  test('200 ok=false NOT_FOUND for openrouter when model not in list', async () => {
    fetchMock.mockResolvedValue(okResponse({ data: [{ id: 'other/model' }] }, 200));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'openrouter', modelId: 'openai/gpt-4o', apiKey: 'inline-key' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('NOT_FOUND');
  });

  test('200 ok=false PROVIDER_ERROR when openrouter list fails', async () => {
    fetchMock.mockResolvedValue(okResponse({}, 500));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'openrouter', modelId: 'openai/gpt-4o', apiKey: 'inline-key' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('PROVIDER_ERROR');
  });

  test('200 ok=true uses gemini key from settings when apiKey omitted', async () => {
    fetchMock.mockResolvedValue(okResponse({}, 200));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'gemini', modelId: 'gemini-pro' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    const fetchCall = (fetchMock.mock.calls[0] as unknown[])[0];
    const url = fetchCall instanceof URL ? fetchCall : new URL(String(fetchCall));
    expect(url.searchParams.get('key')).toBe('test-gemini-key');
  });

  test('200 ok=true anthropic happy path', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }, 200),
    );
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'inline-key',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      normalizedModelId: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
    });
    const [url, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe('/v1/models/claude-sonnet-4-5');
    expect(options.headers).toEqual(
      expect.objectContaining({
        'x-api-key': 'inline-key',
        'anthropic-version': '2023-06-01',
      }),
    );
  });

  test('200 ok=false NOT_FOUND for anthropic 404', async () => {
    fetchMock.mockResolvedValue(okResponse({}, 404));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: {
        provider: 'anthropic',
        modelId: 'claude-missing',
        apiKey: 'inline-key',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).code).toBe('NOT_FOUND');
  });
});
