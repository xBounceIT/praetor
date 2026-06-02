import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Readable } from 'node:stream';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import * as realBrandingRepo from '../../repositories/brandingRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import { ajvFormatsPlugin, ajvFormatsPluginOptions } from '../../utils/ajv-formats.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realFileStorage from '../../utils/fileStorage.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { signToken } from '../helpers/jwt.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const brandingRepoSnap = { ...realBrandingRepo };
const fileStorageSnap = { ...realFileStorage };
const auditSnap = { ...realAudit };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const getMock = mock();
const setCompanyNameMock = mock();
const setLogoMock = mock();
const clearLogoMock = mock();
const isAllowedBrandingImageMock = mock();
const saveBrandingLogoMock = mock();
const openBrandingLogoMock = mock();
const deleteBrandingLogoMock = mock();
const logAuditMock = mock(async () => undefined);

// Small limit so the 413 path is exercisable with a tiny payload.
const TEST_MAX_BYTES = 64;

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
  mock.module('../../repositories/brandingRepo.ts', () => ({
    ...brandingRepoSnap,
    get: getMock,
    setCompanyName: setCompanyNameMock,
    setLogo: setLogoMock,
    clearLogo: clearLogoMock,
  }));
  mock.module('../../utils/fileStorage.ts', () => ({
    ...fileStorageSnap,
    BRANDING_LOGO_MAX_BYTES: TEST_MAX_BYTES,
    isAllowedBrandingImage: isAllowedBrandingImageMock,
    saveBrandingLogo: saveBrandingLogoMock,
    openBrandingLogo: openBrandingLogoMock,
    deleteBrandingLogo: deleteBrandingLogoMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));

  routePlugin = (await import('../../routes/branding.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/brandingRepo.ts', () => brandingRepoSnap);
  mock.module('../../utils/fileStorage.ts', () => fileStorageSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
});

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  getMock,
  setCompanyNameMock,
  setLogoMock,
  clearLogoMock,
  isAllowedBrandingImageMock,
  saveBrandingLogoMock,
  openBrandingLogoMock,
  deleteBrandingLogoMock,
  logAuditMock,
];

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

let testApp: FastifyInstance;

const buildApp = async (fileSizeLimit = 10 * 1024 * 1024): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false,
    ajv: { customOptions: {}, plugins: [[ajvFormatsPlugin, ajvFormatsPluginOptions]] },
  });
  app.decorate('rateLimit', () => async () => {});
  await app.register(multipart, { limits: { fileSize: fileSizeLimit, files: 1, fields: 0 } });
  await app.register(routePlugin, { prefix: '/api/branding' });
  await app.ready();
  return app;
};

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(['administration.general.update']);
  logAuditMock.mockImplementation(async () => undefined);
  testApp = await buildApp();
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

const multipartBody = (filename: string, contentType: string, content: string) => {
  const boundary = '----brandingtestboundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
};

describe('GET /api/branding (public)', () => {
  test('200 with defaults when no row exists, without a token', async () => {
    getMock.mockResolvedValue(null);

    const res = await testApp.inject({ method: 'GET', url: '/api/branding' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      companyName: null,
      hasLogo: false,
      logoUpdatedAt: null,
    });
  });

  test('200 reflects stored name + logo presence with ISO timestamp', async () => {
    const when = new Date('2026-01-02T03:04:05.000Z');
    getMock.mockResolvedValue({
      companyName: 'Acme',
      logoStoredName: 'abc.png',
      logoMimeType: 'image/png',
      logoFileSize: 1234,
      logoUpdatedAt: when,
    });

    const res = await testApp.inject({ method: 'GET', url: '/api/branding' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      companyName: 'Acme',
      hasLogo: true,
      logoUpdatedAt: '2026-01-02T03:04:05.000Z',
    });
  });
});

