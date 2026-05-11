import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { McpAuthenticatedUser } from '../../middleware/mcpAuth.ts';
import * as realMcpAuth from '../../middleware/mcpAuth.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realNotificationsRepo from '../../repositories/notificationsRepo.ts';
import * as realProjectsRepo from '../../repositories/projectsRepo.ts';
import * as realSuppliersRepo from '../../repositories/suppliersRepo.ts';
import * as realTasksRepo from '../../repositories/tasksRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';
import * as realReportsRoutes from '../../routes/reports.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';

const mcpAuthSnap = { ...realMcpAuth };
const clientsRepoSnap = { ...realClientsRepo };
const suppliersRepoSnap = { ...realSuppliersRepo };
const projectsRepoSnap = { ...realProjectsRepo };
const tasksRepoSnap = { ...realTasksRepo };
const usersRepoSnap = { ...realUsersRepo };
const workUnitsRepoSnap = { ...realWorkUnitsRepo };
const notificationsRepoSnap = { ...realNotificationsRepo };
const reportsRoutesSnap = { ...realReportsRoutes };

const clientsListMock = mock();
const suppliersListAllMock = mock();
const projectsListAllMock = mock();
const projectsListForUserMock = mock();
const tasksListAllMock = mock();
const tasksListForUserMock = mock();
const usersListAllForAdminMock = mock();
const usersListScopedForManagerMock = mock();
const workUnitsListAllMock = mock();
const workUnitsListManagedByMock = mock();
const workUnitsListUserIdsByUnitIdsMock = mock();
const notificationsListForUserMock = mock();
const notificationsCountUnreadForUserMock = mock();
const markNotificationReadForUserMock = mock();
const deleteNotificationForUserMock = mock();
const buildBusinessDatasetMock = mock();
const determineRequestedSectionsMock = mock();
const getGeneralAiConfigMock = mock();
const getReportingRangeMock = mock();

let routePlugin: FastifyPluginAsync;
let testApp: FastifyInstance;
let currentPermissions: string[] = [];

const makeMcpUser = (): McpAuthenticatedUser => ({
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'user',
  avatarInitials: 'AL',
  permissions: currentPermissions,
});

const authenticateMcpTokenMock = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer praetor_mcp_')) {
    return reply.code(401).send({ error: 'MCP token required' });
  }

  const user = makeMcpUser();
  request.user = user;
  request.auth = { userId: user.id, sessionStart: Date.now() };
  (request.raw as typeof request.raw & { auth?: unknown }).auth = {
    token: 'praetor_mcp_test',
    clientId: user.id,
    scopes: user.permissions,
    extra: { user, tokenId: 'mcp-token-1', tokenName: 'Agent' },
  };
};

beforeAll(async () => {
  mock.module('../../middleware/mcpAuth.ts', () => ({
    authenticateMcpToken: authenticateMcpTokenMock,
  }));
  mock.module('../../repositories/clientsRepo.ts', () => ({
    ...clientsRepoSnap,
    list: clientsListMock,
  }));
  mock.module('../../repositories/suppliersRepo.ts', () => ({
    ...suppliersRepoSnap,
    listAll: suppliersListAllMock,
  }));
  mock.module('../../repositories/projectsRepo.ts', () => ({
    ...projectsRepoSnap,
    listAll: projectsListAllMock,
    listForUser: projectsListForUserMock,
  }));
  mock.module('../../repositories/tasksRepo.ts', () => ({
    ...tasksRepoSnap,
    listAll: tasksListAllMock,
    listForUser: tasksListForUserMock,
  }));
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    listAllForAdmin: usersListAllForAdminMock,
    listScopedForManager: usersListScopedForManagerMock,
  }));
  mock.module('../../repositories/workUnitsRepo.ts', () => ({
    ...workUnitsRepoSnap,
    listAll: workUnitsListAllMock,
    listManagedBy: workUnitsListManagedByMock,
    listUserIdsByUnitIds: workUnitsListUserIdsByUnitIdsMock,
  }));
  mock.module('../../repositories/notificationsRepo.ts', () => ({
    ...notificationsRepoSnap,
    listForUser: notificationsListForUserMock,
    countUnreadForUser: notificationsCountUnreadForUserMock,
    markReadForUser: markNotificationReadForUserMock,
    deleteForUser: deleteNotificationForUserMock,
  }));
  mock.module('../../routes/reports.ts', () => ({
    buildBusinessDataset: buildBusinessDatasetMock,
    determineRequestedSections: determineRequestedSectionsMock,
    getGeneralAiConfig: getGeneralAiConfigMock,
    getReportingRange: getReportingRangeMock,
  }));

  routePlugin = (await import('../../routes/mcp.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  mock.module('../../middleware/mcpAuth.ts', () => mcpAuthSnap);
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/suppliersRepo.ts', () => suppliersRepoSnap);
  mock.module('../../repositories/projectsRepo.ts', () => projectsRepoSnap);
  mock.module('../../repositories/tasksRepo.ts', () => tasksRepoSnap);
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/workUnitsRepo.ts', () => workUnitsRepoSnap);
  mock.module('../../repositories/notificationsRepo.ts', () => notificationsRepoSnap);
  mock.module('../../routes/reports.ts', () => reportsRoutesSnap);
});

