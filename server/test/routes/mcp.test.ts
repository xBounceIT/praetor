import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
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
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';
import * as realTimeEntriesService from '../../services/timeEntries.ts';
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
const supplierInvoicesListAllMock = mock();
const supplierInvoicesListAllItemsMock = mock();
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
  }));
  mock.module('../../repositories/supplierInvoicesRepo.ts', () => ({
    ...supplierInvoicesRepoSnap,
    listAll: supplierInvoicesListAllMock,
    listAllItems: supplierInvoicesListAllItemsMock,
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
    supplierInvoicesListAllMock,
    supplierInvoicesListAllItemsMock,
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
  ]) {
    m.mockReset();
  }

  currentPermissions = ['timesheets.tracker.view'];
  clientOffersListAllMock.mockResolvedValue([]);
  clientOffersListAllItemsMock.mockResolvedValue([]);
  clientQuotesListAllMock.mockResolvedValue([]);
  clientQuotesListAllItemsMock.mockResolvedValue([]);
  clientsListMock.mockResolvedValue([{ id: 'c1', name: 'Client One', description: 'Private' }]);
  clientsOrdersListAllMock.mockResolvedValue([]);
  clientsOrdersListAllItemsMock.mockResolvedValue([]);
  invoicesListAllWithItemsMock.mockResolvedValue([]);
  suppliersListAllMock.mockResolvedValue([]);
  supplierInvoicesListAllMock.mockResolvedValue([]);
  supplierInvoicesListAllItemsMock.mockResolvedValue([]);
  supplierOrdersListAllMock.mockResolvedValue([]);
  supplierOrdersListAllItemsMock.mockResolvedValue([]);
  supplierQuotesListAllMock.mockResolvedValue([]);
  supplierQuotesListAllItemsMock.mockResolvedValue([]);
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
  listTimeEntriesMock.mockResolvedValue({ entries: [], nextCursor: null });
  createTimeEntryMock.mockImplementation((_user, entry) =>
    Promise.resolve({ id: `created-${entry.task}`, ...entry }),
  );
  updateTimeEntryMock.mockImplementation((_user, id, patch) => Promise.resolve({ id, ...patch }));
  deleteTimeEntryMock.mockResolvedValue({ message: 'Entry deleted' });

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

const makeCreateTimeEntryArgs = (task: string) => ({
  date: '2026-05-11',
  clientId: 'c1',
  clientName: 'Client One',
  projectId: 'p1',
  projectName: 'Project One',
  task,
  duration: 1,
});

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
    expect(body.result.serverInfo).toEqual({ name: 'praetor', version: '0.6.3' });
  });

  test('lists tools and calls permission-scoped list tools', async () => {
    const toolsRes = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(toolsRes.statusCode).toBe(200);
    const toolsBody = parseMcpBody(toolsRes.body);
    const toolNames = toolsBody.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain('praetor_list_clients');
    expect(toolNames).toContain('praetor_get_users_hierarchy');
    expect(toolNames).toContain('praetor_list_quotes');
    expect(toolNames).toContain('praetor_list_offers');
    expect(toolNames).toContain('praetor_list_orders');
    expect(toolNames).toContain('praetor_list_invoices');
    expect(toolNames).toContain('praetor_bulk_create_time_entries');
    expect(toolNames).toContain('praetor_bulk_update_time_entries');
    expect(toolNames).toContain('praetor_bulk_delete_time_entries');
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
    supplierQuotesListAllMock.mockResolvedValue([
      { id: 'sq-1', supplierId: 's1', supplierName: 'Supplier One', status: 'received' },
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
    supplierInvoicesListAllMock.mockResolvedValue([{ id: 'sinv-1', supplierId: 's1' }]);
    supplierInvoicesListAllItemsMock.mockResolvedValue([{ id: 'sinvi-1', invoiceId: 'sinv-1' }]);

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
            { id: 'te-1', duration: 2, notes: 'Done' },
            { id: 'missing', duration: 3 },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = parseMcpBody(res.body);
    expectOneBulkSuccessAndOneFailure(body.result.structuredContent.summary);
    expect(body.result.structuredContent.results).toEqual([
      { index: 0, success: true, entry: { id: 'te-1', duration: 2, notes: 'Done' } },
      { index: 1, success: false, error: 'Entry not found' },
    ]);
    expect(updateTimeEntryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'u1' }),
      'te-1',
      { duration: 2, notes: 'Done' },
    );
    expect(updateTimeEntryMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'u1' }),
      'missing',
      { duration: 3 },
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
