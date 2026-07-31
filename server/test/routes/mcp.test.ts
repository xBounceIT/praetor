import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import swagger from '@fastify/swagger';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { McpAuthenticatedUser } from '../../middleware/mcpAuth.ts';
import * as realMcpAuth from '../../middleware/mcpAuth.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import * as realClientsOrdersRepo from '../../repositories/clientsOrdersRepo.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realInvoicesRepo from '../../repositories/invoicesRepo.ts';
import * as realNotificationsRepo from '../../repositories/notificationsRepo.ts';
import * as realProjectsRepo from '../../repositories/projectsRepo.ts';
import * as realSupplierInvoicesRepo from '../../repositories/supplierInvoicesRepo.ts';
import * as realSupplierOrdersRepo from '../../repositories/supplierOrdersRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import * as realSuppliersRepo from '../../repositories/suppliersRepo.ts';
import * as realTasksRepo from '../../repositories/tasksRepo.ts';
import * as realUserHourlyCostPeriodsRepo from '../../repositories/userHourlyCostPeriodsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';
import * as realTimeEntriesService from '../../services/timeEntries.ts';
import { APP_VERSION } from '../../utils/app-version.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';

const mcpAuthSnap = { ...realMcpAuth };
const clientOffersRepoSnap = { ...realClientOffersRepo };
const clientQuotesRepoSnap = { ...realClientQuotesRepo };
const clientsRepoSnap = { ...realClientsRepo };
const clientsOrdersRepoSnap = { ...realClientsOrdersRepo };
const invoicesRepoSnap = { ...realInvoicesRepo };
const suppliersRepoSnap = { ...realSuppliersRepo };
const projectsRepoSnap = { ...realProjectsRepo };
const supplierInvoicesRepoSnap = { ...realSupplierInvoicesRepo };
const supplierOrdersRepoSnap = { ...realSupplierOrdersRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const tasksRepoSnap = { ...realTasksRepo };
const usersRepoSnap = { ...realUsersRepo };
const userHourlyCostPeriodsRepoSnap = { ...realUserHourlyCostPeriodsRepo };
const workUnitsRepoSnap = { ...realWorkUnitsRepo };
const notificationsRepoSnap = { ...realNotificationsRepo };
const timeEntriesServiceSnap = { ...realTimeEntriesService };

const clientOffersListAllMock = mock();
const clientOffersListAllItemsMock = mock();
const clientQuotesListAllMock = mock();
const clientQuotesListAllItemsMock = mock();
const clientsListMock = mock();
const clientsOrdersListAllMock = mock();
const clientsOrdersListAllItemsMock = mock();
const invoicesListAllWithItemsMock = mock();
const suppliersListAllMock = mock();
const suppliersListOptionsMock = mock();
const supplierInvoicesListAllWithItemsMock = mock();
const supplierOrdersListAllMock = mock();
const supplierOrdersListAllItemsMock = mock();
const supplierQuotesListAllMock = mock();
const supplierQuotesListAllItemsMock = mock();
const projectsListAllMock = mock();
const projectsListForUserMock = mock();
const tasksListAllMock = mock();
const tasksListForUserMock = mock();
const usersListAllForAdminMock = mock();
const usersListScopedForManagerMock = mock();
const listHourlyCostsForDateMock = mock();
const workUnitsListAllMock = mock();
const workUnitsListManagedByMock = mock();
const workUnitsListUserIdsByUnitIdsMock = mock();
const notificationsListForUserMock = mock();
const notificationsCountUnreadForUserMock = mock();
const markNotificationReadForUserMock = mock();
const deleteNotificationForUserMock = mock();
const listTimeEntriesMock = mock();
const createTimeEntryMock = mock();
const updateTimeEntryMock = mock();
const deleteTimeEntryMock = mock();

let routePlugin: FastifyPluginAsync;
let testApp: FastifyInstance;
let currentPermissions: string[] = [];
let currentTokenScope: 'full' | 'read_only' = 'full';
const gatewayMutationMock = mock();
let activeGatewayRequests = 0;
let maxActiveGatewayRequests = 0;

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
  request.auth = { userId: user.id, source: 'mcpToken', tokenScope: currentTokenScope };
  (request.raw as typeof request.raw & { auth?: unknown }).auth = {
    token: 'praetor_mcp_test',
    clientId: user.id,
    scopes: user.permissions,
    extra: {
      clientIp: request.ip,
      user,
      tokenId: 'mcp-token-1',
      tokenName: 'Agent',
      tokenScope: currentTokenScope,
    },
  };
};

