import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realLocalAiEndpoint from '../../utils/local-ai-endpoint.ts';
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
const localAiEndpointSnap = { ...realLocalAiEndpoint };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const getGeneralSettingsMock = mock();

let routePlugin: FastifyPluginAsync;
let originalFetch: typeof fetch;
const fetchMock = mock();
const localAiFetchMock = mock(async (input: string | URL, init?: RequestInit) => {
  await localAiEndpointSnap.assertSafeLocalAiBaseUrl(String(input));
  return fetchMock(input, init);
});

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
    getWithAiApiKey: getGeneralSettingsMock,
  }));
  mock.module('../../utils/local-ai-endpoint.ts', () => ({
    ...localAiEndpointSnap,
    fetchLocalAi: localAiFetchMock,
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
  mock.module('../../utils/local-ai-endpoint.ts', () => localAiEndpointSnap);
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
  localAiFetchMock.mockClear();

  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(ADMIN_PERMS);
  getGeneralSettingsMock.mockResolvedValue({
    geminiApiKey: 'test-gemini-key',
    openrouterApiKey: 'test-openrouter-key',
    anthropicApiKey: 'test-anthropic-key',
    openaiApiKey: 'test-openai-key',
    localApiKey: 'test-local-key',
    localBaseUrl: 'http://127.0.0.1:11434/v1',
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
      openaiApiKey: '',
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

  test('200 ok=true openai happy path', async () => {
    fetchMock.mockResolvedValue(okResponse({ id: 'gpt-test', object: 'model' }, 200));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'openai', modelId: 'gpt-test', apiKey: 'inline-key' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({ ok: true, normalizedModelId: 'gpt-test' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models/gpt-test',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer inline-key' },
      }),
    );
  });

  test('200 ok=false NOT_FOUND for openai 404', async () => {
    fetchMock.mockResolvedValue(okResponse({}, 404));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'openai', modelId: 'gpt-missing', apiKey: 'inline-key' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({ ok: false, code: 'NOT_FOUND' }));
  });

  test('uses the saved openai key when apiKey is omitted', async () => {
    fetchMock.mockResolvedValue(okResponse({ id: 'gpt-test' }, 200));
    await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'openai', modelId: 'gpt-test' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models/gpt-test',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-openai-key' } }),
    );
    expect(getGeneralSettingsMock).toHaveBeenCalledWith('openai');
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

  test('200 ok=true validates a local model without requiring an API key', async () => {
    fetchMock.mockResolvedValue(okResponse({ data: [{ id: 'llama3.2', name: 'Llama 3.2' }] }, 200));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: {
        provider: 'local',
        modelId: 'llama3.2',
        apiKey: '',
        baseUrl: 'http://127.0.0.1:11434/v1/',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      normalizedModelId: 'llama3.2',
      name: 'Llama 3.2',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
      }),
    );
  });

  test('uses saved local endpoint and Bearer token when inline values are omitted', async () => {
    fetchMock.mockResolvedValue(okResponse({ data: [{ id: 'llama3.2' }] }, 200));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: { provider: 'local', modelId: 'llama3.2' },
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-local-key' }),
      }),
    );
  });

  test('returns NOT_FOUND when a local model is absent from the model list', async () => {
    fetchMock.mockResolvedValue(okResponse({ data: [{ id: 'other-model' }] }, 200));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: {
        provider: 'local',
        modelId: 'llama3.2',
        baseUrl: 'http://127.0.0.1:11434/v1',
      },
    });
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({ ok: false, code: 'NOT_FOUND' }));
  });

  test('blocks link-local metadata destinations before fetch', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: {
        provider: 'local',
        modelId: 'llama3.2',
        baseUrl: 'http://169.254.169.254/v1',
      },
    });
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({ ok: false, code: 'PROVIDER_ERROR' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does not expose the configured local hostname through provider errors', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND inference.internal'));
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/ai/validate-model',
      headers: authHeader(),
      payload: {
        provider: 'local',
        modelId: 'llama3.2',
        baseUrl: 'http://127.0.0.1:11434/v1',
      },
    });

    expect(JSON.parse(res.body)).toEqual({
      ok: false,
      code: 'PROVIDER_ERROR',
      message: 'Unable to verify model with the Local AI endpoint.',
    });
    expect(res.body).not.toContain('inference.internal');
  });
});