beforeEach(async () => {
  if (testApp) await testApp.close();
  for (const m of [
    clientsListMock,
    suppliersListAllMock,
    projectsListAllMock,
    projectsListForUserMock,
    tasksListAllMock,
    tasksListForUserMock,
    usersListAllForAdminMock,
    usersListScopedForManagerMock,
    workUnitsListAllMock,
    workUnitsListManagedByMock,
    workUnitsListUserIdsByUnitIdsMock,
    notificationsListForUserMock,
    notificationsCountUnreadForUserMock,
    markNotificationReadForUserMock,
    deleteNotificationForUserMock,
    buildBusinessDatasetMock,
    determineRequestedSectionsMock,
    getGeneralAiConfigMock,
    getReportingRangeMock,
  ]) {
    m.mockReset();
  }

  currentPermissions = ['timesheets.tracker.view'];
  clientsListMock.mockResolvedValue([{ id: 'c1', name: 'Client One', description: 'Private' }]);
  suppliersListAllMock.mockResolvedValue([]);
  projectsListAllMock.mockResolvedValue([]);
  projectsListForUserMock.mockResolvedValue([{ id: 'p1', name: 'Project One', clientId: 'c1' }]);
  tasksListAllMock.mockResolvedValue([]);
  tasksListForUserMock.mockResolvedValue([{ id: 't1', name: 'Task One', projectId: 'p1' }]);
  usersListAllForAdminMock.mockResolvedValue([]);
  usersListScopedForManagerMock.mockResolvedValue([
    {
      id: 'u1',
      name: 'Alice',
      username: 'alice',
      email: 'alice@example.com',
      role: 'user',
      avatarInitials: 'AL',
      costPerHour: 42,
      isDisabled: false,
      employeeType: 'app_user',
      hasTopManagerRole: false,
      isAdminOnly: false,
    },
  ]);
  workUnitsListAllMock.mockResolvedValue([]);
  workUnitsListManagedByMock.mockResolvedValue([
    {
      id: 'wu1',
      name: 'Engineering',
      description: null,
      managers: [{ id: 'u1', name: 'Alice' }],
      isDisabled: false,
      userCount: 2,
    },
  ]);
  workUnitsListUserIdsByUnitIdsMock.mockResolvedValue([
    { workUnitId: 'wu1', userId: 'u1' },
    { workUnitId: 'wu1', userId: 'u2' },
  ]);
  notificationsListForUserMock.mockResolvedValue([]);
  notificationsCountUnreadForUserMock.mockResolvedValue(0);
  markNotificationReadForUserMock.mockResolvedValue(true);
  deleteNotificationForUserMock.mockResolvedValue(true);
  getGeneralAiConfigMock.mockResolvedValue({ enableAiReporting: true, currency: 'EUR' });
  getReportingRangeMock.mockReturnValue({ fromDate: '2026-01-01', toDate: '2026-05-11' });
  determineRequestedSectionsMock.mockReturnValue(null);
  buildBusinessDatasetMock.mockResolvedValue({ dataset: {}, metrics: {} });

  testApp = await buildRouteTestApp(routePlugin, '/api/mcp');
});

const rpc = async (body: Record<string, unknown>, auth = true) =>
  testApp.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: {
      ...(auth ? { authorization: 'Bearer praetor_mcp_test' } : {}),
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
    },
    payload: JSON.stringify(body),
  });

const parseMcpBody = (body: string) => {
  const dataLine = body
    .split(/\r?\n/)
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  return JSON.parse(dataLine ?? body);
};

