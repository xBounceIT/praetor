import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { type CallToolResult, McpServer, type ServerContext } from '@modelcontextprotocol/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  authenticateMcpToken,
  type McpAuthenticatedUser,
  type McpAuthInfoExtra,
} from '../middleware/mcpAuth.ts';
import * as clientOffersRepo from '../repositories/clientOffersRepo.ts';
import * as clientQuotesRepo from '../repositories/clientQuotesRepo.ts';
import * as clientsOrdersRepo from '../repositories/clientsOrdersRepo.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import type { TimeEntry } from '../repositories/entriesRepo.ts';
import * as invoicesRepo from '../repositories/invoicesRepo.ts';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as projectsRepo from '../repositories/projectsRepo.ts';
import * as supplierInvoicesRepo from '../repositories/supplierInvoicesRepo.ts';
import * as supplierOrdersRepo from '../repositories/supplierOrdersRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import * as suppliersRepo from '../repositories/suppliersRepo.ts';
import * as tasksRepo from '../repositories/tasksRepo.ts';
import * as userHourlyCostPeriodsRepo from '../repositories/userHourlyCostPeriodsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import * as workUnitsRepo from '../repositories/workUnitsRepo.ts';
import {
  createTimeEntry,
  deleteTimeEntry,
  listTimeEntries,
  MAX_DURATION_HOURS,
  MAX_NOTES_LENGTH,
  sanitizeTimeEntryCosts,
  TimeEntryServiceError,
  updateTimeEntry,
} from '../services/timeEntries.ts';
import {
  canViewAllUsersWithPermissions,
  canViewUserEmailWithPermissions,
  HR_VIEW_PERMISSION_BY_EMPLOYEE_TYPE,
  maskUserResponse,
} from '../services/userVisibility.ts';
import { APP_VERSION } from '../utils/app-version.ts';
import { mapWithConcurrency } from '../utils/concurrency.ts';
import { todayLocalDateOnly } from '../utils/date.ts';
import { createChildLogger, serializeError } from '../utils/logger.ts';
import { canViewProjectDetails, equivalentPermissionsFor } from '../utils/permissions.ts';
import {
  effectiveQuoteStatusFromDate,
  effectiveSupplierQuoteStatusFromDate,
} from '../utils/quote-status.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { normalizeUnitType } from '../utils/unit-type.ts';

const mcpLogger = createChildLogger({ module: 'mcp' });

const hasPermission = (user: McpAuthenticatedUser, permission: string) =>
  user.permissions.includes(permission);

const hasAnyPermission = (user: McpAuthenticatedUser, permissions: readonly string[]) =>
  permissions.some((permission) => hasPermission(user, permission));

const CLIENT_LIST_PERMISSIONS = [
  'crm.clients.view',
  'crm.clients_all.view',
  'timesheets.tracker.view',
  'timesheets.tracker_all.view',
  'timesheets.recurring.view',
  'projects.manage.view',
  'projects.manage_all.view',
  'projects.tasks.view',
  'projects.tasks_all.view',
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
  ...equivalentPermissionsFor('projects.manage', 'view'),
  ...equivalentPermissionsFor('projects.tasks', 'view'),
  ...equivalentPermissionsFor('timesheets.tracker', 'view'),
  'timesheets.ril.view',
  'timesheets.recurring.view',
] as const;

const TASK_LIST_PERMISSIONS = [
  ...equivalentPermissionsFor('projects.tasks', 'view'),
  ...equivalentPermissionsFor('projects.manage', 'view'),
  ...equivalentPermissionsFor('timesheets.tracker', 'view'),
  'timesheets.recurring.view',
] as const;

const USER_HIERARCHY_PERMISSIONS = [
  'administration.user_management.view',
  'administration.user_management_all.view',
  'hr.internal.view',
  'hr.external.view',
  ...equivalentPermissionsFor('timesheets.tracker', 'view'),
  'timesheets.ril.view',
  'timesheets.recurring.view',
  ...equivalentPermissionsFor('projects.manage', 'view'),
  ...equivalentPermissionsFor('projects.tasks', 'view'),
  ...equivalentPermissionsFor('hr.work_units', 'view'),
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
const MAX_BULK_API_REQUESTS = 25;
const MAX_BULK_CONCURRENCY = 5;
const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BULK_API_RESPONSE_BYTES = 4 * 1024 * 1024;
const API_RESPONSE_HEADERS = [
  'content-disposition',
  'content-type',
  'etag',
  'last-modified',
  'location',
  'retry-after',
] as const;

const queryPrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);
const querySchema = z
  .record(
    z.string().min(1).max(128),
    z.union([queryPrimitiveSchema, z.array(queryPrimitiveSchema).max(100)]),
  )
  .optional();

