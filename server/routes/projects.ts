import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import {
  authenticateToken,
  requireAnyPermission,
  requirePermission,
  requireScopedPermission,
} from '../middleware/auth.ts';
import * as clientOffersRepo from '../repositories/clientOffersRepo.ts';
import * as clientsOrdersRepo from '../repositories/clientsOrdersRepo.ts';
import * as projectsRepo from '../repositories/projectsRepo.ts';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import * as workUnitsRepo from '../repositories/workUnitsRepo.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import { deriveToggleAction, getAuditChangedFields, logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import {
  BILLING_FREQUENCIES,
  BILLING_TYPES,
  DEFAULT_BILLING_TYPE,
  normalizeBillingFrequency,
  STORED_BILLING_TYPES,
} from '../utils/billing.ts';
import { ForeignKeyError, NotFoundError } from '../utils/http-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { requestHasPermission as hasPermission, makeAccessChecker } from '../utils/permissions.ts';
import { PROJECT_STATUSES } from '../utils/projectStatus.ts';
import { PROJECT_TIPOS } from '../utils/projectTipo.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import {
  badRequest,
  ensureArrayOfStrings,
  forbidden,
  optionalDateString,
  optionalEnum,
  optionalNonEmptyString,
  optionalNonNegativeNumber,
  parseDateString,
  requireNonEmptyString,
  validateEnum,
} from '../utils/validation.ts';

const userIdsSchema = {
  type: 'object',
  properties: {
    userIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['userIds'],
} as const;

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const projectsListQuerySchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
  },
} as const;

const projectSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    clientId: { type: 'string' },
    description: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
    createdAt: { type: 'number' },
    orderId: { type: ['string', 'null'] },
    offerId: { type: ['string', 'null'] },
    startDate: { type: ['string', 'null'] },
    endDate: { type: ['string', 'null'] },
    revenue: { type: ['number', 'null'] },
    billingType: { type: 'string', enum: BILLING_TYPES },
    billingFrequency: { type: 'string', enum: BILLING_FREQUENCIES },
    status: { type: 'string', enum: PROJECT_STATUSES },
    tipo: { type: 'string', enum: PROJECT_TIPOS },
    tipoConfirmed: { type: 'boolean' },
  },
  required: [
    'id',
    'name',
    'clientId',
    'isDisabled',
    'billingType',
    'billingFrequency',
    'status',
    'tipo',
    'tipoConfirmed',
  ],
} as const;

const projectOrderOptionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    status: { type: 'string' },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
  },
  required: ['id', 'clientId', 'clientName', 'status', 'createdAt', 'updatedAt'],
} as const;

const rilProjectCatalogItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    orderId: { type: ['string', 'null'] },
  },
  required: ['id', 'name', 'orderId'],
} as const;

const projectCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    clientId: { type: 'string' },
    description: { type: ['string', 'null'] },
    orderId: { type: 'string' },
    offerId: { type: ['string', 'null'] },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    revenue: { type: ['number', 'null'] },
    billingType: { type: 'string', enum: STORED_BILLING_TYPES },
    billingFrequency: { type: 'string', enum: BILLING_FREQUENCIES },
    status: { type: 'string', enum: PROJECT_STATUSES },
    tipo: { type: 'string', enum: PROJECT_TIPOS },
  },
  required: ['name', 'clientId', 'orderId', 'startDate', 'endDate', 'tipo'],
} as const;

const projectUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    clientId: { type: 'string' },
    description: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
    orderId: { type: ['string', 'null'] },
    offerId: { type: ['string', 'null'] },
    startDate: { type: ['string', 'null'] },
    endDate: { type: ['string', 'null'] },
    revenue: { type: ['number', 'null'] },
    billingType: { type: 'string', enum: STORED_BILLING_TYPES },
    billingFrequency: { type: 'string', enum: BILLING_FREQUENCIES },
    status: { type: 'string', enum: PROJECT_STATUSES },
    tipo: { type: 'string', enum: PROJECT_TIPOS },
  },
} as const;

class PermissionError extends Error {}
class OrderRequiredError extends Error {}
class OrderClientMismatchError extends Error {}
class OrderStatusError extends Error {}
class OfferClientMismatchError extends Error {}
class DateRangeError extends Error {}