beforeAll(async () => {
  mock.module('../../middleware/mcpAuth.ts', () => ({
    authenticateMcpToken: authenticateMcpTokenMock,
  }));
  mock.module('../../repositories/clientOffersRepo.ts', () => ({
    ...clientOffersRepoSnap,
    listAll: clientOffersListAllMock,
    listAllItems: clientOffersListAllItemsMock,
  }));
  mock.module('../../repositories/clientQuotesRepo.ts', () => ({
    ...clientQuotesRepoSnap,
    listAll: clientQuotesListAllMock,
    listAllItems: clientQuotesListAllItemsMock,
  }));
  mock.module('../../repositories/clientsRepo.ts', () => ({
    ...clientsRepoSnap,
    list: clientsListMock,
  }));
  mock.module('../../repositories/clientsOrdersRepo.ts', () => ({
    ...clientsOrdersRepoSnap,
    listAll: clientsOrdersListAllMock,
    listAllItems: clientsOrdersListAllItemsMock,
  }));
  mock.module('../../repositories/invoicesRepo.ts', () => ({
    ...invoicesRepoSnap,
    listAllWithItems: invoicesListAllWithItemsMock,
  }));
  mock.module('../../repositories/suppliersRepo.ts', () => ({
    ...suppliersRepoSnap,
    listAll: suppliersListAllMock,
    listOptions: suppliersListOptionsMock,
  }));
  mock.module('../../repositories/supplierInvoicesRepo.ts', () => ({
    ...supplierInvoicesRepoSnap,
    listAllWithItems: supplierInvoicesListAllWithItemsMock,
  }));
  mock.module('../../repositories/supplierOrdersRepo.ts', () => ({
    ...supplierOrdersRepoSnap,
    listAll: supplierOrdersListAllMock,
    listAllItems: supplierOrdersListAllItemsMock,
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    listAll: supplierQuotesListAllMock,
    listAllItems: supplierQuotesListAllItemsMock,
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
  mock.module('../../repositories/userHourlyCostPeriodsRepo.ts', () => ({
    ...userHourlyCostPeriodsRepoSnap,
    listCostsForDate: listHourlyCostsForDateMock,
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
  mock.module('../../services/timeEntries.ts', () => ({
    ...timeEntriesServiceSnap,
    listTimeEntries: listTimeEntriesMock,
    createTimeEntry: createTimeEntryMock,
    updateTimeEntry: updateTimeEntryMock,
    deleteTimeEntry: deleteTimeEntryMock,
  }));

  routePlugin = (await import('../../routes/mcp.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  mock.module('../../middleware/mcpAuth.ts', () => mcpAuthSnap);
  mock.module('../../repositories/clientOffersRepo.ts', () => clientOffersRepoSnap);
  mock.module('../../repositories/clientQuotesRepo.ts', () => clientQuotesRepoSnap);
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/clientsOrdersRepo.ts', () => clientsOrdersRepoSnap);
  mock.module('../../repositories/invoicesRepo.ts', () => invoicesRepoSnap);
  mock.module('../../repositories/suppliersRepo.ts', () => suppliersRepoSnap);
  mock.module('../../repositories/supplierInvoicesRepo.ts', () => supplierInvoicesRepoSnap);
  mock.module('../../repositories/supplierOrdersRepo.ts', () => supplierOrdersRepoSnap);
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module('../../repositories/projectsRepo.ts', () => projectsRepoSnap);
  mock.module('../../repositories/tasksRepo.ts', () => tasksRepoSnap);
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module(
    '../../repositories/userHourlyCostPeriodsRepo.ts',
    () => userHourlyCostPeriodsRepoSnap,
  );
  mock.module('../../repositories/workUnitsRepo.ts', () => workUnitsRepoSnap);
  mock.module('../../repositories/notificationsRepo.ts', () => notificationsRepoSnap);
  mock.module('../../services/timeEntries.ts', () => timeEntriesServiceSnap);
});

beforeEach(async () => {
  if (testApp) await testApp.close();
  for (const m of [
    clientOffersListAllMock,
    clientOffersListAllItemsMock,
    clientQuotesListAllMock,
    clientQuotesListAllItemsMock,
    clientsListMock,
    clientsOrdersListAllMock,
    clientsOrdersListAllItemsMock,
    invoicesListAllWithItemsMock,
    suppliersListAllMock,
    suppliersListOptionsMock,
    supplierInvoicesListAllWithItemsMock,
    supplierOrdersListAllMock,
    supplierOrdersListAllItemsMock,
    supplierQuotesListAllMock,
    supplierQuotesListAllItemsMock,
    projectsListAllMock,
    projectsListForUserMock,
    tasksListAllMock,
    tasksListForUserMock,
    usersListAllForAdminMock,
    usersListScopedForManagerMock,
    listHourlyCostsForDateMock,
    workUnitsListAllMock,
    workUnitsListManagedByMock,
    workUnitsListUserIdsByUnitIdsMock,
    notificationsListForUserMock,
    notificationsCountUnreadForUserMock,
    markNotificationReadForUserMock,
    deleteNotificationForUserMock,
    listTimeEntriesMock,
    createTimeEntryMock,
    updateTimeEntryMock,
    deleteTimeEntryMock,
    gatewayMutationMock,
  ]) {
    m.mockReset();
  }

  currentPermissions = ['timesheets.tracker.view'];
  currentTokenScope = 'full';
  activeGatewayRequests = 0;
  maxActiveGatewayRequests = 0;
  clientOffersListAllMock.mockResolvedValue([]);
  clientOffersListAllItemsMock.mockResolvedValue([]);
  clientQuotesListAllMock.mockResolvedValue([]);
  clientQuotesListAllItemsMock.mockResolvedValue([]);
  clientsListMock.mockResolvedValue([{ id: 'c1', name: 'Client One', description: 'Private' }]);
  clientsOrdersListAllMock.mockResolvedValue([]);
  clientsOrdersListAllItemsMock.mockResolvedValue([]);
  invoicesListAllWithItemsMock.mockResolvedValue([]);
  suppliersListAllMock.mockResolvedValue([]);
  suppliersListOptionsMock.mockResolvedValue([]);
  supplierInvoicesListAllWithItemsMock.mockResolvedValue([]);
  supplierOrdersListAllMock.mockResolvedValue([]);
  supplierOrdersListAllItemsMock.mockResolvedValue([]);
  supplierQuotesListAllMock.mockResolvedValue([]);
  supplierQuotesListAllItemsMock.mockResolvedValue([]);
  projectsListAllMock.mockResolvedValue([]);
  projectsListForUserMock.mockResolvedValue([{ id: 'p1', name: 'Project One', clientId: 'c1' }]);
  tasksListAllMock.mockResolvedValue([]);
  tasksListForUserMock.mockResolvedValue([{ id: 't1', name: 'Task One', projectId: 'p1' }]);
  listHourlyCostsForDateMock.mockResolvedValue(new Map());
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
      // The repo carries member display names; the hierarchy tool must NOT leak them
      // (it exposes only userIds). The response assertion below omits `members`.
      members: [
        { id: 'u1', name: 'Alice' },
        { id: 'u2', name: 'Bob' },
      ],
      isDisabled: false,
      userCount: 2,
    },
  ]);
  notificationsListForUserMock.mockResolvedValue([]);
  notificationsCountUnreadForUserMock.mockResolvedValue(0);
  markNotificationReadForUserMock.mockResolvedValue(true);
  deleteNotificationForUserMock.mockResolvedValue(true);
  listTimeEntriesMock.mockResolvedValue({ entries: [], nextCursor: null });
  createTimeEntryMock.mockImplementation((_user, entry) =>
    Promise.resolve({ id: `created-${entry.task}`, ...entry }),
  );
  updateTimeEntryMock.mockImplementation((_user, id, patch) => Promise.resolve({ id, ...patch }));
  deleteTimeEntryMock.mockResolvedValue({ message: 'Entry deleted' });

  testApp = await buildRouteTestApp(routePlugin, '/api/mcp', async (app) => {
    await app.register(swagger, {
      openapi: { info: { title: 'MCP gateway test API', version: '1.0.0' } },
    });
    const requireGatewayPermission =
      (permission: string) => async (request: FastifyRequest, _reply: FastifyReply) => {
        if (request.headers.authorization !== 'Bearer praetor_mcp_test') {
          throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
        }
        if (!currentPermissions.includes(permission)) {
          throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });
        }
      };

    app.get(
      '/api/gateway-test/:id',
      {
        onRequest: [requireGatewayPermission('gateway.view')],
        schema: { summary: 'Get gateway test', tags: ['gateway'] },
      },
      async (request) => ({
        id: (request.params as { id: string }).id,
        ip: request.ip,
        query: request.query,
      }),
    );
    app.patch(
      '/api/gateway-test/:id',
      {
        onRequest: [requireGatewayPermission('gateway.update')],
        schema: { summary: 'Update gateway test', tags: ['gateway'] },
      },
      async (request) => {
        gatewayMutationMock(request.body);
        return {
          id: (request.params as { id: string }).id,
          body: request.body,
        };
      },
    );
    app.get('/api/gateway-redirect', { schema: { hide: true } }, async (_request, reply) =>
      reply.code(302).header('location', '/api/gateway-test/item-1').send(),
    );
    app.patch(
      '/api/gateway-large-response',
      {
        onRequest: [requireGatewayPermission('gateway.update')],
        schema: { hide: true },
      },
      async (request) => {
        gatewayMutationMock(request.body);
        return { payload: 'x'.repeat(2 * 1024 * 1024) };
      },
    );
    app.get(
      '/api/gateway-medium-response/:id',
      {
        onRequest: [requireGatewayPermission('gateway.view')],
        schema: { hide: true },
      },
      async (request) => ({
        id: (request.params as { id: string }).id,
        payload: 'x'.repeat(1024 * 1024),
      }),
    );
    app.get(
      '/api/gateway-slow/:id',
      {
        onRequest: [requireGatewayPermission('gateway.view')],
        schema: { hide: true },
      },
      async (request) => {
        activeGatewayRequests += 1;
        maxActiveGatewayRequests = Math.max(maxActiveGatewayRequests, activeGatewayRequests);
        await Bun.sleep(10);
        activeGatewayRequests -= 1;
        return { id: (request.params as { id: string }).id };
      },
    );
  });
});

const rpc = async (body: Record<string, unknown>, auth = true, remoteAddress?: string) =>
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
    ...(remoteAddress ? { remoteAddress } : {}),
  });

const parseMcpBody = (body: string) => {
  const dataLine = body
    .split(/\r?\n/)
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  return JSON.parse(dataLine ?? body);
};

const makeCreateTimeEntryArgs = (task: string) => ({
  date: '2026-05-11',
  clientId: 'c1',
  clientName: 'Client One',
  projectId: 'p1',
  projectName: 'Project One',
  task,
  notes: `Work completed for ${task}`,
  duration: 1,
});
const FULL_HR_USER = {
  id: 'u2',
  name: 'Bob',
  username: 'bob',
  email: 'bob@example.com',
  role: 'user',
  avatarInitials: 'BO',
  costPerHour: 84,
  isDisabled: false,
  employeeType: 'internal' as const,
  hasTopManagerRole: false,
  isAdminOnly: false,
  firstName: 'Robert',
  lastName: 'Example',
  phone: '+39 555 0100',
  jobTitle: 'Engineer',
  department: 'Research',
  responsibleUserId: 'u3',
  responsibleUserName: 'Manager',
  employeeCode: 'EMP-002',
  hireDate: '2024-01-15',
  terminationDate: null,
  contractType: 'permanent' as const,
  employmentStatus: 'active' as const,
  workLocation: 'hybrid' as const,
  emergencyContactName: 'Emergency Contact',
  emergencyContactPhone: '+39 555 0199',
  address: 'Private address',
  notes: 'Private HR notes',
};
const FULL_PROJECT = {
  id: 'p1',
  name: 'Project One',
  clientId: 'c1',
  description: 'Advanced description',
  isDisabled: false,
  createdAt: 1_700_000_000_000,
  orderId: 'co-1',
  offerId: 'of-1',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  revenue: 12_000,
  billingType: 'retainer',
  billingFrequency: 'monthly',
  status: 'in_corso',
  tipo: 'attivo',
  tipoConfirmed: true,
};

const expectOneBulkSuccessAndOneFailure = (summary: unknown) => {
  expect(summary).toEqual({ requested: 2, succeeded: 1, failed: 1 });
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
    expect(body.result.serverInfo).toEqual({ name: 'praetor', version: APP_VERSION });
  });

  test('lists tools and calls permission-scoped list tools', async () => {
    const toolsRes = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(toolsRes.statusCode).toBe(200);
    const toolsBody = parseMcpBody(toolsRes.body);
    const toolNames = toolsBody.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain('praetor_list_clients');
    expect(toolNames).toContain('praetor_list_suppliers');
    expect(toolNames).toContain('praetor_get_users_hierarchy');
    expect(toolNames).toContain('praetor_list_quotes');
    expect(toolNames).toContain('praetor_list_offers');
    expect(toolNames).toContain('praetor_list_orders');
    expect(toolNames).toContain('praetor_list_invoices');
    expect(toolNames).toContain('praetor_bulk_create_time_entries');
    expect(toolNames).toContain('praetor_bulk_update_time_entries');
    expect(toolNames).toContain('praetor_bulk_delete_time_entries');
    expect(toolNames).toContain('praetor_list_api_operations');
    expect(toolNames).toContain('praetor_retrieve');
    expect(toolNames).toContain('praetor_bulk_retrieve');
    expect(toolNames).toContain('praetor_mutate');
    expect(toolNames).toContain('praetor_bulk_mutate');
    expect(toolNames).not.toContain('praetor_get_reporting_dataset');

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

  test('discovers non-auth API operations alongside the token permissions', async () => {
    currentPermissions = ['gateway.view', 'gateway.update'];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'praetor_list_api_operations',
        arguments: { search: 'gateway', limit: 10 },
      },
    });

    expect(res.statusCode).toBe(200);
    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content.total).toBe(2);
    expect(content.operations).toEqual([
      {
        method: 'GET',
        path: '/api/gateway-test/{id}',
        summary: 'Get gateway test',
        tags: ['gateway'],
      },
      {
        method: 'PATCH',
        path: '/api/gateway-test/{id}',
        summary: 'Update gateway test',
        tags: ['gateway'],
      },
    ]);
    expect(content.grantedPermissions).toEqual(['gateway.view', 'gateway.update']);
  });

  test('retrieves any authorized API route with query parameters', async () => {
    currentPermissions = ['gateway.view'];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'praetor_retrieve',
        arguments: {
          requestId: 'lookup-1',
          path: '/api/gateway-test/item-1',
          query: { include: ['details', 'history'], limit: 5 },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content).toMatchObject({
      requestId: 'lookup-1',
      ok: true,
      status: 200,
      body: {
        id: 'item-1',
        query: { include: ['details', 'history'], limit: '5' },
      },
    });
  });

  test('preserves the outer client IP for target-route audit and rate limiting', async () => {
    currentPermissions = ['gateway.view'];

    const res = await rpc(
      {
        jsonrpc: '2.0',
        id: 221,
        method: 'tools/call',
        params: {
          name: 'praetor_retrieve',
          arguments: { path: '/api/gateway-test/item-1' },
        },
      },
      true,
      '203.0.113.7',
    );

    expect(parseMcpBody(res.body).result.structuredContent).toMatchObject({
      ok: true,
      status: 200,
      body: { ip: '203.0.113.7' },
    });
  });

  test('returns target-route permission failures without bypassing the route guard', async () => {
    currentPermissions = [];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'praetor_retrieve',
        arguments: { path: '/api/gateway-test/item-1' },
      },
    });

    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content).toMatchObject({
      ok: false,
      status: 403,
      body: { message: 'Insufficient permissions' },
    });
  });

  test('bulk retrieves with stable order and per-request results', async () => {
    currentPermissions = ['gateway.view'];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_retrieve',
        arguments: {
          requests: [
            { requestId: 'found', path: '/api/gateway-test/item-1' },
            { requestId: 'missing', path: '/api/not-found' },
          ],
        },
      },
    });

    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content.summary).toEqual({ requested: 2, succeeded: 1, failed: 1 });
    expect(content.results).toEqual([
      expect.objectContaining({ index: 0, requestId: 'found', ok: true, status: 200 }),
      expect.objectContaining({ index: 1, requestId: 'missing', ok: false, status: 404 }),
    ]);
  });

  test('bounds concurrent gateway work in bulk retrievals', async () => {
    currentPermissions = ['gateway.view'];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 231,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_retrieve',
        arguments: {
          requests: Array.from({ length: 12 }, (_, index) => ({
            path: `/api/gateway-slow/${index}`,
          })),
        },
      },
    });

    expect(parseMcpBody(res.body).result.structuredContent.summary).toEqual({
      requested: 12,
      succeeded: 12,
      failed: 0,
    });
    expect(maxActiveGatewayRequests).toBeLessThanOrEqual(5);
  });

  test('caps aggregate bulk response bodies while preserving each target outcome', async () => {
    currentPermissions = ['gateway.view'];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 232,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_retrieve',
        arguments: {
          requests: Array.from({ length: 6 }, (_, index) => ({
            requestId: `medium-${index}`,
            path: `/api/gateway-medium-response/${index}`,
          })),
        },
      },
    });

    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content.summary).toEqual({ requested: 6, succeeded: 6, failed: 0 });
    expect(content.results.every((result: { ok: boolean }) => result.ok)).toBe(true);
    expect(
      content.results.some(
        (result: { bodyTruncated?: boolean; body?: { targetRequestSucceeded?: boolean } }) =>
          result.bodyTruncated && result.body?.targetRequestSucceeded === true,
      ),
    ).toBe(true);
  });

  test('mutates any authorized API route with a full-access token', async () => {
    currentPermissions = ['gateway.update'];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 24,
      method: 'tools/call',
      params: {
        name: 'praetor_mutate',
        arguments: {
          method: 'PATCH',
          path: '/api/gateway-test/item-1',
          body: { name: 'Updated' },
        },
      },
    });

    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content).toMatchObject({
      ok: true,
      status: 200,
      body: { id: 'item-1', body: { name: 'Updated' } },
    });
    expect(gatewayMutationMock).toHaveBeenCalledWith({ name: 'Updated' });
  });

  test('does not report a committed mutation as failed when its response body is oversized', async () => {
    currentPermissions = ['gateway.update'];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 241,
      method: 'tools/call',
      params: {
        name: 'praetor_mutate',
        arguments: {
          method: 'PATCH',
          path: '/api/gateway-large-response',
          body: { name: 'Committed once' },
        },
      },
    });

    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content).toMatchObject({
      ok: true,
      status: 200,
      bodyTruncated: true,
      body: { targetRequestSucceeded: true },
    });
    expect(content.originalBodyBytes).toBeGreaterThan(2 * 1024 * 1024);
    expect(gatewayMutationMock).toHaveBeenCalledTimes(1);
    expect(gatewayMutationMock).toHaveBeenCalledWith({ name: 'Committed once' });
  });

  test('classifies redirects as non-successful target responses', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 242,
      method: 'tools/call',
      params: {
        name: 'praetor_retrieve',
        arguments: { path: '/api/gateway-redirect' },
      },
    });

    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content).toMatchObject({
      ok: false,
      status: 302,
      headers: { location: '/api/gateway-test/item-1' },
    });
  });

  test('blocks generic mutations for read-only tokens before calling the target route', async () => {
    currentPermissions = ['gateway.update'];
    currentTokenScope = 'read_only';

    const res = await rpc({
      jsonrpc: '2.0',
      id: 25,
      method: 'tools/call',
      params: {
        name: 'praetor_mutate',
        arguments: {
          method: 'PATCH',
          path: '/api/gateway-test/item-1',
          body: { name: 'Blocked' },
        },
      },
    });

    const result = parseMcpBody(res.body).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('MCP token is read-only');
    expect(gatewayMutationMock).not.toHaveBeenCalled();
  });

  test('bulk mutates with partial results and no rollback of successful requests', async () => {
    currentPermissions = ['gateway.update'];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 251,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_mutate',
        arguments: {
          requests: [
            {
              requestId: 'updated',
              method: 'PATCH',
              path: '/api/gateway-test/item-1',
              body: { name: 'Updated in bulk' },
            },
            { requestId: 'missing', method: 'DELETE', path: '/api/not-found' },
          ],
        },
      },
    });

    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content.summary).toEqual({ requested: 2, succeeded: 1, failed: 1 });
    expect(content.results).toEqual([
      expect.objectContaining({ index: 0, requestId: 'updated', ok: true, status: 200 }),
      expect.objectContaining({ index: 1, requestId: 'missing', ok: false, status: 404 }),
    ]);
    expect(gatewayMutationMock).toHaveBeenCalledWith({ name: 'Updated in bulk' });
  });

  test('rejects auth gateway paths and API batches over 25 requests', async () => {
    const authPathRes = await rpc({
      jsonrpc: '2.0',
      id: 26,
      method: 'tools/call',
      params: {
        name: 'praetor_retrieve',
        arguments: { path: '/api/auth/login' },
      },
    });
    const authPathResult = parseMcpBody(authPathRes.body).result;
    expect(authPathResult.isError).toBe(true);
    expect(authPathResult.content[0].text).toMatch(/authentication endpoints/i);

    const encodedAuthPathRes = await rpc({
      jsonrpc: '2.0',
      id: 261,
      method: 'tools/call',
      params: {
        name: 'praetor_retrieve',
        arguments: { path: '/api/%61uth/login' },
      },
    });
    expect(parseMcpBody(encodedAuthPathRes.body).result.isError).toBe(true);

    const encodedSeparatorRes = await rpc({
      jsonrpc: '2.0',
      id: 262,
      method: 'tools/call',
      params: {
        name: 'praetor_retrieve',
        arguments: { path: '/api/%2fauth/login' },
      },
    });
    expect(parseMcpBody(encodedSeparatorRes.body).result.isError).toBe(true);

    const batchRes = await rpc({
      jsonrpc: '2.0',
      id: 27,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_retrieve',
        arguments: {
          requests: Array.from({ length: 26 }, (_, index) => ({
            path: `/api/gateway-test/${index}`,
          })),
        },
      },
    });
    const batchResult = parseMcpBody(batchRes.body).result;
    expect(batchResult.isError).toBe(true);
    expect(batchResult.content[0].text).toContain('Too big');
  });

  test('redacts advanced project data for list-only MCP users', async () => {
    currentPermissions = ['projects.manage.view'];
    projectsListForUserMock.mockResolvedValue([FULL_PROJECT]);

    const projectsRes = await rpc({
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: { name: 'praetor_list_projects', arguments: {} },
    });

    expect(projectsRes.statusCode).toBe(200);
    const projectsBody = parseMcpBody(projectsRes.body);
    const [project] = projectsBody.result.structuredContent.projects;
    expect(project).toMatchObject({
      id: FULL_PROJECT.id,
      name: FULL_PROJECT.name,
      clientId: FULL_PROJECT.clientId,
      description: FULL_PROJECT.description,
      billingType: FULL_PROJECT.billingType,
      status: FULL_PROJECT.status,
    });
    expect(project).not.toHaveProperty('orderId');
    expect(project).not.toHaveProperty('offerId');
    expect(project).not.toHaveProperty('revenue');
    expect(project).not.toHaveProperty('tipoConfirmed');
  });

  test('keeps the complete MCP project payload for manage_all advanced-data viewers', async () => {
    currentPermissions = ['projects.manage_all.view', 'projects.details.view'];
    projectsListAllMock.mockResolvedValue([FULL_PROJECT]);

    const projectsRes = await rpc({
      jsonrpc: '2.0',
      id: 32,
      method: 'tools/call',
      params: { name: 'praetor_list_projects', arguments: {} },
    });

    expect(projectsRes.statusCode).toBe(200);
    const projectsBody = parseMcpBody(projectsRes.body);
    expect(projectsBody.result.structuredContent.projects).toEqual([FULL_PROJECT]);
    expect(projectsListAllMock).toHaveBeenCalledTimes(1);
    expect(projectsListForUserMock).not.toHaveBeenCalled();
  });

  test('returns multiple supplier contacts to all-scope supplier viewers', async () => {
    currentPermissions = ['crm.suppliers_all.view'];
    suppliersListAllMock.mockResolvedValue([
      {
        id: 's1',
        name: 'Supplier One',
        contacts: [
          {
            fullName: 'Jane Doe',
            role: 'Buyer',
            email: 'jane@supplier.test',
            phone: '123',
          },
          { fullName: 'Bob Smith', role: 'Support' },
        ],
        contactName: 'Jane Doe',
        email: 'jane@supplier.test',
        phone: '123',
      },
    ]);

    const suppliersRes = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'praetor_list_suppliers', arguments: {} },
    });

    expect(suppliersRes.statusCode).toBe(200);
    const suppliersBody = parseMcpBody(suppliersRes.body);
    expect(suppliersBody.result.structuredContent.suppliers[0].contacts).toEqual([
      {
        fullName: 'Jane Doe',
        role: 'Buyer',
        email: 'jane@supplier.test',
        phone: '123',
      },
      { fullName: 'Bob Smith', role: 'Support' },
    ]);
    expect(suppliersListAllMock).toHaveBeenCalledTimes(1);
    expect(suppliersListOptionsMock).not.toHaveBeenCalled();
  });

  test('returns only supplier selector fields to document viewers', async () => {
    currentPermissions = ['accounting.supplier_invoices.view'];
    suppliersListOptionsMock.mockResolvedValue([
      { id: 's1', name: 'Supplier One', isDisabled: false },
    ]);

    const suppliersRes = await rpc({
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: { name: 'praetor_list_suppliers', arguments: {} },
    });

    expect(suppliersRes.statusCode).toBe(200);
    const suppliersBody = parseMcpBody(suppliersRes.body);
    expect(suppliersBody.result.structuredContent.suppliers).toEqual([
      { id: 's1', name: 'Supplier One', isDisabled: false },
    ]);
    expect(suppliersListOptionsMock).toHaveBeenCalledTimes(1);
    expect(suppliersListAllMock).not.toHaveBeenCalled();
  });

  test('lists permission-scoped quotes, offers, orders, and invoices', async () => {
    currentPermissions = [
      'sales.client_quotes.view',
      'sales.supplier_quotes.view',
      'sales.client_offers.view',
      'accounting.clients_orders.view',
      'accounting.supplier_orders.view',
      'accounting.clients_invoices.view',
      'accounting.supplier_invoices.view',
    ];
    clientQuotesListAllMock.mockResolvedValue([
      {
        id: 'cq-1',
        clientId: 'c1',
        clientName: 'Client One',
        status: 'draft',
        expirationDate: '2000-01-01',
      },
    ]);
    clientQuotesListAllItemsMock.mockResolvedValue([{ id: 'cqi-1', quoteId: 'cq-1' }]);
    // Status is fully derived (#779): the linked client quote's `sent` drives the supplier quote.
    supplierQuotesListAllMock.mockResolvedValue([
      {
        id: 'sq-1',
        supplierId: 's1',
        supplierName: 'Supplier One',
        status: 'received',
        linkedClientQuoteId: 'cq-9',
        linkedClientQuoteStatus: 'sent',
      },
    ]);
    supplierQuotesListAllItemsMock.mockResolvedValue([
      { id: 'sqi-1', quoteId: 'sq-1', unitType: 'days' },
    ]);
    clientOffersListAllMock.mockResolvedValue([{ id: 'co-1', clientId: 'c1' }]);
    clientOffersListAllItemsMock.mockResolvedValue([{ id: 'coi-1', offerId: 'co-1' }]);
    clientsOrdersListAllMock.mockResolvedValue([{ id: 'ord-1', clientId: 'c1' }]);
    clientsOrdersListAllItemsMock.mockResolvedValue([{ id: 'ordi-1', orderId: 'ord-1' }]);
    supplierOrdersListAllMock.mockResolvedValue([{ id: 'sord-1', supplierId: 's1' }]);
    supplierOrdersListAllItemsMock.mockResolvedValue([{ id: 'sordi-1', orderId: 'sord-1' }]);
    invoicesListAllWithItemsMock.mockResolvedValue([{ id: 'inv-1', items: [{ id: 'invi-1' }] }]);
    supplierInvoicesListAllWithItemsMock.mockResolvedValue([
      { id: 'sinv-1', supplierId: 's1', items: [{ id: 'sinvi-1', invoiceId: 'sinv-1' }] },
    ]);

    const quotesRes = await rpc({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'praetor_list_quotes', arguments: {} },
    });
    const quotesBody = parseMcpBody(quotesRes.body);
    expect(quotesBody.result.structuredContent.clientQuotes[0].items).toEqual([
      { id: 'cqi-1', quoteId: 'cq-1' },
    ]);
    expect(quotesBody.result.structuredContent.clientQuotes[0].isExpired).toBe(true);
    expect(quotesBody.result.structuredContent.supplierQuotes[0].status).toBe('sent');
    expect(quotesBody.result.structuredContent.supplierQuotes[0].items[0].unitType).toBe('days');

    const offersRes = await rpc({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'praetor_list_offers', arguments: {} },
    });
    expect(parseMcpBody(offersRes.body).result.structuredContent.offers[0].items).toEqual([
      { id: 'coi-1', offerId: 'co-1' },
    ]);

    const ordersRes = await rpc({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'praetor_list_orders', arguments: {} },
    });
    const ordersBody = parseMcpBody(ordersRes.body);
    expect(ordersBody.result.structuredContent.clientOrders[0].items).toEqual([
      { id: 'ordi-1', orderId: 'ord-1' },
    ]);
    expect(ordersBody.result.structuredContent.supplierOrders[0].items).toEqual([
      { id: 'sordi-1', orderId: 'sord-1' },
    ]);

    const invoicesRes = await rpc({
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: { name: 'praetor_list_invoices', arguments: {} },
    });
    const invoicesBody = parseMcpBody(invoicesRes.body);
    expect(invoicesBody.result.structuredContent.clientInvoices).toEqual([
      { id: 'inv-1', items: [{ id: 'invi-1' }] },
    ]);
    expect(invoicesBody.result.structuredContent.supplierInvoices[0].items).toEqual([
      { id: 'sinvi-1', invoiceId: 'sinv-1' },
    ]);
  });

  test('only loads sales documents allowed by current MCP permissions', async () => {
    currentPermissions = ['sales.supplier_quotes.view'];

    const res = await rpc({
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
      params: { name: 'praetor_list_quotes', arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expect(body.result.structuredContent.clientQuotes).toEqual([]);
    expect(body.result.structuredContent.scope).toEqual({
      includesClientQuotes: false,
      includesSupplierQuotes: true,
    });
    expect(clientQuotesListAllMock).not.toHaveBeenCalled();
    expect(supplierQuotesListAllMock).toHaveBeenCalled();
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
    // `members` is intentionally absent: the tool exposes only `userIds`, never member
    // display names (toEqual is exact, so a regression that leaks `members` fails here).
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
    // userIds is derived from the members the repo already returns — no second query.
    expect(workUnitsListUserIdsByUnitIdsMock).not.toHaveBeenCalled();
    expect(usersListAllForAdminMock).not.toHaveBeenCalled();
    expect(workUnitsListAllMock).not.toHaveBeenCalled();
  });

  test('tracker_all MCP viewers see every user without managing their competence centers', async () => {
    currentPermissions = ['timesheets.tracker_all.view'];
    usersListAllForAdminMock.mockResolvedValue([FULL_HR_USER]);

    const res = await rpc({
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: { name: 'praetor_get_users_hierarchy', arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content.users).toEqual([
      {
        id: 'u2',
        name: 'Bob',
        username: 'bob',
        email: '',
        role: 'user',
        avatarInitials: 'BO',
        costPerHour: 0,
        isDisabled: false,
        employeeType: 'internal',
        hasTopManagerRole: false,
        isAdminOnly: false,
      },
    ]);
    expect(content.workUnits).toEqual([]);
    expect(content.scope).toMatchObject({ canViewAllUsers: true, canViewWorkUnits: false });
    expect(usersListAllForAdminMock).toHaveBeenCalledTimes(1);
    expect(usersListScopedForManagerMock).not.toHaveBeenCalled();
  });

  test('tracker_all MCP viewers can load the same selector catalogs as the REST API', async () => {
    currentPermissions = ['timesheets.tracker_all.view'];

    const [clientsRes, projectsRes, tasksRes] = await Promise.all([
      rpc({
        jsonrpc: '2.0',
        id: 52,
        method: 'tools/call',
        params: { name: 'praetor_list_clients', arguments: {} },
      }),
      rpc({
        jsonrpc: '2.0',
        id: 53,
        method: 'tools/call',
        params: { name: 'praetor_list_projects', arguments: {} },
      }),
      rpc({
        jsonrpc: '2.0',
        id: 54,
        method: 'tools/call',
        params: { name: 'praetor_list_tasks', arguments: {} },
      }),
    ]);

    for (const response of [clientsRes, projectsRes, tasksRes]) {
      expect(parseMcpBody(response.body).result.isError).not.toBe(true);
    }
    expect(clientsListMock).toHaveBeenCalledWith({ canViewAllClients: false, userId: 'u1' });
    expect(projectsListForUserMock).toHaveBeenCalledWith('u1');
    expect(tasksListForUserMock).toHaveBeenCalledWith('u1');
  });

  test('does not disclose HR details through hierarchy-only permissions', async () => {
    currentPermissions = ['timesheets.tracker.view', 'hr.work_units.view'];
    usersListScopedForManagerMock.mockResolvedValue([FULL_HR_USER]);

    const res = await rpc({
      jsonrpc: '2.0',
      id: 17,
      method: 'tools/call',
      params: { name: 'praetor_get_users_hierarchy', arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expect(body.result.structuredContent.users).toEqual([
      {
        id: 'u2',
        name: 'Bob',
        username: 'bob',
        email: '',
        role: 'user',
        avatarInitials: 'BO',
        costPerHour: 0,
        isDisabled: false,
        employeeType: 'internal',
        hasTopManagerRole: false,
        isAdminOnly: false,
      },
    ]);
  });

  test('reveals MCP hierarchy HR details only for the matching employee type', async () => {
    currentPermissions = ['timesheets.tracker.view', 'hr.internal.view'];
    usersListScopedForManagerMock.mockResolvedValue([
      FULL_HR_USER,
      {
        ...FULL_HR_USER,
        id: 'u3',
        name: 'Eve',
        username: 'eve',
        employeeType: 'external',
      },
    ]);

    const res = await rpc({
      jsonrpc: '2.0',
      id: 18,
      method: 'tools/call',
      params: { name: 'praetor_get_users_hierarchy', arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    const [internalUser, externalUser] = body.result.structuredContent.users;
    expect(internalUser).toMatchObject({
      id: 'u2',
      firstName: 'Robert',
      emergencyContactName: 'Emergency Contact',
      notes: 'Private HR notes',
      email: 'bob@example.com',
      costPerHour: 0,
    });
    expect(externalUser).toEqual({
      id: 'u3',
      name: 'Eve',
      username: 'eve',
      email: '',
      role: 'user',
      avatarInitials: 'BO',
      costPerHour: 0,
      isDisabled: false,
      employeeType: 'external',
      hasTopManagerRole: false,
      isAdminOnly: false,
    });
  });

  test('hr.costs.view → caller sees own costPerHour, other rows masked', async () => {
    // Regression for the personal-scope view permission: the praetor_get_users_hierarchy
    // tool now masks costs per row. With only hr.costs.view (no hr.costs_all.view),
    // the caller's own row stays unmasked while other rows still show 0.
    currentPermissions = ['timesheets.tracker.view', 'hr.work_units.view', 'hr.costs.view'];
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
      {
        id: 'u2',
        name: 'Bob',
        username: 'bob',
        email: 'bob@example.com',
        role: 'user',
        avatarInitials: 'BO',
        costPerHour: 99,
        isDisabled: false,
        employeeType: 'app_user',
        hasTopManagerRole: false,
        isAdminOnly: false,
      },
    ]);

    const res = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'praetor_get_users_hierarchy', arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    const users = body.result.structuredContent.users as Array<{
      id: string;
      costPerHour: number;
    }>;
    const own = users.find((u) => u.id === 'u1');
    const other = users.find((u) => u.id === 'u2');
    expect(own?.costPerHour).toBe(42);
    expect(other?.costPerHour).toBe(0);
    expect(listHourlyCostsForDateMock).toHaveBeenCalledWith(['u1'], expect.any(String));
    // `scope.includesCosts` reflects the broader all-scope grant only — false here.
    expect(body.result.structuredContent.scope.includesCosts).toBe(false);
  });

  test('hr.costs_all.view (without hr.costs.view) → other rows visible, own row masked', async () => {
    // Symmetric regression for the explicit-split semantics on the MCP tool:
    // hr.costs_all.view alone is strictly cross-user and does NOT cover own
    // cost. To see every cost (including own), a role must hold BOTH grants.
    currentPermissions = ['timesheets.tracker.view', 'hr.work_units.view', 'hr.costs_all.view'];
    usersListScopedForManagerMock.mockResolvedValue([
      {
        id: 'u1', // Alice (the authenticated MCP user)
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
      {
        id: 'u2',
        name: 'Bob',
        username: 'bob',
        email: 'bob@example.com',
        role: 'user',
        avatarInitials: 'BO',
        costPerHour: 99,
        isDisabled: false,
        employeeType: 'app_user',
        hasTopManagerRole: false,
        isAdminOnly: false,
      },
    ]);

    const res = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'praetor_get_users_hierarchy', arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    const users = body.result.structuredContent.users as Array<{
      id: string;
      costPerHour: number;
    }>;
    const own = users.find((u) => u.id === 'u1');
    const other = users.find((u) => u.id === 'u2');
    expect(own?.costPerHour).toBe(0);
    expect(other?.costPerHour).toBe(99);
    expect(listHourlyCostsForDateMock).toHaveBeenCalledWith(['u2'], expect.any(String));
    // `scope.includesCosts=true` is still correct here: the meaning is "every
    // cost the response can include is included", and with hr.costs_all.view
    // every cross-user cost is unmasked. The own-row mask is the strict
    // application of "all-scope does not subsume self".
    expect(body.result.structuredContent.scope.includesCosts).toBe(true);
  });

  test('returns all users and work units when hierarchy permissions allow it', async () => {
    currentPermissions = [
      'administration.user_management_all.view',
      'hr.work_units.view',
      'hr.work_units_all.view',
      'hr.costs_all.view',
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
        members: [{ id: 'u2', name: 'Bob' }],
        isDisabled: false,
        userCount: 1,
      },
    ]);

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

  test('work_units_all alone exposes all work units just like the scoped REST guard', async () => {
    currentPermissions = ['hr.work_units_all.view'];
    workUnitsListAllMock.mockResolvedValue([
      {
        id: 'wu-all',
        name: 'Operations',
        description: 'Ops',
        managers: [{ id: 'u2', name: 'Bob' }],
        members: [{ id: 'u2', name: 'Bob' }],
        isDisabled: false,
        userCount: 1,
      },
    ]);

    const res = await rpc({
      jsonrpc: '2.0',
      id: 72,
      method: 'tools/call',
      params: { name: 'praetor_get_users_hierarchy', arguments: {} },
    });

    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content.workUnits).toEqual([expect.objectContaining({ id: 'wu-all', userIds: ['u2'] })]);
    expect(content.scope).toMatchObject({
      canViewAllWorkUnits: true,
      canViewWorkUnits: true,
    });
    expect(workUnitsListAllMock).toHaveBeenCalledTimes(1);
  });

  test('masks time-entry costs unless the MCP role grants reports.cost.view', async () => {
    const entry = {
      id: 'te-cost',
      userId: 'u1',
      date: '2026-05-11',
      clientId: 'c1',
      clientName: 'Client One',
      projectId: 'p1',
      projectName: 'Project One',
      task: 'Task One',
      taskId: 't1',
      notes: null,
      duration: 2,
      hourlyCost: 80,
      cost: 160,
      isPlaceholder: false,
      location: 'remote',
      createdAt: 1,
      version: 1,
    };
    listTimeEntriesMock.mockResolvedValue({ entries: [entry], nextCursor: null });

    const maskedRes = await rpc({
      jsonrpc: '2.0',
      id: 73,
      method: 'tools/call',
      params: { name: 'praetor_list_time_entries', arguments: {} },
    });
    const maskedEntry = parseMcpBody(maskedRes.body).result.structuredContent.entries[0];
    expect(maskedEntry).not.toHaveProperty('hourlyCost');
    expect(maskedEntry).not.toHaveProperty('cost');

    currentPermissions = ['timesheets.tracker.view', 'reports.cost.view'];
    const visibleRes = await rpc({
      jsonrpc: '2.0',
      id: 74,
      method: 'tools/call',
      params: { name: 'praetor_list_time_entries', arguments: {} },
    });
    expect(parseMcpBody(visibleRes.body).result.structuredContent.entries[0]).toMatchObject({
      hourlyCost: 80,
      cost: 160,
    });
  });

  test('masks costs returned by single and bulk time-entry writes', async () => {
    createTimeEntryMock.mockImplementation((_user, entry) =>
      Promise.resolve({
        id: `created-${entry.task}`,
        ...entry,
        hourlyCost: 80,
        cost: 80,
      }),
    );

    const singleRes = await rpc({
      jsonrpc: '2.0',
      id: 75,
      method: 'tools/call',
      params: {
        name: 'praetor_create_time_entry',
        arguments: makeCreateTimeEntryArgs('Single Cost'),
      },
    });
    const bulkRes = await rpc({
      jsonrpc: '2.0',
      id: 76,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_create_time_entries',
        arguments: { entries: [makeCreateTimeEntryArgs('Bulk Cost')] },
      },
    });

    const singleEntry = parseMcpBody(singleRes.body).result.structuredContent.entry;
    const bulkEntry = parseMcpBody(bulkRes.body).result.structuredContent.results[0].entry;
    for (const returnedEntry of [singleEntry, bulkEntry]) {
      expect(returnedEntry).not.toHaveProperty('hourlyCost');
      expect(returnedEntry).not.toHaveProperty('cost');
    }
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

  test('bulk creates time entries with partial per-item results', async () => {
    createTimeEntryMock.mockImplementationOnce((_user, entry) =>
      Promise.resolve({ id: 'te-1', ...entry }),
    );
    createTimeEntryMock.mockImplementationOnce(() =>
      Promise.reject(new realTimeEntriesService.TimeEntryServiceError(403, 'Not authorized')),
    );

    const res = await rpc({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_create_time_entries',
        arguments: {
          entries: [makeCreateTimeEntryArgs('Task One'), makeCreateTimeEntryArgs('Task Two')],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expectOneBulkSuccessAndOneFailure(body.result.structuredContent.summary);
    expect(body.result.structuredContent.results).toEqual([
      {
        index: 0,
        success: true,
        entry: { id: 'te-1', ...makeCreateTimeEntryArgs('Task One') },
      },
      { index: 1, success: false, error: 'Not authorized' },
    ]);
    expect(createTimeEntryMock).toHaveBeenCalledTimes(2);
    expect(createTimeEntryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'u1' }),
      makeCreateTimeEntryArgs('Task One'),
    );
  });

  test('keeps per-item outcomes when one bulk time-entry operation throws unexpectedly', async () => {
    createTimeEntryMock
      .mockResolvedValueOnce({ id: 'te-1', ...makeCreateTimeEntryArgs('Task One') })
      .mockRejectedValueOnce(new Error('database connection lost'))
      .mockResolvedValueOnce({ id: 'te-3', ...makeCreateTimeEntryArgs('Task Three') });

    const res = await rpc({
      jsonrpc: '2.0',
      id: 84,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_create_time_entries',
        arguments: {
          entries: [
            makeCreateTimeEntryArgs('Task One'),
            makeCreateTimeEntryArgs('Task Two'),
            makeCreateTimeEntryArgs('Task Three'),
          ],
        },
      },
    });

    const content = parseMcpBody(res.body).result.structuredContent;
    expect(content.summary).toEqual({ requested: 3, succeeded: 2, failed: 1 });
    expect(content.results).toEqual([
      expect.objectContaining({
        index: 0,
        success: true,
        entry: expect.objectContaining({ id: 'te-1' }),
      }),
      { index: 1, success: false, error: 'Unexpected internal error' },
      expect.objectContaining({
        index: 2,
        success: true,
        entry: expect.objectContaining({ id: 'te-3' }),
      }),
    ]);
  });

  test('bounds concurrent service work in bulk time-entry writes', async () => {
    let activeOperations = 0;
    let maxActiveOperations = 0;
    createTimeEntryMock.mockImplementation(async (_user, entry) => {
      activeOperations += 1;
      maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
      await Bun.sleep(10);
      activeOperations -= 1;
      return { id: `created-${entry.task}`, ...entry };
    });

    const entries = Array.from({ length: 12 }, (_, index) =>
      makeCreateTimeEntryArgs(`Task ${index}`),
    );
    const res = await rpc({
      jsonrpc: '2.0',
      id: 83,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_create_time_entries',
        arguments: { entries },
      },
    });

    expect(parseMcpBody(res.body).result.structuredContent.summary).toEqual({
      requested: 12,
      succeeded: 12,
      failed: 0,
    });
    expect(maxActiveOperations).toBeLessThanOrEqual(5);
  });

  test('bulk_create_time_entries keeps omitted notes compatible during the UI rollout', async () => {
    const { notes: _notes, ...entryWithoutNotes } = makeCreateTimeEntryArgs('Task One');
    createTimeEntryMock.mockResolvedValueOnce({ id: 'te-1', ...entryWithoutNotes });

    const res = await rpc({
      jsonrpc: '2.0',
      id: 82,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_create_time_entries',
        arguments: { entries: [entryWithoutNotes] },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(createTimeEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      entryWithoutNotes,
    );
  });

  test('bulk_create_time_entries rejects duration above 24h via Zod, never reaching the service', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 80,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_create_time_entries',
        arguments: {
          entries: [{ ...makeCreateTimeEntryArgs('Task One'), duration: 25 }],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/duration.*<=\s*24/i);
    expect(createTimeEntryMock).not.toHaveBeenCalled();
  });

  test('bulk_update_time_entries rejects duration above 24h via Zod, never reaching the service', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 81,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_update_time_entries',
        arguments: {
          entries: [{ id: 'te-1', version: 1, duration: 25 }],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/duration.*<=\s*24/i);
    expect(updateTimeEntryMock).not.toHaveBeenCalled();
  });

  test('bulk updates time entries in input order with partial per-item results', async () => {
    updateTimeEntryMock.mockImplementationOnce((_user, id, patch) =>
      Promise.resolve({ id, ...patch }),
    );
    updateTimeEntryMock.mockImplementationOnce(() =>
      Promise.reject(new realTimeEntriesService.TimeEntryServiceError(404, 'Entry not found')),
    );

    const res = await rpc({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_update_time_entries',
        arguments: {
          entries: [
            { id: 'te-1', version: 1, duration: 2, notes: 'Done' },
            { id: 'missing', version: 4, duration: 3 },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expectOneBulkSuccessAndOneFailure(body.result.structuredContent.summary);
    expect(body.result.structuredContent.results).toEqual([
      { index: 0, success: true, entry: { id: 'te-1', version: 1, duration: 2, notes: 'Done' } },
      { index: 1, success: false, error: 'Entry not found' },
    ]);
    expect(updateTimeEntryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'u1' }),
      'te-1',
      { version: 1, duration: 2, notes: 'Done' },
    );
    expect(updateTimeEntryMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'u1' }),
      'missing',
      { version: 4, duration: 3 },
    );
  });

  test('bulk deletes time entries by id with partial per-item results', async () => {
    deleteTimeEntryMock.mockImplementationOnce(() => Promise.resolve({ message: 'Entry deleted' }));
    deleteTimeEntryMock.mockImplementationOnce(() =>
      Promise.reject(new realTimeEntriesService.TimeEntryServiceError(404, 'Entry not found')),
    );

    const res = await rpc({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_delete_time_entries',
        arguments: { ids: ['te-1', 'missing'] },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expectOneBulkSuccessAndOneFailure(body.result.structuredContent.summary);
    expect(body.result.structuredContent.results).toEqual([
      { index: 0, success: true, message: 'Entry deleted' },
      { index: 1, success: false, error: 'Entry not found' },
    ]);
    expect(deleteTimeEntryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'u1' }),
      'te-1',
    );
    expect(deleteTimeEntryMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'u1' }),
      'missing',
    );
  });

  test('rejects bulk time entry batches over 100 items before calling services', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'praetor_bulk_delete_time_entries',
        arguments: { ids: Array.from({ length: 101 }, (_, index) => `te-${index}`) },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('Too big');
    expect(deleteTimeEntryMock).not.toHaveBeenCalled();
  });
});