const decodeApiPath = (path: string): string | null => {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
};

const isSafeApiPath = (path: string): boolean => {
  const decoded = decodeApiPath(path);
  if (!decoded?.startsWith('/api/') || /[?#\\]/.test(decoded)) return false;
  if (/%(?:2f|5c)/i.test(path) || /%(?:2f|5c)/i.test(decoded)) return false;
  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) return false;
  return !/^\/api\/(?:auth|mcp)(?:\/|$)/i.test(decoded);
};

const apiPathSchema = z
  .string()
  .trim()
  .min(6)
  .max(2_048)
  .refine((path) => path.startsWith('/api/'), 'Path must start with /api/')
  .refine((path) => !/[?#\\]/.test(path), 'Put query parameters in the query object')
  .refine(
    isSafeApiPath,
    'Encoded separators, path traversal, authentication endpoints, and MCP endpoints are not allowed',
  );

const retrieveRequestSchema = z.object({
  requestId: z.string().min(1).max(128).optional(),
  path: apiPathSchema,
  query: querySchema,
});

const mutationRequestSchema = z.object({
  requestId: z.string().min(1).max(128).optional(),
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  path: apiPathSchema,
  query: querySchema,
  body: z.unknown().optional(),
});

type RetrieveRequest = z.infer<typeof retrieveRequestSchema>;
type MutationRequest = z.infer<typeof mutationRequestSchema>;
type ApiGatewayRequest = RetrieveRequest & {
  method: 'GET' | MutationRequest['method'];
  body?: unknown;
};

type ApiGatewayResponse = {
  ok: boolean;
  status: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  encoding?: 'base64';
  bodyTruncated?: true;
  originalBodyBytes?: number;
};

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

const sanitizeTimeEntryForUser = (user: McpAuthenticatedUser, entry: TimeEntry) =>
  sanitizeTimeEntryCosts(entry, hasPermission(user, 'reports.cost.view'));

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
  const results = await mapWithConcurrency(
    items,
    MAX_BULK_CONCURRENCY,
    async (item, index): Promise<Record<string, unknown>> => {
      try {
        return { index, success: true, ...(await operation(item)) };
      } catch (err) {
        if (err instanceof TimeEntryServiceError) {
          return { index, success: false, error: err.message };
        }
        mcpLogger.error(
          { err: serializeError(err), index },
          'Unexpected failure in MCP bulk time-entry operation',
        );
        return { index, success: false, error: 'Unexpected internal error' };
      }
    },
  );
  const succeeded = results.filter((result) => result.success).length;

  return jsonResult({
    summary: {
      requested: items.length,
      succeeded,
      failed: items.length - succeeded,
    },
    results,
  });
};

const requireMcpAuth = (
  ctx: ServerContext,
): {
  clientIp: string;
  rawToken: string;
  tokenScope: McpAuthInfoExtra['tokenScope'];
} => {
  const authInfo = ctx.http?.authInfo;
  const extra = authInfo?.extra as McpAuthInfoExtra | undefined;
  if (!authInfo?.token || !extra?.clientIp || !extra.tokenScope) {
    throw new Error('MCP authentication context is missing');
  }
  return { clientIp: extra.clientIp, rawToken: authInfo.token, tokenScope: extra.tokenScope };
};

const buildApiUrl = (path: string, query: RetrieveRequest['query']): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) params.append(key, String(item));
  }
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
};