describe('/api/mcp', () => {
  test('supports initialize over Streamable HTTP', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expect(body.result.serverInfo).toEqual({ name: 'praetor', version: '0.6.0' });
  });

  test('lists tools and calls permission-scoped list tools', async () => {
    const toolsRes = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(toolsRes.statusCode).toBe(200);
    const toolsBody = parseMcpBody(toolsRes.body);
    const toolNames = toolsBody.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain('praetor_list_clients');
    expect(toolNames).toContain('praetor_get_users_hierarchy');

    const clientsRes = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'praetor_list_clients', arguments: {} },
    });

    expect(clientsRes.statusCode).toBe(200);
    const clientsBody = parseMcpBody(clientsRes.body);
    expect(clientsBody.result.structuredContent.clients).toEqual([
      { id: 'c1', name: 'Client One', description: null },
    ]);
    expect(clientsListMock).toHaveBeenCalledWith({ canViewAllClients: false, userId: 'u1' });
  });

  test('enforces Praetor permissions inside tools', async () => {
    currentPermissions = [];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'praetor_list_clients', arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe('Insufficient permissions');
    expect(clientsListMock).not.toHaveBeenCalled();
  });

  test('returns permission-scoped users hierarchy with protected fields masked', async () => {
    currentPermissions = ['timesheets.tracker.view', 'hr.work_units.view'];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'praetor_get_users_hierarchy', arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expect(body.result.structuredContent.users).toEqual([
      {
        id: 'u1',
        name: 'Alice',
        username: 'alice',
        email: '',
        role: 'user',
        avatarInitials: 'AL',
        costPerHour: 0,
        isDisabled: false,
        employeeType: 'app_user',
        hasTopManagerRole: false,
        isAdminOnly: false,
      },
    ]);
    expect(body.result.structuredContent.workUnits).toEqual([
      {
        id: 'wu1',
        name: 'Engineering',
        description: null,
        managers: [{ id: 'u1', name: 'Alice' }],
        isDisabled: false,
        userCount: 2,
        userIds: ['u1', 'u2'],
      },
    ]);
    expect(body.result.structuredContent.scope).toEqual({
      canViewAllUsers: false,
      canViewAllWorkUnits: false,
      canViewWorkUnits: true,
      includesCosts: false,
      includesEmails: false,
    });
    expect(usersListScopedForManagerMock).toHaveBeenCalledWith('u1', {
      canViewManagedUsers: true,
      canViewInternal: false,
      canViewExternal: false,
    });
    expect(workUnitsListManagedByMock).toHaveBeenCalledWith('u1');
    expect(workUnitsListUserIdsByUnitIdsMock).toHaveBeenCalledWith(['wu1']);
    expect(usersListAllForAdminMock).not.toHaveBeenCalled();
    expect(workUnitsListAllMock).not.toHaveBeenCalled();
  });

  test('returns all users and work units when hierarchy permissions allow it', async () => {
    currentPermissions = [
      'administration.user_management_all.view',
      'hr.work_units.view',
      'hr.work_units_all.view',
      'hr.costs.view',
    ];
    usersListAllForAdminMock.mockResolvedValue([
      {
        id: 'u2',
        name: 'Bob',
        username: 'bob',
        email: 'bob@example.com',
        role: 'manager',
        avatarInitials: 'BO',
        costPerHour: 84,
        isDisabled: false,
        employeeType: 'internal',
        hasTopManagerRole: true,
        isAdminOnly: false,
      },
    ]);
    workUnitsListAllMock.mockResolvedValue([
      {
        id: 'wu-all',
        name: 'Operations',
        description: 'Ops',
        managers: [{ id: 'u2', name: 'Bob' }],
        isDisabled: false,
        userCount: 1,
      },
    ]);
    workUnitsListUserIdsByUnitIdsMock.mockResolvedValue([{ workUnitId: 'wu-all', userId: 'u2' }]);

    const res = await rpc({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'praetor_get_users_hierarchy', arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expect(body.result.structuredContent.users[0].email).toBe('bob@example.com');
    expect(body.result.structuredContent.users[0].costPerHour).toBe(84);
    expect(body.result.structuredContent.workUnits[0].userIds).toEqual(['u2']);
    expect(body.result.structuredContent.scope).toEqual({
      canViewAllUsers: true,
      canViewAllWorkUnits: true,
      canViewWorkUnits: true,
      includesCosts: true,
      includesEmails: true,
    });
    expect(usersListAllForAdminMock).toHaveBeenCalled();
    expect(usersListScopedForManagerMock).not.toHaveBeenCalled();
    expect(workUnitsListAllMock).toHaveBeenCalled();
    expect(workUnitsListManagedByMock).not.toHaveBeenCalled();
  });

  test('enforces Praetor permissions for users hierarchy', async () => {
    currentPermissions = [];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'praetor_get_users_hierarchy', arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe('Insufficient permissions');
    expect(usersListScopedForManagerMock).not.toHaveBeenCalled();
    expect(workUnitsListManagedByMock).not.toHaveBeenCalled();
    expect(workUnitsListUserIdsByUnitIdsMock).not.toHaveBeenCalled();
  });
});
