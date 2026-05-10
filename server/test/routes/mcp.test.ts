import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { McpAuthenticatedUser } from '../../middleware/mcpAuth.ts';
import * as realMcpAuth from '../../middleware/mcpAuth.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realNotificationsRepo from '../../repositories/notificationsRepo.ts';
import * as realProjectsRepo from '../../repositories/projectsRepo.ts';
import * as realSuppliersRepo from '../../repositories/suppliersRepo.ts';
import * as realTasksRepo from '../../repositories/tasksRepo.ts';
import * as realReportsRoutes from '../../routes/reports.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';

const mcpAuthSnap = { ...realMcpAuth };
const clientsRepoSnap = { ...realClientsRepo };
const suppliersRepoSnap = { ...realSuppliersRepo };
const projectsRepoSnap = { ...realProjectsRepo };
const tasksRepoSnap = { ...realTasksRepo };
const notificationsRepoSnap = { ...realNotificationsRepo };
const reportsRoutesSnap = { ...realReportsRoutes };

const clientsListMock = mock();
const suppliersListAllMock = mock();
const projectsListAllMock = mock();
const projectsListForUserMock = mock();
const tasksListAllMock = mock();
const tasksListForUserMock = mock();
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
    expect(toolsBody.result.tools.map((tool: { name: string }) => tool.name)).toContain(
      'praetor_list_clients',
    );

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
});