const runApiRequest = async (
  fastify: FastifyInstance,
  rawToken: string,
  clientIp: string,
  request: ApiGatewayRequest,
): Promise<{ response: ApiGatewayResponse; bodyBytes: number }> => {
  const response = await fastify.inject({
    method: request.method,
    url: buildApiUrl(request.path, request.query),
    remoteAddress: clientIp,
    headers: {
      authorization: `Bearer ${rawToken}`,
      accept: 'application/json, text/plain, */*',
      ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(request.body === undefined ? {} : { payload: JSON.stringify(request.body) }),
  });

  const headers = Object.fromEntries(
    API_RESPONSE_HEADERS.flatMap((name) => {
      const value = response.headers[name];
      return value === undefined ? [] : [[name, value] as const];
    }),
  );
  const ok = response.statusCode >= 200 && response.statusCode < 300;

  if (response.rawPayload.byteLength > MAX_API_RESPONSE_BYTES) {
    const body = {
      warning: `API response body omitted because it exceeds the ${MAX_API_RESPONSE_BYTES}-byte MCP limit; narrow retrievals with route filters or pagination`,
      targetRequestSucceeded: ok,
    };
    return {
      response: {
        ok,
        status: response.statusCode,
        headers,
        body,
        bodyTruncated: true,
        originalBodyBytes: response.rawPayload.byteLength,
      },
      bodyBytes: Buffer.byteLength(JSON.stringify(body)),
    };
  }

  const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
  let body: unknown;
  let encoding: ApiGatewayResponse['encoding'];

  if (response.rawPayload.byteLength === 0) {
    body = null;
  } else if (contentType.includes('json')) {
    try {
      body = response.body ? JSON.parse(response.body) : null;
    } catch {
      body = response.body;
    }
  } else if (contentType.startsWith('text/') || contentType.includes('xml')) {
    body = response.body;
  } else {
    body = response.rawPayload.toString('base64');
    encoding = 'base64';
  }

  return {
    response: {
      ok,
      status: response.statusCode,
      headers,
      body,
      ...(encoding ? { encoding } : {}),
    },
    bodyBytes: Buffer.byteLength(typeof body === 'string' ? body : (JSON.stringify(body) ?? '')),
  };
};

const runBulkApiRequests = async (
  fastify: FastifyInstance,
  rawToken: string,
  clientIp: string,
  requests: ApiGatewayRequest[],
): Promise<CallToolResult> => {
  const executed = await mapWithConcurrency(
    requests,
    MAX_BULK_CONCURRENCY,
    async (request, index) => ({
      index,
      request,
      ...(await runApiRequest(fastify, rawToken, clientIp, request)),
    }),
  );
  let retainedBodyBytes = 0;
  const results = executed.map(({ index, request, response, bodyBytes }) => {
    const exceedsBulkLimit =
      !response.bodyTruncated && retainedBodyBytes + bodyBytes > MAX_BULK_API_RESPONSE_BYTES;
    if (!exceedsBulkLimit) retainedBodyBytes += bodyBytes;

    const boundedResponse: ApiGatewayResponse = exceedsBulkLimit
      ? {
          ok: response.ok,
          status: response.status,
          headers: response.headers,
          body: {
            warning: `API response body omitted because the batch exceeds the ${MAX_BULK_API_RESPONSE_BYTES}-byte aggregate MCP limit; split the batch or narrow retrievals`,
            targetRequestSucceeded: response.ok,
          },
          bodyTruncated: true,
          originalBodyBytes: bodyBytes,
        }
      : response;

    return {
      index,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      ...boundedResponse,
    };
  });
  const succeeded = results.filter((result) => result.ok).length;
  return jsonResult({
    summary: {
      requested: requests.length,
      succeeded,
      failed: requests.length - succeeded,
    },
    results,
  });
};

type OpenApiOperation = {
  description?: string;
  operationId?: string;
  summary?: string;
  tags?: string[];
};

type OpenApiDocument = {
  paths?: Record<string, Partial<Record<string, OpenApiOperation>>>;
};

const listApiOperations = (
  fastify: FastifyInstance,
  options: { limit: number; offset: number; search?: string },
) => {
  if (typeof fastify.swagger !== 'function') throw new Error('OpenAPI catalog is unavailable');

  const search = options.search?.trim().toLowerCase();
  const spec = fastify.swagger() as unknown as OpenApiDocument;
  const operations = Object.entries(spec.paths ?? {}).flatMap(([path, pathItem]) => {
    if (/^\/api\/(?:auth|mcp)(?:\/|$)/i.test(path)) return [];
    return Object.entries(pathItem as Partial<Record<string, OpenApiOperation>>).flatMap(
      ([method, operation]) => {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) || !operation) return [];
        const item = {
          method: method.toUpperCase(),
          path,
          ...(operation.operationId ? { operationId: operation.operationId } : {}),
          ...(operation.summary ? { summary: operation.summary } : {}),
          ...(operation.description ? { description: operation.description } : {}),
          ...(operation.tags ? { tags: operation.tags } : {}),
        };
        if (search && !JSON.stringify(item).toLowerCase().includes(search)) return [];
        return [item];
      },
    );
  });

  return {
    total: operations.length,
    offset: options.offset,
    limit: options.limit,
    operations: operations.slice(options.offset, options.offset + options.limit),
  };
};

