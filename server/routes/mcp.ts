import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { type CallToolResult, McpServer, type ServerContext } from '@modelcontextprotocol/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticateMcpToken, type McpAuthenticatedUser } from '../middleware/mcpAuth.ts';
import * as clientOffersRepo from '../repositories/clientOffersRepo.ts';
import * as clientQuotesRepo from '../repositories/clientQuotesRepo.ts';
import * as clientsOrdersRepo from '../repositories/clientsOrdersRepo.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import * as invoicesRepo from '../repositories/invoicesRepo.ts';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as projectsRepo from '../repositories/projectsRepo.ts';
import * as supplierInvoicesRepo from '../repositories/supplierInvoicesRepo.ts';
import * as supplierOrdersRepo from '../repositories/supplierOrdersRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import * as suppliersRepo from '../repositories/suppliersRepo.ts';
import * as tasksRepo from '../repositories/tasksRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import * as workUnitsRepo from '../repositories/workUnitsRepo.ts';
import {
  createTimeEntry,
  deleteTimeEntry,
  listTimeEntries,
  MAX_DURATION_HOURS,
  MAX_NOTES_LENGTH,
  TimeEntryServiceError,
  updateTimeEntry,
} from '../services/timeEntries.ts';
import { isPastLocalDate } from '../utils/date.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { normalizeUnitType } from '../utils/unit-type.ts';

const hasPermission = (user: McpAuthenticatedUser, permission: string) =>
  user.permissions.includes(permission);

const hasAnyPermission = (user: McpAuthenticatedUser, permissions: readonly string[]) =>
  permissions.some((permission) => hasPermission(user, permission));

const CLIENT_LIST_PERMISSIONS = [
  'crm.clients.view',
  'crm.clients_all.view',
  'timesheets.tracker.view',
  'timesheets.recurring.view',
  'projects.manage.view',
  'projects.tasks.view',
  'sales.client_quotes.view',
  'sales.client_offers.view',
  'accounting.clients_orders.view',
  'accounting.clients_invoices.view',
  'catalog.internal_listing.view',
  'sales.supplier_quotes.view',
  'administration.user_management.view',
  'administration.user_management.update',
] as const;

const SUPPLIER_LIST_PERMISSIONS = [
  'crm.suppliers.view',
  'crm.suppliers_all.view',
  'sales.supplier_quotes.view',
  'accounting.supplier_orders.view',
  'accounting.supplier_invoices.view',
] as const;

const PROJECT_LIST_PERMISSIONS = [
  'projects.manage.view',
  'projects.tasks.view',
  'timesheets.tracker.view',
  'timesheets.recurring.view',
] as const;

const TASK_LIST_PERMISSIONS = [
  'projects.tasks.view',
  'projects.manage.view',
  'timesheets.tracker.view',
  'timesheets.recurring.view',
] as const;

const USER_HIERARCHY_PERMISSIONS = [
  'administration.user_management.view',
  'administration.user_management_all.view',
  'hr.internal.view',
  'hr.external.view',
  'timesheets.tracker.view',
  'projects.manage.view',
  'projects.tasks.view',
  'hr.work_units.view',
] as const;

const QUOTE_LIST_PERMISSIONS = ['sales.client_quotes.view', 'sales.supplier_quotes.view'] as const;
const ORDER_LIST_PERMISSIONS = [
  'accounting.clients_orders.view',
  'accounting.supplier_orders.view',
] as const;
const INVOICE_LIST_PERMISSIONS = [
  'accounting.clients_invoices.view',
  'accounting.supplier_invoices.view',
] as const;

const MAX_BULK_TIME_ENTRY_ITEMS = 100;

const createTimeEntryInputSchema = z.object({
  date: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  task: z.string(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
  duration: z.number().nonnegative().max(MAX_DURATION_HOURS).optional(),
  isPlaceholder: z.boolean().optional(),
  userId: z.string().optional(),
  location: z.string().optional(),
});

const updateTimeEntryInputSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  duration: z.number().nonnegative().max(MAX_DURATION_HOURS).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).nullable().optional(),
  isPlaceholder: z.boolean().optional(),
  location: z.string().optional(),
});

