import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realChannelsRepo from '../../repositories/quoteCommunicationChannelsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
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
const channelsRepoSnap = { ...realChannelsRepo };
const auditSnap = { ...realAudit };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const listAllWithCountsMock = mock();
const findByIdMock = mock();
const existsByNameMock = mock();
const createMock = mock();
const updateMock = mock();
const countAllMock = mock();
const countReferencesMock = mock();
const deleteByIdMock = mock();
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
  mock.module('../../repositories/quoteCommunicationChannelsRepo.ts', () => ({
    ...channelsRepoSnap,
    listAllWithCounts: listAllWithCountsMock,
    findById: findByIdMock,
    existsByName: existsByNameMock,
    create: createMock,
    update: updateMock,
    countAll: countAllMock,
    countReferences: countReferencesMock,
    deleteById: deleteByIdMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));

  routePlugin = (await import('../../routes/quote-communication-channels.ts'))
    .default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/quoteCommunicationChannelsRepo.ts', () => channelsRepoSnap);
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

const FULL_PERMS = [
  'sales.client_quotes.view',
  'sales.client_quotes.create',
  'sales.client_quotes.update',
  'sales.client_quotes.delete',
];

const CHANNEL = {
  id: 'qcc_email',
  name: 'Email',
  icon: 'envelope',
  isDefault: false,
  createdAt: 1,
  updatedAt: 2,
  clientQuoteCount: 1,
  supplierQuoteCount: 2,
  totalQuoteCount: 3,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllWithCountsMock,
  findByIdMock,
  existsByNameMock,
  createMock,
  updateMock,
  countAllMock,
  countReferencesMock,
  deleteByIdMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);
  listAllWithCountsMock.mockResolvedValue([CHANNEL]);
  findByIdMock.mockResolvedValue(CHANNEL);
  existsByNameMock.mockResolvedValue(false);
  createMock.mockResolvedValue({
    ...CHANNEL,
    id: 'qcc_new',
    name: 'PEC',
    icon: 'comments',
    totalQuoteCount: 0,
  });
  updateMock.mockResolvedValue({ ...CHANNEL, name: 'PEC', icon: 'video' });
  countAllMock.mockResolvedValue(2);
  countReferencesMock.mockResolvedValue({
    clientQuoteCount: 0,
    supplierQuoteCount: 0,
    totalQuoteCount: 0,
  });
  deleteByIdMock.mockResolvedValue(true);
  logAuditMock.mockImplementation(async () => undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/quote-communication-channels');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('/api/sales/quote-communication-channels', () => {
  test('GET lists channels with usage counts', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/quote-communication-channels',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([CHANNEL]);
  });

  test('POST creates a channel', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/quote-communication-channels',
      headers: authHeader(),
      payload: { name: 'PEC' },
    });

    expect(res.statusCode).toBe(201);
    expect(String(createMock.mock.calls[0]?.[0]).startsWith('qcc-')).toBe(true);
    expect(createMock.mock.calls[0]?.[1]).toBe('PEC');
    expect(createMock.mock.calls[0]?.[2]).toBe('comments');
  });

  test('POST rejects duplicate names', async () => {
    existsByNameMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/quote-communication-channels',
      headers: authHeader(),
      payload: { name: 'Email' },
    });

    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('POST rejects icons outside the supported set', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/quote-communication-channels',
      headers: authHeader(),
      payload: { name: 'Carrier pigeon', icon: 'bird' },
    });

    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('PUT updates a channel and returns refreshed counts', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/quote-communication-channels/qcc_email',
      headers: authHeader(),
      payload: { name: 'PEC', icon: 'video' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('qcc_email', 'PEC', 'video');
    expect(listAllWithCountsMock).toHaveBeenCalled();
  });

  test('PUT preserves the current icon when older clients omit it', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/quote-communication-channels/qcc_email',
      headers: authHeader(),
      payload: { name: 'PEC' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('qcc_email', 'PEC', 'envelope');
  });

  test('PUT blocks changes to default channels', async () => {
    findByIdMock.mockResolvedValue({ ...CHANNEL, isDefault: true });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/quote-communication-channels/qcc_email',
      headers: authHeader(),
      payload: { name: 'Renamed', icon: 'video' },
    });

    expect(res.statusCode).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('DELETE removes an unused channel', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/quote-communication-channels/qcc_email',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteByIdMock).toHaveBeenCalledWith('qcc_email');
  });

  test('DELETE blocks default channels', async () => {
    findByIdMock.mockResolvedValue({ ...CHANNEL, isDefault: true });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/quote-communication-channels/qcc_email',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });

  test('DELETE returns not found when the channel disappears before deletion', async () => {
    deleteByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/quote-communication-channels/qcc_email',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote_communication_channel.delete.not_found' }),
    );
  });

  test('DELETE blocks the last remaining channel', async () => {
    countAllMock.mockResolvedValue(1);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/quote-communication-channels/qcc_email',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });

  test('DELETE blocks channels referenced by quotes', async () => {
    countReferencesMock.mockResolvedValue({
      clientQuoteCount: 1,
      supplierQuoteCount: 0,
      totalQuoteCount: 1,
    });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/quote-communication-channels/qcc_email',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });
});