const buildServer = (fastify: FastifyInstance) => {
  const server = new McpServer(
    { name: 'praetor', version: APP_VERSION },
    {
      instructions:
        'Use Praetor tools to inspect and update ERP data. Tool results are scoped to the authenticated MCP token user and their current Praetor role permissions. Use praetor_list_api_operations to discover additional REST capabilities, praetor_retrieve for GET operations, and praetor_mutate only for explicitly requested writes.',
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
    'praetor_list_api_operations',
    {
      title: 'List API Operations',
      description:
        'Discover Praetor REST operations that can be called through the generic MCP retrieval and mutation tools. Actual access is always decided by the target route using the current token permissions.',
      inputSchema: z.object({
        search: z.string().max(200).optional(),
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().positive().max(500).default(100),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) => {
      const user = requireUser(ctx);
      try {
        return jsonResult({
          ...listApiOperations(fastify, args),
          grantedPermissions: user.permissions,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'OpenAPI catalog is unavailable');
      }
    },
  );

  server.registerTool(
    'praetor_retrieve',
    {
      title: 'Retrieve API Data',
      description:
        'Call any JSON, text, or file GET route under /api using the authenticated MCP token. The target route applies the same permission and row-scope checks as the Praetor app.',
      inputSchema: retrieveRequestSchema,
      annotations: { readOnlyHint: true },
    },
    async (request, ctx) => {
      const { clientIp, rawToken } = requireMcpAuth(ctx);
      return jsonResult({
        ...(request.requestId ? { requestId: request.requestId } : {}),
        ...(await runApiRequest(fastify, rawToken, clientIp, { ...request, method: 'GET' }))
          .response,
      });
    },
  );

  server.registerTool(
    'praetor_bulk_retrieve',
    {
      title: 'Bulk Retrieve API Data',
      description:
        'Call up to 25 GET routes in one MCP request. Results preserve input order and report success or failure independently for each retrieval.',
      inputSchema: z.object({
        requests: z.array(retrieveRequestSchema).min(1).max(MAX_BULK_API_REQUESTS),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ requests }, ctx) => {
      const { clientIp, rawToken } = requireMcpAuth(ctx);
      return runBulkApiRequests(
        fastify,
        rawToken,
        clientIp,
        requests.map((request) => ({ ...request, method: 'GET' })),
      );
    },
  );

  server.registerTool(
    'praetor_mutate',
    {
      title: 'Mutate API Data',
      description:
        'Call any POST, PUT, PATCH, or DELETE route under /api using the authenticated full-access MCP token. The target route remains authoritative for permissions, validation, row scope, audit logging, and conflicts.',
      inputSchema: mutationRequestSchema,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (request, ctx) => {
      const { clientIp, rawToken, tokenScope } = requireMcpAuth(ctx);
      if (tokenScope === 'read_only') return toolError('MCP token is read-only');
      return jsonResult({
        ...(request.requestId ? { requestId: request.requestId } : {}),
        ...(await runApiRequest(fastify, rawToken, clientIp, request)).response,
      });
    },
  );

  server.registerTool(
    'praetor_bulk_mutate',
    {
      title: 'Bulk Mutate API Data',
      description:
        'Call up to 25 POST, PUT, PATCH, or DELETE routes in one MCP request. Results preserve input order and report success or failure independently; the batch is not transactional.',
      inputSchema: z.object({
        requests: z.array(mutationRequestSchema).min(1).max(MAX_BULK_API_REQUESTS),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ requests }, ctx) => {
      const { clientIp, rawToken, tokenScope } = requireMcpAuth(ctx);
      if (tokenScope === 'read_only') return toolError('MCP token is read-only');
      return runBulkApiRequests(fastify, rawToken, clientIp, requests);
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
      description:
        'List suppliers visible to the authenticated user. Full details require crm.suppliers_all.view; other authorized callers receive selector fields only.',
      annotations: { readOnlyHint: true },
    },
    async (ctx) => {
      const user = requireUser(ctx);
      const denied = enforceAny(user, SUPPLIER_LIST_PERMISSIONS);
      if (denied) return denied;
      const suppliers = hasPermission(user, 'crm.suppliers_all.view')
        ? await suppliersRepo.listAll()
        : await suppliersRepo.listOptions();
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
      const visibleProjects = canViewProjectDetails(user.permissions)
        ? projects
        : projects.map(projectsRepo.toProjectSummary);
      return jsonResult({ projects: visibleProjects });
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
        clientQuotes: clientQuotes.map((quote) => {
          const effectiveStatus = effectiveQuoteStatusFromDate(quote.status, quote.expirationDate);
          return {
            ...quote,
            items: clientItemsByQuote.get(quote.id) ?? [],
            effectiveStatus,
            isExpired: effectiveStatus === 'expired',
          };
        }),
        supplierQuotes: supplierQuotes.map((quote) => ({
          ...quote,
          // Fully derived status (issue #779): unlinked → draft; linked → follows the client
          // quote/offer chain, with the expiry overlays.
          status: effectiveSupplierQuoteStatusFromDate({
            expirationDate: quote.expirationDate,
            linkedClientStatus: quote.linkedClientQuoteStatus,
            linkedClientQuoteExpiration: quote.linkedClientQuoteExpiration,
            linkedOfferStatus: quote.linkedOfferStatus,
            linkedOfferExpiration: quote.linkedOfferExpiration,
          }),
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
          // Derived #779 status: `expired` overrides draft/sent once the expiration date has
          // passed; accepted/denied are frozen and never expire.
          effectiveStatus: effectiveQuoteStatusFromDate(offer.status, offer.expirationDate),
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
      const [clientInvoices, supplierInvoices] = await Promise.all([
        listIfAllowed(canViewClientInvoices, invoicesRepo.listAllWithItems),
        listIfAllowed(canViewSupplierInvoices, supplierInvoicesRepo.listAllWithItems),
      ]);

      return jsonResult({
        clientInvoices,
        supplierInvoices,
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

      const hasWorkUnitsView = hasAnyPermission(
        user,
        equivalentPermissionsFor('hr.work_units', 'view'),
      );
      // `hasCostsView` reflects ONLY the cross-user grant — the truthful meaning
      // of `scope.includesCosts` below is "can the client trust every row's
      // costPerHour to be populated?". With the explicit-split semantics, a
      // caller with only `hr.costs.view` sees their own cost but no others',
      // so `includesCosts` is correctly `false` for them. Per-row masking is
      // handled by canViewCostFor inside the .map.
      const hasCostsView = hasPermission(user, 'hr.costs_all.view');
      const hasUserManagementView = hasPermission(user, 'administration.user_management.view');
      const hasAllUsersView = canViewAllUsersWithPermissions(user.permissions);
      const hasAllWorkUnitsView = canViewAllWorkUnits(user);
      const hasAllEmailView =
        hasPermission(user, 'administration.user_management_all.view') ||
        hasPermission(user, 'administration.user_management.view');

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

      const visibleCostUserIds = users.reduce<string[]>((ids, entry) => {
        if (canViewCostFor(user, entry.id)) ids.push(entry.id);
        return ids;
      }, []);
      const currentCosts = await userHourlyCostPeriodsRepo.listCostsForDate(
        visibleCostUserIds,
        todayLocalDateOnly(),
      );
      const visibleWorkUnits = hasWorkUnitsView
        ? hasAllWorkUnitsView
          ? await workUnitsRepo.listAll()
          : await workUnitsRepo.listManagedBy(user.id)
        : [];

      return jsonResult({
        users: users.map((entry) =>
          maskUserResponse(
            { ...entry, costPerHour: currentCosts.get(entry.id) ?? entry.costPerHour },
            {
              canViewCosts: canViewCostFor(user, entry.id),
              canViewEmails: canViewUserEmailWithPermissions(user.permissions, entry.employeeType),
              canViewHrDetails: hasPermission(
                user,
                HR_VIEW_PERMISSION_BY_EMPLOYEE_TYPE[entry.employeeType],
              ),
            },
          ),
        ),
        // Expose only member user IDs, derived from the members the repo already returns
        // (no second user_work_units query). The member display names are deliberately
        // dropped here — they would bypass the per-user `maskUserResponse` scoping applied to
        // `users` above.
        workUnits: visibleWorkUnits.map(({ members, ...unit }) => ({
          ...unit,
          userIds: members.map((member) => member.id),
        })),
        scope: {
          canViewAllUsers: hasAllUsersView,
          canViewAllWorkUnits: hasAllWorkUnitsView,
          canViewWorkUnits: hasWorkUnitsView,
          includesCosts: hasCostsView,
          includesEmails: hasAllEmailView,
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
      return runTimeEntryTool(async () => {
        const result = await listTimeEntries(user, args);
        return {
          ...result,
          entries: result.entries.map((entry) => sanitizeTimeEntryForUser(user, entry)),
        };
      });
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
      return runTimeEntryTool(async () => ({
        entry: sanitizeTimeEntryForUser(user, await createTimeEntry(user, args)),
      }));
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
        entry: sanitizeTimeEntryForUser(user, await createTimeEntry(user, entry)),
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
      return runTimeEntryTool(async () => ({
        entry: sanitizeTimeEntryForUser(user, await updateTimeEntry(user, id, patch)),
      }));
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
        entry: sanitizeTimeEntryForUser(user, await updateTimeEntry(user, id, patch)),
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
      const mcpServer = buildServer(fastify);
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
