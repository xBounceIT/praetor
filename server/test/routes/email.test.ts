import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realEmailRepo from '../../repositories/emailRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realEmailService from '../../services/email.ts';
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
const emailRepoSnap = { ...realEmailRepo };
const auditSnap = { ...realAudit };
const emailServiceSnap = { ...(realEmailService as Record<string, unknown>) };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const emailRepoGetMock = mock();
const saveConfigMock = mock();
const sendTestEmailMock = mock();
const testConnectionMock = mock();
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
  mock.module('../../repositories/emailRepo.ts', () => ({
    ...emailRepoSnap,
    get: emailRepoGetMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../services/email.ts', () => ({
    default: {
      saveConfig: saveConfigMock,
      sendTestEmail: sendTestEmailMock,
      testConnection: testConnectionMock,
    },
  }));

  routePlugin = (await import('../../routes/email.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/emailRepo.ts', () => emailRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../services/email.ts', () => emailServiceSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'admin',
  avatarInitials: 'AL',
  isDisabled: false,
};

const FULL_PERMS = ['administration.email.view', 'administration.email.update'];

const SAMPLE_CONFIG: realEmailRepo.EmailConfig = {
  enabled: true,
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpEncryption: 'tls',
  smtpRejectUnauthorized: true,
  smtpUser: 'noreply@example.com',
  smtpPassword: 'encrypted-ciphertext',
  fromEmail: 'noreply@example.com',
  fromName: 'Praetor',
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  emailRepoGetMock,
  saveConfigMock,
  sendTestEmailMock,
  testConnectionMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);
  logAuditMock.mockImplementation(async () => undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/email');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/email/config', () => {
  test('200 returns config with masked password when present', async () => {
    emailRepoGetMock.mockResolvedValue(SAMPLE_CONFIG);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/email/config',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.smtpHost).toBe('smtp.example.com');
    expect(body.smtpPassword).toBe(MASKED_SECRET);
  });

  test('200 returns DEFAULT_CONFIG when repo returns null', async () => {
    emailRepoGetMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/email/config',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.enabled).toBe(false);
    expect(body.smtpPort).toBe(587);
    // empty password serializes to '' (not masked)
    expect(body.smtpPassword).toBe('');
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/email/config' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing administration.email.view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/email/config',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/email/config', () => {
  test('200 happy update emits audit, returns masked', async () => {
    saveConfigMock.mockResolvedValue(SAMPLE_CONFIG);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/email/config',
      headers: authHeader(),
      payload: {
        enabled: true,
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpEncryption: 'tls',
        smtpRejectUnauthorized: true,
        smtpUser: 'noreply@example.com',
        smtpPassword: 'plain-password',
        fromEmail: 'noreply@example.com',
        fromName: 'Praetor',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        smtpHost: 'smtp.example.com',
        smtpPassword: 'plain-password',
      }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'email_config.updated',
        entityType: 'email_config',
      }),
    );
    const body = JSON.parse(res.body);
    expect(body.smtpPassword).toBe(MASKED_SECRET);
  });

  test('400 invalid smtpEncryption enum', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/email/config',
      headers: authHeader(),
      payload: { smtpEncryption: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/email/config',
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing administration.email.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.email.view']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/email/config',
      headers: authHeader(),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/email/test', () => {
  test('200 happy: sendTestEmail success', async () => {
    sendTestEmailMock.mockResolvedValue({
      success: true,
      code: 'EMAIL_SENT_SUCCESS',
      messageId: 'msg-1',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/email/test',
      headers: authHeader(),
      payload: { recipientEmail: 'to@example.com' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.code).toBe('EMAIL_SENT_SUCCESS');
    expect(body.messageId).toBe('msg-1');
    expect(sendTestEmailMock).toHaveBeenCalledWith('to@example.com');
  });

  test('400 invalid recipient (missing @)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/email/test',
      headers: authHeader(),
      payload: { recipientEmail: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_RECIPIENT');
    expect(sendTestEmailMock).not.toHaveBeenCalled();
  });

  test('500 when sendTestEmail returns failure', async () => {
    sendTestEmailMock.mockResolvedValue({
      success: false,
      code: 'SMTP_ERROR',
      params: { error: 'connect refused' },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/email/test',
      headers: authHeader(),
      payload: { recipientEmail: 'to@example.com' },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('SMTP_ERROR');
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/email/test',
      payload: { recipientEmail: 'to@example.com' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing administration.email.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/email/test',
      headers: authHeader(),
      payload: { recipientEmail: 'to@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/email/test-connection', () => {
  test('200 happy: testConnection success', async () => {
    testConnectionMock.mockResolvedValue({ success: true, code: 'CONNECTION_SUCCESS' });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/email/test-connection',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.code).toBe('CONNECTION_SUCCESS');
  });

  test('500 when testConnection fails', async () => {
    testConnectionMock.mockResolvedValue({
      success: false,
      code: 'SMTP_ERROR',
      params: { error: 'auth failed' },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/email/test-connection',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('SMTP_ERROR');
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/email/test-connection',
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing administration.email.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/email/test-connection',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});
