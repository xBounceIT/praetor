import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWebhooksRepo from '../../repositories/webhooksRepo.ts';
import * as realWebhooksService from '../../services/webhooks.ts';
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
const webhooksRepoSnap = { ...realWebhooksRepo };
const webhooksServiceSnap = { ...realWebhooksService };
const auditSnap = { ...realAudit };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const listMock = mock();
const findByIdMock = mock();
const deleteByIdMock = mock();
const createWebhookMock = mock();
const updateWebhookMock = mock();
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
  mock.module('../../repositories/webhooksRepo.ts', () => ({
    ...webhooksRepoSnap,
    list: listMock,
    findById: findByIdMock,
    deleteById: deleteByIdMock,
  }));
  mock.module('../../services/webhooks.ts', () => ({
    ...webhooksServiceSnap,
    createWebhook: createWebhookMock,
    updateWebhook: updateWebhookMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));

  routePlugin = (await import('../../routes/webhooks.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/webhooksRepo.ts', () => webhooksRepoSnap);
  mock.module('../../services/webhooks.ts', () => webhooksServiceSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
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

const FULL_PERMS = [
  'administration.webhooks.view',
  'administration.webhooks.create',
  'administration.webhooks.update',
  'administration.webhooks.delete',
];

const SAMPLE_WEBHOOK: realWebhooksRepo.Webhook = {
  id: 'webhook-1',
  name: 'Slack',
  description: 'Notify channel',
  url: 'https://hooks.slack.com/services/abc',
  httpMethod: 'POST',
  authType: 'bearer',
  authUsername: '',
  authHeaderName: '',
  authSecret: 'enc:ciphertext',
  customHeaders: [],
  enabled: true,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listMock,
  findByIdMock,
  deleteByIdMock,
  createWebhookMock,
  updateWebhookMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);
  logAuditMock.mockImplementation(async () => undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/webhooks');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/webhooks', () => {
  test('200 lists webhooks with the secret masked', async () => {
    listMock.mockResolvedValue([SAMPLE_WEBHOOK]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/webhooks',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].url).toBe(SAMPLE_WEBHOOK.url);
    expect(body[0].authSecret).toBe(MASKED_SECRET);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/webhooks' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing administration.webhooks.view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/webhooks',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/webhooks/:id', () => {
  test('200 returns the masked webhook', async () => {
    findByIdMock.mockResolvedValue(SAMPLE_WEBHOOK);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/webhooks/webhook-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).authSecret).toBe(MASKED_SECRET);
  });

  test('404 when the webhook does not exist', async () => {
    findByIdMock.mockResolvedValue(null);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/webhooks/missing',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/webhooks', () => {
  test('201 creates, emits an audit row and returns masked', async () => {
    createWebhookMock.mockResolvedValue(SAMPLE_WEBHOOK);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/webhooks',
      headers: authHeader(),
      payload: {
        name: 'Slack',
        url: 'https://hooks.slack.com/services/abc',
        httpMethod: 'POST',
        authType: 'bearer',
        authSecret: 'plain-token',
        enabled: true,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createWebhookMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Slack', authType: 'bearer', authSecret: 'plain-token' }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.created', entityType: 'webhook' }),
    );
    expect(JSON.parse(res.body).authSecret).toBe(MASKED_SECRET);
  });

  test('400 when the URL is not http(s)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/webhooks',
      headers: authHeader(),
      payload: { name: 'Bad', url: 'ftp://example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(createWebhookMock).not.toHaveBeenCalled();
  });

  test('400 when name is missing', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/webhooks',
      headers: authHeader(),
      payload: { url: 'https://example.com/hook' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 when authType is api_key without a header name', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/webhooks',
      headers: authHeader(),
      payload: { name: 'K', url: 'https://example.com/hook', authType: 'api_key' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 when authType is not a known enum', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/webhooks',
      headers: authHeader(),
      payload: { name: 'K', url: 'https://example.com/hook', authType: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 (not 500) when the url exceeds the column length', async () => {
    // Regression: without a maxLength guard an over-length value overflows varchar(2000) at the DB
    // and surfaces as a 500 instead of a clean 400.
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/webhooks',
      headers: authHeader(),
      payload: { name: 'Long', url: `https://example.com/${'a'.repeat(2000)}` },
    });
    expect(res.statusCode).toBe(400);
    expect(createWebhookMock).not.toHaveBeenCalled();
  });

  test('400 when the name exceeds the column length', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/webhooks',
      headers: authHeader(),
      payload: { name: 'n'.repeat(256), url: 'https://example.com/hook' },
    });
    expect(res.statusCode).toBe(400);
    expect(createWebhookMock).not.toHaveBeenCalled();
  });

  test('403 missing administration.webhooks.create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.webhooks.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/webhooks',
      headers: authHeader(),
      payload: { name: 'X', url: 'https://example.com/hook' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/webhooks/:id', () => {
  test('200 updates, emits an audit row and returns masked', async () => {
    updateWebhookMock.mockResolvedValue(SAMPLE_WEBHOOK);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/webhooks/webhook-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateWebhookMock).toHaveBeenCalledWith(
      'webhook-1',
      expect.objectContaining({ name: 'Renamed' }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.updated', entityType: 'webhook' }),
    );
    expect(JSON.parse(res.body).authSecret).toBe(MASKED_SECRET);
  });

  test('200 allows a partial api_key update that omits authHeaderName', async () => {
    // Regression (Codex PR review): a partial PUT that echoes authType:'api_key' while changing
    // another field must not be forced to resend authHeaderName — the service preserves the stored
    // header. The route only requires the header on create.
    updateWebhookMock.mockResolvedValue(SAMPLE_WEBHOOK);
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/webhooks/webhook-1',
      headers: authHeader(),
      payload: { authType: 'api_key', enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(updateWebhookMock).toHaveBeenCalledWith(
      'webhook-1',
      expect.objectContaining({ authType: 'api_key', enabled: false }),
    );
  });

  test('404 when the service reports the webhook is missing', async () => {
    updateWebhookMock.mockResolvedValue(null);
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/webhooks/missing',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(404);
  });

  test('403 missing administration.webhooks.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.webhooks.view']);
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/webhooks/webhook-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /api/webhooks/:id', () => {
  test('204 deletes and emits an audit row', async () => {
    deleteByIdMock.mockResolvedValue(true);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/webhooks/webhook-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(204);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.deleted', entityType: 'webhook' }),
    );
  });

  test('404 when nothing was deleted', async () => {
    deleteByIdMock.mockResolvedValue(false);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/webhooks/missing',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  test('403 missing administration.webhooks.delete permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.webhooks.view']);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/webhooks/webhook-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('OpenAPI spec (generated /docs/api)', () => {
  // Codex PR review: create requires name + url, but PUT is a partial patch. The generated OpenAPI
  // request bodies must reflect that — otherwise a client generated from /docs/api submits a
  // name/url-less create body that is documented as valid but always 400s.
  type SpecOp = {
    requestBody?: { content?: Record<string, { schema?: { required?: string[] } }> };
  };
  type Spec = { paths?: Record<string, Record<string, SpecOp>> };
  let spec: Spec;

  beforeAll(async () => {
    const { default: swagger } = await import('@fastify/swagger');
    const app = Fastify({ logger: false });
    app.decorate('rateLimit', () => async () => {});
    await app.register(swagger, { openapi: { info: { title: 'test', version: '1.0.0' } } });
    await app.register(routePlugin, { prefix: '/api/webhooks' });
    await app.ready();
    spec = app.swagger() as unknown as Spec;
    await app.close();
  });

  const bodyRequired = (path: string, method: string): string[] =>
    spec.paths?.[path]?.[method]?.requestBody?.content?.['application/json']?.schema?.required ??
    [];

  test('POST marks name and url required', () => {
    expect(bodyRequired('/api/webhooks/', 'post')).toEqual(expect.arrayContaining(['name', 'url']));
  });

  test('PUT (partial update) requires neither name nor url', () => {
    const required = bodyRequired('/api/webhooks/{id}', 'put');
    expect(required).not.toContain('name');
    expect(required).not.toContain('url');
  });
});