describe('GET /api/branding/logo (public)', () => {
  test('404 when no logo is set', async () => {
    getMock.mockResolvedValue(null);

    const res = await testApp.inject({ method: 'GET', url: '/api/branding/logo' });

    expect(res.statusCode).toBe(404);
    expect(openBrandingLogoMock).not.toHaveBeenCalled();
  });

  test('200 streams the logo with the stored mime and hardening headers', async () => {
    getMock.mockResolvedValue({
      companyName: null,
      logoStoredName: 'abc.svg',
      logoMimeType: 'image/svg+xml',
      logoFileSize: 3,
      logoUpdatedAt: new Date(),
    });
    openBrandingLogoMock.mockResolvedValue({
      stream: Readable.from([Buffer.from('img')]),
      size: 3,
    });

    const res = await testApp.inject({ method: 'GET', url: '/api/branding/logo' });

    expect(res.statusCode).toBe(200);
    expect(openBrandingLogoMock).toHaveBeenCalledWith('abc.svg');
    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  test('404 when the stored file is missing on disk', async () => {
    getMock.mockResolvedValue({
      companyName: null,
      logoStoredName: 'gone.png',
      logoMimeType: 'image/png',
      logoFileSize: 3,
      logoUpdatedAt: new Date(),
    });
    openBrandingLogoMock.mockRejectedValue(new Error('ENOENT'));

    const res = await testApp.inject({ method: 'GET', url: '/api/branding/logo' });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/branding', () => {
  test('401 without a token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/branding',
      payload: { companyName: 'Acme' },
    });
    expect(res.statusCode).toBe(401);
    expect(setCompanyNameMock).not.toHaveBeenCalled();
  });

  test('403 without administration.general.update', async () => {
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/branding',
      headers: authHeader(),
      payload: { companyName: 'Acme' },
    });

    expect(res.statusCode).toBe(403);
    expect(setCompanyNameMock).not.toHaveBeenCalled();
  });

  test('200 trims the name, emits an audit log', async () => {
    setCompanyNameMock.mockResolvedValue({
      companyName: 'Acme',
      logoStoredName: null,
      logoMimeType: null,
      logoFileSize: null,
      logoUpdatedAt: null,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/branding',
      headers: authHeader(),
      payload: { companyName: '  Acme  ' },
    });

    expect(res.statusCode).toBe(200);
    expect(setCompanyNameMock).toHaveBeenCalledWith('Acme');
    expect(JSON.parse(res.body)).toEqual({
      companyName: 'Acme',
      hasLogo: false,
      logoUpdatedAt: null,
    });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'branding.updated', entityType: 'app_branding' }),
    );
  });

  test('200 stores null when the name is blank', async () => {
    setCompanyNameMock.mockResolvedValue({
      companyName: null,
      logoStoredName: null,
      logoMimeType: null,
      logoFileSize: null,
      logoUpdatedAt: null,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/branding',
      headers: authHeader(),
      payload: { companyName: '   ' },
    });

    expect(res.statusCode).toBe(200);
    expect(setCompanyNameMock).toHaveBeenCalledWith(null);
  });
});