const bulkItemsSchema = <T extends z.ZodType>(schema: T) =>
  z.array(schema).min(1).max(MAX_BULK_TIME_ENTRY_ITEMS);

const enforceAny = (
  user: McpAuthenticatedUser,
  permissions: readonly string[],
): CallToolResult | null =>
  hasAnyPermission(user, permissions) ? null : toolError('Insufficient permissions');

const textResult = (text: string, structuredContent?: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text }],
  ...(structuredContent ? { structuredContent } : {}),
});

const jsonResult = (structuredContent: Record<string, unknown>): CallToolResult =>
  textResult(JSON.stringify(structuredContent, null, 2), structuredContent);

const toolError = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});

const requireUser = (ctx: ServerContext): McpAuthenticatedUser => {
  const user = (ctx.http?.authInfo?.extra as { user?: McpAuthenticatedUser } | undefined)?.user;
  if (!user) throw new Error('MCP authentication context is missing');
  return user;
};

const enforce = (user: McpAuthenticatedUser, permission: string): CallToolResult | null =>
  hasPermission(user, permission) ? null : toolError('Insufficient permissions');

const groupBy = <T>(items: T[], getKey: (item: T) => string) => {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const list = grouped.get(key);
    if (list) list.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
};

const listIfAllowed = <T>(allowed: boolean, list: () => Promise<T[]>): Promise<T[]> =>
  allowed ? list() : Promise.resolve([]);

const isClientQuoteExpired = (status: string, expirationDate: string | null | undefined) => {
  if (status === 'confirmed') return false;
  if (!expirationDate) return false;
  return isPastLocalDate(expirationDate);
};

const normalizeSupplierQuoteStatus = (status: string) => {
  if (status === 'received') return 'sent';
  if (status === 'approved') return 'accepted';
  if (status === 'rejected') return 'denied';
  return status;
};

const canViewAllUsers = (user: McpAuthenticatedUser) =>
  hasPermission(user, 'administration.user_management_all.view') ||
  hasPermission(user, 'hr.work_units_all.view');

const canViewUserEmails = (user: McpAuthenticatedUser) =>
  hasPermission(user, 'administration.user_management_all.view') ||
  hasPermission(user, 'administration.user_management.view');

const canViewAllWorkUnits = (user: McpAuthenticatedUser) =>
  hasPermission(user, 'hr.work_units_all.view');

// Cost visibility per row — the two scopes are strictly independent:
//   - own row    → hr.costs.view       (personal-scope)
//   - other row  → hr.costs_all.view   (others-scope, intentionally does NOT subsume own)
// A role wanting to see every user's cost must hold BOTH grants.
const canViewCostFor = (user: McpAuthenticatedUser, targetUserId: string | null | undefined) => {
  if (!targetUserId) return false;
  if (targetUserId === user.id) return hasPermission(user, 'hr.costs.view');
  return hasPermission(user, 'hr.costs_all.view');
};

const maskUser = (
  user: usersRepo.UserListRow,
  options: { canViewCosts: boolean; canViewEmails: boolean },
) => ({
  ...user,
  email: options.canViewEmails ? user.email : '',
  costPerHour: options.canViewCosts ? user.costPerHour : 0,
});

