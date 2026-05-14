import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyReply, FastifyRequest } from 'fastify';
import * as realMcpTokensRepo from '../../repositories/mcpTokensRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realPermissions from '../../utils/permissions.ts';

const mcpTokensRepoSnap = { ...realMcpTokensRepo };
const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };

const findActiveByRawTokenMock = mock();
const touchLastUsedMock = mock();
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

let authenticateMcpToken: typeof import('../../middleware/mcpAuth.ts').authenticateMcpToken;
let __resetMcpIdleTimeoutCacheForTests: typeof import('../../middleware/mcpAuth.ts').__resetMcpIdleTimeoutCacheForTests;

beforeAll(async () => {
  mock.module('../../repositories/mcpTokensRepo.ts', () => ({
    ...mcpTokensRepoSnap,
    MCP_TOKEN_PREFIX: 'praetor_mcp_',
    findActiveByRawToken: findActiveByRawTokenMock,
    touchLastUsed: touchLastUsedMock,
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

  const mod = await import('../../middleware/mcpAuth.ts');
  authenticateMcpToken = mod.authenticateMcpToken;
  __resetMcpIdleTimeoutCacheForTests = mod.__resetMcpIdleTimeoutCacheForTests;
});

afterAll(() => {
  mock.module('../../repositories/mcpTokensRepo.ts', () => mcpTokensRepoSnap);
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
});

const makeReply = () => {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    code(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return reply as FastifyReply & typeof reply;
};

const makeRequest = (token?: string) =>
  ({
    headers: token ? { authorization: `Bearer ${token}` } : {},
    raw: {},
  }) as FastifyRequest & { raw: { auth?: unknown } };

beforeEach(() => {
  for (const m of [
    findActiveByRawTokenMock,
    touchLastUsedMock,
    findAuthUserByIdMock,
    userHasRoleMock,
    getRolePermissionsMock,
  ]) {
    m.mockReset();
  }
  findActiveByRawTokenMock.mockResolvedValue({
    id: 'mcp-token-1',
    userId: 'u1',
    name: 'Agent',
    scope: 'full',
    createdAt: new Date(),
    lastUsedAt: null,
  });
  findAuthUserByIdMock.mockResolvedValue({
    id: 'u1',
    name: 'Alice',
    username: 'alice',
    role: 'manager',
    avatarInitials: 'AL',
    isDisabled: false,
  });
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(['timesheets.tracker.view']);
  touchLastUsedMock.mockResolvedValue(undefined);
  delete process.env.MCP_IDLE_TIMEOUT_MS;
  __resetMcpIdleTimeoutCacheForTests();
});

describe('authenticateMcpToken', () => {
  test('401 when token is missing', async () => {
    const request = makeRequest();
    const reply = makeReply();

    await authenticateMcpToken(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'MCP token required' });
  });

  test('403 when token is unknown or revoked', async () => {
    findActiveByRawTokenMock.mockResolvedValue(null);
    const request = makeRequest('praetor_mcp_unknown');
    const reply = makeReply();

    await authenticateMcpToken(request, reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Invalid or revoked MCP token' });
  });

  test('403 when mapped user is disabled', async () => {
    findAuthUserByIdMock.mockResolvedValue({
      id: 'u1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      avatarInitials: 'AL',
      isDisabled: true,
    });
    const request = makeRequest('praetor_mcp_token');
    const reply = makeReply();

    await authenticateMcpToken(request, reply);

    expect(reply.statusCode).toBe(403);
  });

  test('populates request user and MCP raw auth on success', async () => {
    const request = makeRequest('praetor_mcp_token');
    const reply = makeReply();

    await authenticateMcpToken(request, reply);

    expect(reply.statusCode).toBe(200);
    expect(request.user).toEqual(
      expect.objectContaining({
        id: 'u1',
        permissions: ['timesheets.tracker.view'],
      }),
    );
    expect(request.raw.auth).toEqual(
      expect.objectContaining({
        token: 'praetor_mcp_token',
        clientId: 'u1',
        scopes: ['timesheets.tracker.view'],
      }),
    );
    expect(touchLastUsedMock).toHaveBeenCalledWith('mcp-token-1');
  });

  test('403 when token has been idle beyond the timeout', async () => {
    process.env.MCP_IDLE_TIMEOUT_MS = String(60 * 60 * 1000); // 1 hour
    __resetMcpIdleTimeoutCacheForTests();
    findActiveByRawTokenMock.mockResolvedValue({
      id: 'mcp-token-1',
      userId: 'u1',
      name: 'Agent',
      scope: 'full',
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      lastUsedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const request = makeRequest('praetor_mcp_token');
    const reply = makeReply();

    await authenticateMcpToken(request, reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'MCP token expired due to inactivity' });
    expect(findAuthUserByIdMock).not.toHaveBeenCalled();
  });

  test('falls back to createdAt for fresh tokens that have not been used yet', async () => {
    process.env.MCP_IDLE_TIMEOUT_MS = String(60 * 60 * 1000); // 1 hour
    __resetMcpIdleTimeoutCacheForTests();
    findActiveByRawTokenMock.mockResolvedValue({
      id: 'mcp-token-1',
      userId: 'u1',
      name: 'Agent',
      scope: 'full',
      createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      lastUsedAt: null,
    });
    const request = makeRequest('praetor_mcp_token');
    const reply = makeReply();

    await authenticateMcpToken(request, reply);

    expect(reply.statusCode).toBe(200);
    expect(request.user).toEqual(
      expect.objectContaining({ id: 'u1', permissions: ['timesheets.tracker.view'] }),
    );
  });

  test('read_only scope filters permissions to view-only', async () => {
    findActiveByRawTokenMock.mockResolvedValue({
      id: 'mcp-token-1',
      userId: 'u1',
      name: 'Agent',
      scope: 'read_only',
      createdAt: new Date(),
      lastUsedAt: null,
    });
    getRolePermissionsMock.mockResolvedValue([
      'timesheets.tracker.view',
      'timesheets.tracker.create',
      'timesheets.tracker.update',
      'timesheets.tracker.delete',
      'crm.clients.view',
      'crm.clients.delete',
    ]);
    const request = makeRequest('praetor_mcp_token');
    const reply = makeReply();

    await authenticateMcpToken(request, reply);

    expect(reply.statusCode).toBe(200);
    expect(request.user?.permissions).toEqual(['timesheets.tracker.view', 'crm.clients.view']);
    expect(request.raw.auth).toEqual(
      expect.objectContaining({
        scopes: ['timesheets.tracker.view', 'crm.clients.view'],
        extra: expect.objectContaining({ tokenScope: 'read_only' }),
      }),
    );
  });

  test('full scope passes all role permissions through unchanged', async () => {
    findActiveByRawTokenMock.mockResolvedValue({
      id: 'mcp-token-1',
      userId: 'u1',
      name: 'Agent',
      scope: 'full',
      createdAt: new Date(),
      lastUsedAt: null,
    });
    getRolePermissionsMock.mockResolvedValue([
      'timesheets.tracker.view',
      'timesheets.tracker.create',
    ]);
    const request = makeRequest('praetor_mcp_token');
    const reply = makeReply();

    await authenticateMcpToken(request, reply);

    expect(reply.statusCode).toBe(200);
    expect(request.user?.permissions).toEqual([
      'timesheets.tracker.view',
      'timesheets.tracker.create',
    ]);
  });
});