describe('POST /api/branding/logo', () => {
  test('403 without administration.general.update', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const { body, headers } = multipartBody('logo.png', 'image/png', 'img');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/branding/logo',
      headers: { ...authHeader(), ...headers },
      payload: body,
    });

    expect(res.statusCode).toBe(403);
    expect(saveBrandingLogoMock).not.toHaveBeenCalled();
  });

  test('400 when the request is not multipart', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/branding/logo',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: JSON.stringify({ not: 'a file' }),
    });

    expect(res.statusCode).toBe(400);
    expect(saveBrandingLogoMock).not.toHaveBeenCalled();
  });

  test('400 for a disallowed image type', async () => {
    isAllowedBrandingImageMock.mockReturnValue(false);
    const { body, headers } = multipartBody('malware.exe', 'application/octet-stream', 'data');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/branding/logo',
      headers: { ...authHeader(), ...headers },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(saveBrandingLogoMock).not.toHaveBeenCalled();
  });

  test('413 when the file exceeds the size limit', async () => {
    isAllowedBrandingImageMock.mockReturnValue(true);
    const { body, headers } = multipartBody(
      'logo.png',
      'image/png',
      'a'.repeat(TEST_MAX_BYTES + 1),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/branding/logo',
      headers: { ...authHeader(), ...headers },
      payload: body,
    });

    expect(res.statusCode).toBe(413);
    expect(saveBrandingLogoMock).not.toHaveBeenCalled();
  });

  test('413 when the multipart stream itself exceeds the limit (FST_REQ_FILE_TOO_LARGE)', async () => {
    // Drives the part.toBuffer() abort branch rather than the manual byteLength guard: the
    // plugin aborts the stream at its own fileSize limit before the body fully materializes.
    isAllowedBrandingImageMock.mockReturnValue(true);
    const smallApp = await buildApp(64);
    try {
      const { body, headers } = multipartBody('logo.png', 'image/png', 'a'.repeat(2048));
      const res = await smallApp.inject({
        method: 'POST',
        url: '/api/branding/logo',
        headers: { ...authHeader(), ...headers },
        payload: body,
      });

      expect(res.statusCode).toBe(413);
      expect(saveBrandingLogoMock).not.toHaveBeenCalled();
    } finally {
      await smallApp.close();
    }
  });

  test('400 for an empty (0-byte) file', async () => {
    isAllowedBrandingImageMock.mockReturnValue(true);
    const { body, headers } = multipartBody('logo.png', 'image/png', '');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/branding/logo',
      headers: { ...authHeader(), ...headers },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(saveBrandingLogoMock).not.toHaveBeenCalled();
  });

  test('removes the just-saved file when the DB write fails (no orphan left behind)', async () => {
    isAllowedBrandingImageMock.mockReturnValue(true);
    getMock.mockResolvedValue(null);
    saveBrandingLogoMock.mockResolvedValue({
      storedName: 'new.png',
      size: 3,
      mimeType: 'image/png',
    });
    setLogoMock.mockRejectedValue(new Error('db down'));
    deleteBrandingLogoMock.mockResolvedValue(undefined);

    const { body, headers } = multipartBody('logo.png', 'image/png', 'img');
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/branding/logo',
      headers: { ...authHeader(), ...headers },
      payload: body,
    });

    expect(res.statusCode).toBe(500);
    expect(saveBrandingLogoMock).toHaveBeenCalled();
    expect(deleteBrandingLogoMock).toHaveBeenCalledWith('new.png');
  });

  test('200 saves the new logo, removes the superseded file, emits an audit log', async () => {
    isAllowedBrandingImageMock.mockReturnValue(true);
    getMock.mockResolvedValue({
      companyName: null,
      logoStoredName: 'old.png',
      logoMimeType: 'image/png',
      logoFileSize: 10,
      logoUpdatedAt: new Date(),
    });
    saveBrandingLogoMock.mockResolvedValue({
      storedName: 'new.png',
      size: 3,
      mimeType: 'image/png',
    });
    setLogoMock.mockResolvedValue({
      companyName: null,
      logoStoredName: 'new.png',
      logoMimeType: 'image/png',
      logoFileSize: 3,
      logoUpdatedAt: new Date('2026-02-02T00:00:00.000Z'),
    });
    deleteBrandingLogoMock.mockResolvedValue(undefined);

    const { body, headers } = multipartBody('logo.png', 'image/png', 'img');
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/branding/logo',
      headers: { ...authHeader(), ...headers },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(saveBrandingLogoMock).toHaveBeenCalled();
    expect(setLogoMock).toHaveBeenCalledWith({
      storedName: 'new.png',
      mimeType: 'image/png',
      fileSize: 3,
    });
    expect(deleteBrandingLogoMock).toHaveBeenCalledWith('old.png');
    expect(JSON.parse(res.body)).toEqual({
      companyName: null,
      hasLogo: true,
      logoUpdatedAt: '2026-02-02T00:00:00.000Z',
    });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'branding.logo.updated', entityType: 'app_branding' }),
    );
  });
});

describe('DELETE /api/branding/logo', () => {
  test('403 without administration.general.update', async () => {
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/branding/logo',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(clearLogoMock).not.toHaveBeenCalled();
  });

  test('200 clears the row and removes the file', async () => {
    getMock.mockResolvedValue({
      companyName: 'Acme',
      logoStoredName: 'old.png',
      logoMimeType: 'image/png',
      logoFileSize: 10,
      logoUpdatedAt: new Date(),
    });
    clearLogoMock.mockResolvedValue({
      companyName: 'Acme',
      logoStoredName: null,
      logoMimeType: null,
      logoFileSize: null,
      logoUpdatedAt: null,
    });
    deleteBrandingLogoMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/branding/logo',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(clearLogoMock).toHaveBeenCalled();
    expect(deleteBrandingLogoMock).toHaveBeenCalledWith('old.png');
    expect(JSON.parse(res.body)).toEqual({
      companyName: 'Acme',
      hasLogo: false,
      logoUpdatedAt: null,
    });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'branding.logo.removed', entityType: 'app_branding' }),
    );
  });
});