const runTimeEntryTool = async (
  operation: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> => {
  try {
    return jsonResult(await operation());
  } catch (err) {
    if (err instanceof TimeEntryServiceError) return toolError(err.message);
    throw err;
  }
};

const runBulkTimeEntryTool = async <T>(
  items: T[],
  operation: (item: T) => Promise<Record<string, unknown>>,
): Promise<CallToolResult> => {
  const results: Array<Record<string, unknown>> = [];
  let succeeded = 0;

  for (const [index, item] of items.entries()) {
    try {
      results.push({ index, success: true, ...(await operation(item)) });
      succeeded += 1;
    } catch (err) {
      if (!(err instanceof TimeEntryServiceError)) throw err;
      results.push({ index, success: false, error: err.message });
    }
  }

  return jsonResult({
    summary: {
      requested: items.length,
      succeeded,
      failed: items.length - succeeded,
    },
    results,
  });
};

const buildServer = () => {
  const server = new McpServer(
    { name: 'praetor', version: '0.7.0' },
    {
      instructions:
        'Use Praetor tools to inspect and update ERP data. Tool results are scoped to the authenticated MCP token user and their current Praetor role permissions.',
    },
  );

  server.registerTool(
    'praetor_get_current_user',
    {
      title: 'Get Current User',
      description: 'Return the authenticated Praetor user and granted permissions.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      return jsonResult({ user });
    },
  );

  server.registerTool(
    'praetor_list_clients',
    {
      title: 'List Clients',
      description: 'List CRM clients visible to the authenticated user.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforceAny(user, CLIENT_LIST_PERMISSIONS);
      if (denied) return denied;
      const canViewClientDetails = hasPermission(user, 'crm.clients.view');
      const clients = await clientsRepo.list(
        hasPermission(user, 'crm.clients_all.view')
          ? { canViewAllClients: true }
          : { canViewAllClients: false, userId: user.id },
      );
      return jsonResult({
        clients: clients.map((client) =>
          canViewClientDetails ? client : { id: client.id, name: client.name, description: null },
        ),
      });
    },
  );

  server.registerTool(
    'praetor_list_suppliers',
    {
      title: 'List Suppliers',
      description: 'List suppliers visible to the authenticated user.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforceAny(user, SUPPLIER_LIST_PERMISSIONS);
      if (denied) return denied;
      const suppliers = await suppliersRepo.listAll();
      return jsonResult({ suppliers });
    },
  );

  server.registerTool(
    'praetor_list_projects',
    {
      title: 'List Projects',
      description: 'List projects visible to the authenticated user.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforceAny(user, PROJECT_LIST_PERMISSIONS);
      if (denied) return denied;
      const projects = hasPermission(user, 'projects.manage_all.view')
        ? await projectsRepo.listAll()
        : await projectsRepo.listForUser(user.id);
      return jsonResult({ projects });
    },
  );

  server.registerTool(
    'praetor_list_tasks',
    {
      title: 'List Tasks',
      description: 'List project tasks visible to the authenticated user.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforceAny(user, TASK_LIST_PERMISSIONS);
      if (denied) return denied;
      const tasks = hasPermission(user, 'projects.tasks_all.view')
        ? await tasksRepo.listAll()
        : await tasksRepo.listForUser(user.id);
      return jsonResult({ tasks });
    },
  );

  server.registerTool(
    'praetor_list_quotes',
    {
      title: 'List Quotes',
      description:
        'List client and supplier quotes visible to the authenticated user based on Praetor permissions.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforceAny(user, QUOTE_LIST_PERMISSIONS);
      if (denied) return denied;

      const canViewClientQuotes = hasPermission(user, 'sales.client_quotes.view');
      const canViewSupplierQuotes = hasPermission(user, 'sales.supplier_quotes.view');
      const [clientQuotes, clientQuoteItems, supplierQuotes, supplierQuoteItems] =
        await Promise.all([
          listIfAllowed(canViewClientQuotes, clientQuotesRepo.listAll),
          listIfAllowed(canViewClientQuotes, clientQuotesRepo.listAllItems),
          listIfAllowed(canViewSupplierQuotes, supplierQuotesRepo.listAll),
          listIfAllowed(canViewSupplierQuotes, supplierQuotesRepo.listAllItems),
        ]);

      const clientItemsByQuote = groupBy(clientQuoteItems, (item) => item.quoteId);
      const supplierItemsByQuote = groupBy(supplierQuoteItems, (item) => item.quoteId);

      return jsonResult({
        clientQuotes: clientQuotes.map((quote) => ({
          ...quote,
          items: clientItemsByQuote.get(quote.id) ?? [],
          isExpired: isClientQuoteExpired(quote.status, quote.expirationDate),
        })),
        supplierQuotes: supplierQuotes.map((quote) => ({
          ...quote,
          status: normalizeSupplierQuoteStatus(quote.status),
          items: (supplierItemsByQuote.get(quote.id) ?? []).map((item) => ({
            ...item,
            unitType: normalizeUnitType(item.unitType),
          })),
        })),
        scope: {
          includesClientQuotes: canViewClientQuotes,
          includesSupplierQuotes: canViewSupplierQuotes,
        },
      });
    },
  );

  server.registerTool(
    'praetor_list_offers',
    {
      title: 'List Offers',
      description: 'List client offers visible to the authenticated user.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforce(user, 'sales.client_offers.view');
      if (denied) return denied;

      const [offers, items] = await Promise.all([
        clientOffersRepo.listAll(),
        clientOffersRepo.listAllItems(),
      ]);
      const itemsByOffer = groupBy(items, (item) => item.offerId);

      return jsonResult({
        offers: offers.map((offer) => ({
          ...offer,
          items: itemsByOffer.get(offer.id) ?? [],
        })),
      });
    },
  );

  server.registerTool(
    'praetor_list_orders',
    {
      title: 'List Orders',
      description:
        'List client and supplier orders visible to the authenticated user based on Praetor permissions.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforceAny(user, ORDER_LIST_PERMISSIONS);
      if (denied) return denied;

      const canViewClientOrders = hasPermission(user, 'accounting.clients_orders.view');
      const canViewSupplierOrders = hasPermission(user, 'accounting.supplier_orders.view');
      const [clientOrders, clientOrderItems, supplierOrders, supplierOrderItems] =
        await Promise.all([
          listIfAllowed(canViewClientOrders, clientsOrdersRepo.listAll),
          listIfAllowed(canViewClientOrders, clientsOrdersRepo.listAllItems),
          listIfAllowed(canViewSupplierOrders, supplierOrdersRepo.listAll),
          listIfAllowed(canViewSupplierOrders, supplierOrdersRepo.listAllItems),
        ]);

      const clientItemsByOrder = groupBy(clientOrderItems, (item) => item.orderId);
      const supplierItemsByOrder = groupBy(supplierOrderItems, (item) => item.orderId);

      return jsonResult({
        clientOrders: clientOrders.map((order) => ({
          ...order,
          items: clientItemsByOrder.get(order.id) ?? [],
        })),
        supplierOrders: supplierOrders.map((order) => ({
          ...order,
          items: supplierItemsByOrder.get(order.id) ?? [],
        })),
        scope: {
          includesClientOrders: canViewClientOrders,
          includesSupplierOrders: canViewSupplierOrders,
        },
      });
    },
  );

  server.registerTool(
    'praetor_list_invoices',
    {
      title: 'List Invoices',
      description:
        'List client and supplier invoices visible to the authenticated user based on Praetor permissions.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforceAny(user, INVOICE_LIST_PERMISSIONS);
      if (denied) return denied;

      const canViewClientInvoices = hasPermission(user, 'accounting.clients_invoices.view');
      const canViewSupplierInvoices = hasPermission(user, 'accounting.supplier_invoices.view');
      const [clientInvoices, supplierInvoices, supplierInvoiceItems] = await Promise.all([
        listIfAllowed(canViewClientInvoices, invoicesRepo.listAllWithItems),
        listIfAllowed(canViewSupplierInvoices, supplierInvoicesRepo.listAll),
        listIfAllowed(canViewSupplierInvoices, supplierInvoicesRepo.listAllItems),
      ]);

      const supplierItemsByInvoice = groupBy(supplierInvoiceItems, (item) => item.invoiceId);

      return jsonResult({
        clientInvoices,
        supplierInvoices: supplierInvoices.map((invoice) => ({
          ...invoice,
          items: supplierItemsByInvoice.get(invoice.id) ?? [],
        })),
        scope: {
          includesClientInvoices: canViewClientInvoices,
          includesSupplierInvoices: canViewSupplierInvoices,
        },
      });
    },
  );

  server.registerTool(
    'praetor_get_users_hierarchy',
    {
      title: 'Get Users Hierarchy',
      description:
        'Return permission-scoped users and visible work-unit hierarchy, including managers and member user IDs.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforceAny(user, USER_HIERARCHY_PERMISSIONS);
      if (denied) return denied;

      const hasWorkUnitsView = hasPermission(user, 'hr.work_units.view');
      // `hasCostsView` reflects ONLY the cross-user grant — the truthful meaning
      // of `scope.includesCosts` below is "can the client trust every row's
      // costPerHour to be populated?". With the explicit-split semantics, a
      // caller with only `hr.costs.view` sees their own cost but no others',
      // so `includesCosts` is correctly `false` for them. Per-row masking is
      // handled by canViewCostFor inside the .map.
      const hasCostsView = hasPermission(user, 'hr.costs_all.view');
      const hasUserManagementView = hasPermission(user, 'administration.user_management.view');
      const hasAllUsersView = canViewAllUsers(user);
      const hasAllWorkUnitsView = canViewAllWorkUnits(user);
      const hasEmailView = canViewUserEmails(user);

      const users = hasAllUsersView
        ? await usersRepo.listAllForAdmin()
        : await usersRepo.listScopedForManager(user.id, {
            canViewManagedUsers:
              hasPermission(user, 'timesheets.tracker.view') ||
              hasWorkUnitsView ||
              hasUserManagementView,
            canViewInternal: hasPermission(user, 'hr.internal.view'),
            canViewExternal: hasPermission(user, 'hr.external.view'),
          });

      const visibleWorkUnits = hasWorkUnitsView
        ? hasAllWorkUnitsView
          ? await workUnitsRepo.listAll()
          : await workUnitsRepo.listManagedBy(user.id)
        : [];

      const memberRows = await workUnitsRepo.listUserIdsByUnitIds(
        visibleWorkUnits.map((unit) => unit.id),
      );
      const userIdsByWorkUnit = new Map<string, string[]>();
      for (const row of memberRows) {
        const current = userIdsByWorkUnit.get(row.workUnitId) ?? [];
        current.push(row.userId);
        userIdsByWorkUnit.set(row.workUnitId, current);
      }

      return jsonResult({
        users: users.map((entry) =>
          maskUser(entry, {
            canViewCosts: canViewCostFor(user, entry.id),
            canViewEmails: hasEmailView,
          }),
        ),
        // Drop the `members` array (id + name) carried by the work-unit shape: this tool
        // exposes only member user IDs, and member display names would bypass the per-user
        // `maskUser` scoping applied to `users` above.
        workUnits: visibleWorkUnits.map(({ members: _members, ...unit }) => ({
          ...unit,
          userIds: userIdsByWorkUnit.get(unit.id) ?? [],
        })),
        scope: {
          canViewAllUsers: hasAllUsersView,
          canViewAllWorkUnits: hasAllWorkUnitsView,
          canViewWorkUnits: hasWorkUnitsView,
          includesCosts: hasCostsView,
          includesEmails: hasEmailView,
        },
      });
    },
  );

  server.registerTool(
    'praetor_list_time_entries',
    {
      title: 'List Time Entries',
      description: 'List time entries visible to the authenticated user.',
      inputSchema: z.object({
        userId: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
        cursor: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) => {
      const user = requireUser(ctx);
      return runTimeEntryTool(async () => ({ ...(await listTimeEntries(user, args)) }));
    },
  );

  server.registerTool(
    'praetor_create_time_entry',
    {
      title: 'Create Time Entry',
      description: 'Create a time entry using the same validation and permissions as the app.',
      inputSchema: createTimeEntryInputSchema,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (args, ctx) => {
      const user = requireUser(ctx);
      return runTimeEntryTool(async () => ({ entry: await createTimeEntry(user, args) }));
    },
  );

  server.registerTool(
    'praetor_bulk_create_time_entries',
    {
      title: 'Bulk Create Time Entries',
      description:
        'Create multiple time entries with per-item results using the same validation and permissions as the app.',
      inputSchema: z.object({
        entries: bulkItemsSchema(createTimeEntryInputSchema),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ entries }, ctx) => {
      const user = requireUser(ctx);
      return runBulkTimeEntryTool(entries, async (entry) => ({
        entry: await createTimeEntry(user, entry),
      }));
    },
  );

  server.registerTool(
    'praetor_update_time_entry',
    {
      title: 'Update Time Entry',
      description:
        'Update duration, notes, placeholder state, or location for a time entry. Requires the current version from praetor_list_time_entries.',
      inputSchema: updateTimeEntryInputSchema,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ id, ...patch }, ctx) => {
      const user = requireUser(ctx);
      return runTimeEntryTool(async () => ({ entry: await updateTimeEntry(user, id, patch) }));
    },
  );

  server.registerTool(
    'praetor_bulk_update_time_entries',
    {
      title: 'Bulk Update Time Entries',
      description:
        'Update multiple time entries with per-item results using the same validation and permissions as the app. Each item must include the current version from praetor_list_time_entries.',
      inputSchema: z.object({
        entries: bulkItemsSchema(updateTimeEntryInputSchema),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ entries }, ctx) => {
      const user = requireUser(ctx);
      return runBulkTimeEntryTool(entries, async ({ id, ...patch }) => ({
        entry: await updateTimeEntry(user, id, patch),
      }));
    },
  );

  server.registerTool(
    'praetor_delete_time_entry',
    {
      title: 'Delete Time Entry',
      description: 'Delete a time entry visible to the authenticated user.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ id }, ctx) => {
      const user = requireUser(ctx);
      return runTimeEntryTool(async () => ({ ...(await deleteTimeEntry(user, id)) }));
    },
  );

  server.registerTool(
    'praetor_bulk_delete_time_entries',
    {
      title: 'Bulk Delete Time Entries',
      description:
        'Delete multiple time entries by ID with per-item results using the same permissions as the app.',
      inputSchema: z.object({ ids: bulkItemsSchema(z.string()) }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ ids }, ctx) => {
      const user = requireUser(ctx);
      return runBulkTimeEntryTool(ids, async (id) => ({ ...(await deleteTimeEntry(user, id)) }));
    },
  );

  server.registerTool(
    'praetor_list_notifications',
    {
      title: 'List Notifications',
      description: 'List notifications for the authenticated user.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforce(user, 'notifications.view');
      if (denied) return denied;
      const [notifications, unreadCount] = await Promise.all([
        notificationsRepo.listForUser(user.id),
        notificationsRepo.countUnreadForUser(user.id),
      ]);
      return jsonResult({ notifications, unreadCount });
    },
  );

  server.registerTool(
    'praetor_mark_notification_read',
    {
      title: 'Mark Notification Read',
      description: 'Mark one notification as read for the authenticated user.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id }, ctx) => {
      const user = requireUser(ctx);
      const denied = enforce(user, 'notifications.update');
      if (denied) return denied;
      const found = await notificationsRepo.markReadForUser(id, user.id);
      if (!found) return toolError('Notification not found');
      return jsonResult({ success: true });
    },
  );

  server.registerTool(
    'praetor_delete_notification',
    {
      title: 'Delete Notification',
      description: 'Delete one notification for the authenticated user.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ id }, ctx) => {
      const user = requireUser(ctx);
      const denied = enforce(user, 'notifications.delete');
      if (denied) return denied;
      const found = await notificationsRepo.deleteForUser(id, user.id);
      if (!found) return toolError('Notification not found');
      return jsonResult({ success: true });
    },
  );

  return server;
};

const sendMethodNotAllowed = (reply: FastifyReply) =>
  reply.code(405).send({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed' },
    id: null,
  });

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.post(
    '/',
    {
      onRequest: [fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT), authenticateMcpToken],
      schema: {
        hide: true,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const socket = request.raw.socket as typeof request.raw.socket & {
        destroySoon?: () => void;
      };
      if (socket && typeof socket.destroySoon !== 'function') {
        socket.destroySoon = () => {
          if (!socket.destroyed && typeof socket.destroy === 'function') socket.destroy();
        };
      }

      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const mcpServer = buildServer();
      await mcpServer.connect(transport);
      reply.raw.on('close', () => {
        void transport.close().catch((err) => {
          request.log.warn({ err }, 'Failed to close MCP transport');
        });
      });
      await transport.handleRequest(request.raw, reply.raw, request.body);
    },
  );

  fastify.get('/', { schema: { hide: true } }, async (_request, reply) =>
    sendMethodNotAllowed(reply),
  );
  fastify.delete('/', { schema: { hide: true } }, async (_request, reply) =>
    sendMethodNotAllowed(reply),
  );
}