const canAccessClient = makeAccessChecker(
  (userId, clientId) => userAssignmentsRepo.isClientAssignedToUser(userId, clientId),
  'crm.clients_all.view',
);

const canAccessProject = makeAccessChecker(
  (userId, projectId) => userAssignmentsRepo.isProjectAssignedToUser(userId, projectId),
  'projects.manage_all.view',
);

const canListProjectsForTargetUser = async (
  request: FastifyRequest,
  targetUserId: string,
): Promise<boolean> => {
  const actorId = request.user?.id;
  if (!actorId) return false;
  if (
    targetUserId === actorId ||
    hasPermission(request, 'projects.manage_all.view') ||
    hasPermission(request, 'timesheets.tracker_all.view')
  ) {
    return true;
  }
  return workUnitsRepo.isUserManagedBy(actorId, targetUserId);
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List all projects
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireAnyPermission(
          'projects.manage.view',
          'projects.manage_all.view',
          'projects.tasks.view',
          'projects.tasks_all.view',
          'timesheets.tracker.view',
          'timesheets.tracker_all.view',
          'timesheets.ril.view',
          'timesheets.recurring.view',
        ),
      ],
      schema: {
        tags: ['projects'],
        summary: 'List projects',
        querystring: projectsListQuerySchema,
        response: {
          200: { type: 'array', items: projectSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const canViewAll = hasPermission(request, 'projects.manage_all.view');
      const query = request.query as { userId?: unknown };
      const targetUserIdResult = optionalNonEmptyString(query.userId, 'userId');
      if (!targetUserIdResult.ok) return badRequest(reply, targetUserIdResult.message);

      const targetUserId = targetUserIdResult.value;
      if (targetUserId) {
        if (!(await canListProjectsForTargetUser(request, targetUserId))) {
          return forbidden(reply, 'Insufficient permissions');
        }
        return projectsRepo.listForUser(targetUserId);
      }

      return canViewAll ? projectsRepo.listAll() : projectsRepo.listForUser(request.user.id);
    },
  );

  fastify.get(
    '/ril-catalog',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('timesheets.ril.view'),
      ],
      schema: {
        tags: ['ril'],
        summary: 'List the lightweight project catalog used for RIL order codes',
        querystring: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        response: {
          200: { type: 'array', items: rilProjectCatalogItemSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const query = request.query as { userId?: unknown };
      const targetUserIdResult = optionalNonEmptyString(query.userId, 'userId');
      if (!targetUserIdResult.ok) return badRequest(reply, targetUserIdResult.message);
      const targetUserId = targetUserIdResult.value;
      if (!targetUserId) return badRequest(reply, 'userId is required');

      if (!(await canListProjectsForTargetUser(request, targetUserId))) {
        return forbidden(reply, 'Insufficient permissions');
      }

      return projectsRepo.listRilCatalogForUser(targetUserId);
    },
  );

  fastify.get(
    '/order-options',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireAnyPermission(
          'projects.manage.view',
          'projects.manage_all.view',
          'projects.manage.create',
          'projects.manage_all.create',
          'projects.manage.update',
          'projects.manage_all.update',
        ),
      ],
      schema: {
        tags: ['projects'],
        summary: 'List confirmed client orders available for project links',
        response: {
          200: { type: 'array', items: projectOrderOptionSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const options = await clientsOrdersRepo.listConfirmedProjectOptions();
      const canViewAllOrderOptions =
        hasPermission(request, 'accounting.clients_orders.view') ||
        hasPermission(request, 'crm.clients_all.view') ||
        hasPermission(request, 'projects.manage_all.view') ||
        hasPermission(request, 'projects.manage_all.create') ||
        hasPermission(request, 'projects.manage_all.update');
      if (canViewAllOrderOptions) return options;

      const assignedClientIds = await userAssignmentsRepo.filterAssignedClientIds(
        request.user.id,
        options.map((order) => order.clientId),
      );
      return options.filter((order) => assignedClientIds.has(order.clientId));
    },
  );

  // POST / - Create project (manager only)
  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requireScopedPermission('projects.manage', 'create')],
      schema: {
        tags: ['projects'],
        summary: 'Create project',
        body: projectCreateBodySchema,
        response: {
          201: projectSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { name, clientId, description, orderId } = request.body as {
        name: string;
        clientId: string;
        description?: string | null;
        orderId?: string;
        billingType?: string;
        billingFrequency?: string;
      };
      const body = request.body as {
        billingType?: string;
        billingFrequency?: string;
        offerId?: string | null;
        startDate?: string;
        endDate?: string;
        revenue?: number | string | null;
        tipo?: string;
        status?: string;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
      if (
        !hasPermission(request, 'projects.manage_all.create') &&
        !(await canAccessClient(request, clientIdResult.value))
      ) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'project.create.denied',
          entityType: 'client',
          entityId: clientIdResult.value,
          details: { secondaryLabel: 'client_access_denied' },
        });
      }

      const orderIdResult = requireNonEmptyString(orderId, 'orderId');
      if (!orderIdResult.ok) return badRequest(reply, orderIdResult.message);

      const offerIdResult = optionalNonEmptyString(body.offerId, 'offerId');
      if (!offerIdResult.ok) return badRequest(reply, offerIdResult.message);

      const startDateResult = parseDateString(body.startDate, 'startDate');
      if (!startDateResult.ok) return badRequest(reply, startDateResult.message);
      const endDateResult = parseDateString(body.endDate, 'endDate');
      if (!endDateResult.ok) return badRequest(reply, endDateResult.message);
      if (startDateResult.value > endDateResult.value) {
        return badRequest(reply, 'startDate must be on or before endDate');
      }

      const revenueResult = optionalNonNegativeNumber(body.revenue, 'revenue');
      if (!revenueResult.ok) return badRequest(reply, revenueResult.message);

      const billingTypeResult = optionalEnum(body.billingType, STORED_BILLING_TYPES, 'billingType');
      if (!billingTypeResult.ok) return badRequest(reply, billingTypeResult.message);
      const billingType = billingTypeResult.value ?? DEFAULT_BILLING_TYPE;
      const billingFrequencyResult = optionalEnum(
        body.billingFrequency,
        BILLING_FREQUENCIES,
        'billingFrequency',
      );
      if (!billingFrequencyResult.ok) return badRequest(reply, billingFrequencyResult.message);
      const billingFrequency = normalizeBillingFrequency(billingFrequencyResult.value);

      // `tipo` is mandatory on create (issue #784): the form requires a deliberate choice.
      const tipoResult = validateEnum(body.tipo, PROJECT_TIPOS, 'tipo');
      if (!tipoResult.ok) return badRequest(reply, tipoResult.message);
      const statusResult = optionalEnum(body.status, PROJECT_STATUSES, 'status');
      if (!statusResult.ok) return badRequest(reply, statusResult.message);

      const id = generatePrefixedId('p');

      // The two FK lookups are independent — run them concurrently.
      const [orderLink, offerClientId] = await Promise.all([
        clientsOrdersRepo.findProjectLinkById(orderIdResult.value),
        offerIdResult.value
          ? clientOffersRepo.findClientIdById(offerIdResult.value)
          : Promise.resolve(null),
      ]);
      if (orderLink === null || orderLink.clientId !== clientIdResult.value) {
        return badRequest(reply, 'orderId does not belong to the specified clientId');
      }
      if (orderLink.status !== 'confirmed') {
        return badRequest(reply, 'orderId must reference a confirmed client order');
      }
      if (offerIdResult.value && offerClientId !== null && offerClientId !== clientIdResult.value) {
        return badRequest(reply, 'offerId does not belong to the specified clientId');
      }

      try {
        // Atomicity: project insert + auto-assignments must all succeed or all roll back.
        // Without the transaction, an assignment failure left the project committed but
        // unassigned (orphan) while the handler still returned 500.
        const created = await withDbTransaction(async (tx) => {
          const project = await projectsRepo.create(
            {
              id,
              name: nameResult.value,
              clientId: clientIdResult.value,
              description: description || null,
              isDisabled: false,
              orderId: orderIdResult.value,
              offerId: offerIdResult.value,
              startDate: startDateResult.value,
              endDate: endDateResult.value,
              revenue: revenueResult.value,
              billingType,
              billingFrequency,
              tipo: tipoResult.value,
              status: statusResult.value ?? undefined,
            },
            tx,
          );

          await Promise.all([
            userAssignmentsRepo.assignClientToUser(
              request.user.id,
              clientIdResult.value,
              undefined,
              tx,
            ),
            userAssignmentsRepo.assignProjectToUser(request.user.id, id, undefined, tx),
            userAssignmentsRepo.assignClientToTopManagers(clientIdResult.value, tx),
            userAssignmentsRepo.assignProjectToTopManagers(id, tx),
          ]);

          return project;
        });

        // Audit log is best-effort and intentionally outside the transaction: a logging
        // failure must not roll back the resource that was successfully created.
        await logAudit({
          request,
          action: 'project.created',
          entityType: 'project',
          entityId: id,
          details: {
            targetLabel: nameResult.value,
            secondaryLabel: clientIdResult.value,
          },
        });
        return reply.code(201).send(created);
      } catch (err) {
        if (err instanceof ForeignKeyError) {
          return replyError(request, reply, {
            statusCode: 400,
            message: err.message,
            action: 'project.create.invalid',
            entityType: 'project',
            details: { secondaryLabel: 'fk_violation' },
          });
        }
        throw err;
      }
    },
  );

  // DELETE /:id - Delete project (manager only)
  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requireScopedPermission('projects.manage', 'delete')],
      schema: {
        tags: ['projects'],
        summary: 'Delete project',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      if (!(await canAccessProject(request, idResult.value, 'projects.manage_all.delete'))) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'project.delete.denied',
          entityType: 'project',
          entityId: idResult.value,
          details: { secondaryLabel: 'project_access_denied' },
        });
      }

      let deletedProject: { projectName: string; clientId: string };

      try {
        deletedProject = await withDbTransaction(async (tx) => {
          const locked = await projectsRepo.lockNameAndClientById(idResult.value, tx);
          if (!locked) throw new NotFoundError('Project');

          await projectsRepo.deleteByIdAndRemoveUnusedClientCascade(
            idResult.value,
            locked.clientId,
            tx,
          );

          return { projectName: locked.name, clientId: locked.clientId };
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return replyError(request, reply, {
            statusCode: 404,
            message: err.message,
            action: 'project.delete.not_found',
            entityType: 'project',
            entityId: idResult.value,
          });
        }
        throw err;
      }

      await logAudit({
        request,
        action: 'project.deleted',
        entityType: 'project',
        entityId: idResult.value,
        details: {
          targetLabel: deletedProject.projectName,
          secondaryLabel: deletedProject.clientId,
        },
      });
      return reply.code(204).send();
    },
  );

  // PUT /:id - Update project (manager only)
  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requireScopedPermission('projects.manage', 'update')],
      schema: {
        tags: ['projects'],
        summary: 'Update project',
        params: idParamSchema,
        body: projectUpdateBodySchema,
        response: {
          200: projectSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        clientId?: string;
        description?: string | null;
        isDisabled?: boolean;
        orderId?: string | null;
        offerId?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        revenue?: number | string | null;
        billingType?: string;
        billingFrequency?: string;
        tipo?: string;
        status?: string;
      };
      const {
        name,
        clientId,
        description,
        isDisabled,
        orderId,
        billingType,
        billingFrequency,
        tipo,
        status,
      } = body;
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      if (!(await canAccessProject(request, idResult.value, 'projects.manage_all.update'))) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'project.update.denied',
          entityType: 'project',
          entityId: idResult.value,
          details: { secondaryLabel: 'project_access_denied' },
        });
      }
      const billingTypeResult = optionalEnum(billingType, STORED_BILLING_TYPES, 'billingType');
      if (!billingTypeResult.ok) return badRequest(reply, billingTypeResult.message);
      const billingFrequencyResult = optionalEnum(
        billingFrequency,
        BILLING_FREQUENCIES,
        'billingFrequency',
      );
      if (!billingFrequencyResult.ok) return badRequest(reply, billingFrequencyResult.message);
      // `tipo` is optional on update, but when present it must be a valid value. Supplying it
      // confirms the field (the repo sets `tipo_confirmed`), satisfying the forced first-edit
      // confirmation for rollout-defaulted projects (issue #784).
      const tipoResult = optionalEnum(tipo, PROJECT_TIPOS, 'tipo');
      if (!tipoResult.ok) return badRequest(reply, tipoResult.message);
      const statusResult = optionalEnum(status, PROJECT_STATUSES, 'status');
      if (!statusResult.ok) return badRequest(reply, statusResult.message);

      // Parse each optional patch field into a `{provided, value}` tuple so we can distinguish
      // "absent from body" (skip) from "explicitly null" (clear) in the repo call below.
      type Patch<T> = { provided: true; value: T | null } | { provided: false };
      const parsePatch = <T>(
        key: 'offerId' | 'startDate' | 'endDate' | 'revenue',
        parse: (raw: unknown) => { ok: true; value: T | null } | { ok: false; message: string },
      ): { ok: true; patch: Patch<T> } | { ok: false; error: string } => {
        if (!Object.hasOwn(body, key)) return { ok: true, patch: { provided: false } };
        const r = parse((body as Record<string, unknown>)[key]);
        return r.ok
          ? { ok: true, patch: { provided: true, value: r.value } }
          : { ok: false, error: r.message };
      };

      const offerIdResult = parsePatch<string>('offerId', (v) =>
        optionalNonEmptyString(v, 'offerId'),
      );
      if (!offerIdResult.ok) return badRequest(reply, offerIdResult.error);
      const offerIdPatch = offerIdResult.patch;

      const startDateResult = parsePatch<string>('startDate', (v) =>
        optionalDateString(v, 'startDate'),
      );
      if (!startDateResult.ok) return badRequest(reply, startDateResult.error);
      const startDatePatch = startDateResult.patch;

      const endDateResult = parsePatch<string>('endDate', (v) => optionalDateString(v, 'endDate'));
      if (!endDateResult.ok) return badRequest(reply, endDateResult.error);
      const endDatePatch = endDateResult.patch;

      const revenueResult = parsePatch<number>('revenue', (v) =>
        optionalNonNegativeNumber(v, 'revenue'),
      );
      if (!revenueResult.ok) return badRequest(reply, revenueResult.error);
      const revenuePatch = revenueResult.patch;

      let updatedProject: {
        updated: projectsRepo.Project;
        clientChanged: boolean;
        action: string;
      };

      try {
        updatedProject = await withDbTransaction(async (tx) => {
          const previousClientId = await projectsRepo.lockClientIdById(idResult.value, tx);
          if (previousClientId === null) {
            throw new NotFoundError('Project');
          }

          // Validate the final date range against the locked row so a concurrent writer can't
          // sneak past us. The DB CHECK constraint is still the ultimate guard.
          if (startDatePatch.provided || endDatePatch.provided) {
            const existing = await projectsRepo.findDateRangeById(idResult.value, tx);
            const nextStart = startDatePatch.provided
              ? startDatePatch.value
              : (existing?.startDate ?? null);
            const nextEnd = endDatePatch.provided
              ? endDatePatch.value
              : (existing?.endDate ?? null);
            if (nextStart && nextEnd && nextStart > nextEnd) {
              throw new DateRangeError('startDate must be on or before endDate');
            }
          }

          const requestedClientId =
            typeof clientId === 'string' && clientId !== '' ? clientId : previousClientId;
          if (
            requestedClientId !== previousClientId &&
            !hasPermission(request, 'projects.manage_all.update') &&
            !(await canAccessClient(request, requestedClientId))
          ) {
            throw new PermissionError();
          }
          const clientChanged = requestedClientId !== previousClientId;
          const assignedUserIds = clientChanged
            ? await projectsRepo.findNonTopManagerUserIds(idResult.value, tx)
            : [];

          // Final orderId/offerId after this patch lands: the patch value if specified,
          // otherwise the existing column value. We only need the existing values when the
          // client is also changing (an unchanged client means the existing link was already
          // valid). Cross-checking both is otherwise the same lookup that previously ran
          // only against patch values; keep the reads serialized on this transaction
          // connection.
          const orderIdPatch = orderId === undefined ? undefined : orderId || null;
          const orderPatchPresent = orderIdPatch !== undefined;
          const existingLinks =
            !orderPatchPresent || (clientChanged && !offerIdPatch.provided)
              ? await projectsRepo.findClientLinksById(idResult.value, tx)
              : null;
          const finalOrderId = orderPatchPresent ? orderIdPatch : (existingLinks?.orderId ?? null);
          const finalOfferId = offerIdPatch.provided
            ? offerIdPatch.value
            : clientChanged
              ? (existingLinks?.offerId ?? null)
              : null;

          if (!finalOrderId) {
            throw new OrderRequiredError('orderId is required');
          }

          const orderLink = await clientsOrdersRepo.findProjectLinkById(finalOrderId, tx);
          const offerClientId = finalOfferId
            ? await clientOffersRepo.findClientIdById(finalOfferId, tx)
            : null;
          if (orderLink === null || orderLink.clientId !== requestedClientId) {
            throw new OrderClientMismatchError('orderId does not belong to the specified clientId');
          }
          if (orderLink.status !== 'confirmed') {
            throw new OrderStatusError('orderId must reference a confirmed client order');
          }
          if (finalOfferId && offerClientId !== null && offerClientId !== requestedClientId) {
            throw new OfferClientMismatchError('offerId does not belong to the specified clientId');
          }

          const updated = await projectsRepo.update(
            idResult.value,
            {
              name: name || undefined,
              clientId: clientChanged ? requestedClientId : undefined,
              description: description === null ? null : description || undefined,
              isDisabled,
              orderId: orderIdPatch,
              offerId: offerIdPatch.provided ? offerIdPatch.value : undefined,
              startDate: startDatePatch.provided ? startDatePatch.value : undefined,
              endDate: endDatePatch.provided ? endDatePatch.value : undefined,
              revenue: revenuePatch.provided ? revenuePatch.value : undefined,
              billingType: billingTypeResult.value ?? undefined,
              billingFrequency: billingFrequencyResult.value ?? undefined,
              tipo: tipoResult.value ?? undefined,
              status: statusResult.value ?? undefined,
            },
            tx,
          );

          if (!updated) {
            throw new NotFoundError('Project');
          }

          if (clientChanged) {
            await projectsRepo.ensureClientCascadeAssignments(
              assignedUserIds,
              updated.clientId,
              tx,
            );
            await projectsRepo.removeClientCascadeForUsersIfUnused(
              assignedUserIds,
              previousClientId,
              tx,
            );
          }

          const action = deriveToggleAction(
            getAuditChangedFields(body),
            'isDisabled',
            'project.updated',
            'project.disabled',
            'project.enabled',
            body.isDisabled,
          );

          return { updated, clientChanged, action };
        });
      } catch (err) {
        if (err instanceof PermissionError) {
          return replyError(request, reply, {
            statusCode: 403,
            message: 'Insufficient permissions',
            action: 'project.update.denied',
            entityType: 'project',
            entityId: idResult.value,
            details: { secondaryLabel: 'permission_error' },
          });
        }
        if (err instanceof NotFoundError) {
          return replyError(request, reply, {
            statusCode: 404,
            message: err.message,
            action: 'project.update.not_found',
            entityType: 'project',
            entityId: idResult.value,
          });
        }
        if (err instanceof OrderRequiredError) {
          return replyError(request, reply, {
            statusCode: 400,
            message: err.message,
            action: 'project.update.invalid',
            entityType: 'project',
            entityId: idResult.value,
            details: { secondaryLabel: 'order_required' },
          });
        }
        if (err instanceof OrderClientMismatchError) {
          return replyError(request, reply, {
            statusCode: 400,
            message: err.message,
            action: 'project.update.invalid',
            entityType: 'project',
            entityId: idResult.value,
            details: { secondaryLabel: 'order_client_mismatch' },
          });
        }
        if (err instanceof OrderStatusError) {
          return replyError(request, reply, {
            statusCode: 400,
            message: err.message,
            action: 'project.update.invalid',
            entityType: 'project',
            entityId: idResult.value,
            details: { secondaryLabel: 'order_not_confirmed' },
          });
        }
        if (err instanceof OfferClientMismatchError) {
          return replyError(request, reply, {
            statusCode: 400,
            message: err.message,
            action: 'project.update.invalid',
            entityType: 'project',
            entityId: idResult.value,
            details: { secondaryLabel: 'offer_client_mismatch' },
          });
        }
        if (err instanceof DateRangeError) {
          return replyError(request, reply, {
            statusCode: 400,
            message: err.message,
            action: 'project.update.invalid',
            entityType: 'project',
            entityId: idResult.value,
            details: { secondaryLabel: 'date_range_invalid' },
          });
        }
        if (err instanceof ForeignKeyError) {
          return replyError(request, reply, {
            statusCode: 400,
            message: err.message,
            action: 'project.update.invalid',
            entityType: 'project',
            entityId: idResult.value,
            details: { secondaryLabel: 'fk_violation' },
          });
        }
        throw err;
      }

      await logAudit({
        request,
        action: updatedProject.action,
        entityType: 'project',
        entityId: idResult.value,
        details: {
          targetLabel: updatedProject.updated.name,
          secondaryLabel: updatedProject.updated.clientId,
        },
      });
      return updatedProject.updated;
    },
  );

  // GET /:id/users - Get assigned users for a project
  fastify.get(
    '/:id/users',
    {
      onRequest: [
        authenticateToken,
        requireAnyPermission('projects.assignments.view', 'projects.assignments.update'),
      ],
      schema: {
        tags: ['projects'],
        summary: 'Get project user assignments',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: { type: 'string' } },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      // `projects.assignments.view` is the "view all assignments" marker; without it, access stays
      // scoped to membership / manage_all.view exactly as before.
      const canViewAssignments =
        hasPermission(request, 'projects.assignments.view') ||
        (await canAccessProject(request, idResult.value));
      if (!canViewAssignments) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'project.assigned_users_view.denied',
          entityType: 'project',
          entityId: idResult.value,
          details: { secondaryLabel: 'project_access_denied' },
        });
      }
      return projectsRepo.findAssignedUserIds(idResult.value);
    },
  );

  // POST /:id/users - Update assigned users for a project (with cascade to client)
  fastify.post(
    '/:id/users',
    {
      onRequest: [authenticateToken, requirePermission('projects.assignments.update')],
      schema: {
        tags: ['projects'],
        summary: 'Update project user assignments',
        params: idParamSchema,
        body: userIdsSchema,
        response: {
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { userIds } = request.body as { userIds: string[] };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      // `projects.assignments.view` is the "manages all assignments" marker; without it, editing
      // stays scoped to membership / manage_all.view exactly as before.
      const canEditAssignments =
        hasPermission(request, 'projects.assignments.view') ||
        (await canAccessProject(request, idResult.value));
      if (!canEditAssignments) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'project.assign_users.denied',
          entityType: 'project',
          entityId: idResult.value,
          details: { secondaryLabel: 'project_access_denied' },
        });
      }

      const userIdsResult = ensureArrayOfStrings(userIds, 'userIds');
      if (!userIdsResult.ok) return badRequest(reply, userIdsResult.message);
      const validUserIds = userIdsResult.value;

      let projectName: string;

      try {
        projectName = await withDbTransaction(async (tx) => {
          const locked = await projectsRepo.lockNameAndClientById(idResult.value, tx);
          if (!locked) throw new NotFoundError('Project');

          await projectsRepo.replaceNonTopManagerAssignments(
            idResult.value,
            validUserIds,
            locked.clientId,
            tx,
          );

          return locked.name;
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return replyError(request, reply, {
            statusCode: 404,
            message: err.message,
            action: 'project.assign_users.not_found',
            entityType: 'project',
            entityId: idResult.value,
          });
        }
        throw err;
      }

      await logAudit({
        request,
        action: 'project.users_assigned',
        entityType: 'project',
        entityId: idResult.value,
        details: {
          targetLabel: projectName,
          counts: { users: validUserIds.length },
        },
      });
      return { message: 'Project assignments updated' };
    },
  );
}
