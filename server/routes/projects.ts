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
  DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE,
  normalizeBillingFrequency,
  STORED_BILLING_TYPES,
} from '../utils/billing.ts';
import { ForeignKeyError, NotFoundError } from '../utils/http-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { requestHasPermission as hasPermission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  badRequest,
  ensureArrayOfStrings,
  optionalDateString,
  optionalEnum,
  optionalNonEmptyString,
  optionalNonNegativeNumber,
  requireNonEmptyString,
  validateHexColor,
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

const projectSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    clientId: { type: 'string' },
    color: { type: 'string' },
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
  },
  required: ['id', 'name', 'clientId', 'color', 'isDisabled', 'billingType', 'billingFrequency'],
} as const;

const projectCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    clientId: { type: 'string' },
    description: { type: 'string' },
    color: { type: 'string' },
    orderId: { type: 'string' },
    offerId: { type: 'string' },
    startDate: { type: ['string', 'null'] },
    endDate: { type: ['string', 'null'] },
    revenue: { type: ['number', 'null'] },
    billingType: { type: 'string', enum: STORED_BILLING_TYPES },
    billingFrequency: { type: 'string', enum: BILLING_FREQUENCIES },
  },
  required: ['name', 'clientId', 'offerId'],
} as const;

const projectUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    clientId: { type: 'string' },
    description: { type: 'string' },
    color: { type: 'string' },
    isDisabled: { type: 'boolean' },
    orderId: { type: ['string', 'null'] },
    offerId: { type: ['string', 'null'] },
    startDate: { type: ['string', 'null'] },
    endDate: { type: ['string', 'null'] },
    revenue: { type: ['number', 'null'] },
    billingType: { type: 'string', enum: STORED_BILLING_TYPES },
    billingFrequency: { type: 'string', enum: BILLING_FREQUENCIES },
  },
} as const;

class PermissionError extends Error {}
class OrderClientMismatchError extends Error {}
class OfferClientMismatchError extends Error {}
class DateRangeError extends Error {}

const canAccessClient = (
  request: FastifyRequest,
  clientId: string,
  allScopePermission = 'crm.clients_all.view',
) => {
  if (hasPermission(request, allScopePermission)) return Promise.resolve(true);
  const userId = request.user?.id;
  if (!userId) return Promise.resolve(false);
  return userAssignmentsRepo.isClientAssignedToUser(userId, clientId);
};

const canAccessProject = (
  request: FastifyRequest,
  projectId: string,
  allScopePermission = 'projects.manage_all.view',
) => {
  if (hasPermission(request, allScopePermission)) return Promise.resolve(true);
  const userId = request.user?.id;
  if (!userId) return Promise.resolve(false);
  return userAssignmentsRepo.isProjectAssignedToUser(userId, projectId);
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
          'timesheets.recurring.view',
        ),
      ],
      schema: {
        tags: ['projects'],
        summary: 'List projects',
        response: {
          200: { type: 'array', items: projectSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const canViewAll = hasPermission(request, 'projects.manage_all.view');
      return canViewAll ? projectsRepo.listAll() : projectsRepo.listForUser(request.user.id);
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
      const { name, clientId, description, color, orderId } = request.body as {
        name: string;
        clientId: string;
        description?: string;
        color?: string;
        orderId?: string;
        billingType?: string;
        billingFrequency?: string;
      };
      const body = request.body as {
        billingType?: string;
        billingFrequency?: string;
        offerId?: string;
        startDate?: string | null;
        endDate?: string | null;
        revenue?: number | string | null;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
      if (
        !hasPermission(request, 'projects.manage_all.create') &&
        !(await canAccessClient(request, clientIdResult.value))
      ) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const offerIdResult = requireNonEmptyString(body.offerId, 'offerId');
      if (!offerIdResult.ok) return badRequest(reply, offerIdResult.message);

      const startDateResult = optionalDateString(body.startDate, 'startDate');
      if (!startDateResult.ok) return badRequest(reply, startDateResult.message);
      const endDateResult = optionalDateString(body.endDate, 'endDate');
      if (!endDateResult.ok) return badRequest(reply, endDateResult.message);
      if (
        startDateResult.value &&
        endDateResult.value &&
        startDateResult.value > endDateResult.value
      ) {
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
      const billingFrequency = normalizeBillingFrequency(
        billingType,
        billingFrequencyResult.value ?? DEFAULT_BILLING_FREQUENCY,
      );

      const id = generatePrefixedId('p');
      let projectColor = '#3b82f6';
      if (color) {
        const colorResult = validateHexColor(color, 'color');
        if (!colorResult.ok) return badRequest(reply, colorResult.message);
        projectColor = colorResult.value;
      }

      if (orderId) {
        const orderClientId = await clientsOrdersRepo.findClientIdById(orderId);
        if (orderClientId !== null && orderClientId !== clientIdResult.value) {
          return badRequest(reply, 'orderId does not belong to the specified clientId');
        }
      }

      const offerClientId = await clientOffersRepo.findClientIdById(offerIdResult.value);
      if (offerClientId !== null && offerClientId !== clientIdResult.value) {
        return badRequest(reply, 'offerId does not belong to the specified clientId');
      }

      try {
        const created = await projectsRepo.create({
          id,
          name: nameResult.value,
          clientId: clientIdResult.value,
          color: projectColor,
          description: description || null,
          isDisabled: false,
          orderId: orderId || null,
          offerId: offerIdResult.value,
          startDate: startDateResult.value,
          endDate: endDateResult.value,
          revenue: revenueResult.value,
          billingType,
          billingFrequency,
        });

        await Promise.all([
          userAssignmentsRepo.assignClientToUser(request.user.id, clientIdResult.value),
          userAssignmentsRepo.assignProjectToUser(request.user.id, id),
          userAssignmentsRepo.assignClientToTopManagers(clientIdResult.value),
          userAssignmentsRepo.assignProjectToTopManagers(id),
        ]);
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
          return reply.code(400).send({ error: err.message });
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
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      if (!(await canAccessProject(request, idResult.value, 'projects.manage_all.delete'))) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      let deletedProject: { projectName: string; clientId: string };

      try {
        deletedProject = await withDbTransaction(async (tx) => {
          const locked = await projectsRepo.lockNameAndClientById(idResult.value, tx);
          if (!locked) throw new NotFoundError('Project');

          const previousUserIds = await projectsRepo.findNonTopManagerUserIds(idResult.value, tx);

          await projectsRepo.deleteById(idResult.value, tx);

          await projectsRepo.removeClientCascadeForUsersIfUnused(
            previousUserIds,
            locked.clientId,
            tx,
          );

          return { projectName: locked.name, clientId: locked.clientId };
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ error: err.message });
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
      return { message: 'Project deleted' };
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
        description?: string;
        color?: string;
        isDisabled?: boolean;
        orderId?: string | null;
        offerId?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        revenue?: number | string | null;
        billingType?: string;
        billingFrequency?: string;
      };
      const {
        name,
        clientId,
        description,
        color,
        isDisabled,
        orderId,
        billingType,
        billingFrequency,
      } = body;
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      if (!(await canAccessProject(request, idResult.value, 'projects.manage_all.update'))) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }
      let normalizedColor = color;
      if (color !== undefined && color !== null && color !== '') {
        const colorResult = validateHexColor(color, 'color');
        if (!colorResult.ok) return badRequest(reply, colorResult.message);
        normalizedColor = colorResult.value;
      }

      const billingTypeResult = optionalEnum(billingType, STORED_BILLING_TYPES, 'billingType');
      if (!billingTypeResult.ok) return badRequest(reply, billingTypeResult.message);
      const billingFrequencyResult = optionalEnum(
        billingFrequency,
        BILLING_FREQUENCIES,
        'billingFrequency',
      );
      if (!billingFrequencyResult.ok) return badRequest(reply, billingFrequencyResult.message);

      // Parse each optional patch field into a `{provided, value}` tuple so we can distinguish
      // "absent from body" (skip) from "explicitly null" (clear) in the repo call below.
      const parsePatch = <T>(
        key: 'offerId' | 'startDate' | 'endDate' | 'revenue',
        parse: (raw: unknown) => { ok: true; value: T | null } | { ok: false; message: string },
      ): { provided: true; value: T | null } | { provided: false } | { error: string } => {
        if (!Object.hasOwn(body, key)) return { provided: false };
        const r = parse((body as Record<string, unknown>)[key]);
        return r.ok ? { provided: true, value: r.value } : { error: r.message };
      };

      const offerIdPatch = parsePatch<string>('offerId', (v) =>
        optionalNonEmptyString(v, 'offerId'),
      );
      if ('error' in offerIdPatch) return badRequest(reply, offerIdPatch.error);

      const startDatePatch = parsePatch<string>('startDate', (v) =>
        optionalDateString(v, 'startDate'),
      );
      if ('error' in startDatePatch) return badRequest(reply, startDatePatch.error);

      const endDatePatch = parsePatch<string>('endDate', (v) => optionalDateString(v, 'endDate'));
      if ('error' in endDatePatch) return badRequest(reply, endDatePatch.error);

      const revenuePatch = parsePatch<number>('revenue', (v) =>
        optionalNonNegativeNumber(v, 'revenue'),
      );
      if ('error' in revenuePatch) return badRequest(reply, revenuePatch.error);

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

          const orderIdPatch = orderId === undefined ? undefined : orderId || null;
          if (typeof orderIdPatch === 'string') {
            const orderClientId = await clientsOrdersRepo.findClientIdById(orderIdPatch, tx);
            if (orderClientId !== null && orderClientId !== requestedClientId) {
              throw new OrderClientMismatchError(
                'orderId does not belong to the specified clientId',
              );
            }
          }

          if (offerIdPatch.provided && offerIdPatch.value !== null) {
            const offerClientId = await clientOffersRepo.findClientIdById(offerIdPatch.value, tx);
            if (offerClientId !== null && offerClientId !== requestedClientId) {
              throw new OfferClientMismatchError(
                'offerId does not belong to the specified clientId',
              );
            }
          }

          const updated = await projectsRepo.update(
            idResult.value,
            {
              name: name || undefined,
              clientId: clientChanged ? requestedClientId : undefined,
              color: normalizedColor || undefined,
              description: description || undefined,
              isDisabled,
              orderId: orderIdPatch,
              offerId: offerIdPatch.provided ? offerIdPatch.value : undefined,
              startDate: startDatePatch.provided ? startDatePatch.value : undefined,
              endDate: endDatePatch.provided ? endDatePatch.value : undefined,
              revenue: revenuePatch.provided ? revenuePatch.value : undefined,
              billingType: billingTypeResult.value ?? undefined,
              billingFrequency: billingFrequencyResult.value ?? undefined,
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
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof OrderClientMismatchError) {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof OfferClientMismatchError) {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof DateRangeError) {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof ForeignKeyError) {
          return reply.code(400).send({ error: err.message });
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
      onRequest: [authenticateToken, requirePermission('projects.assignments.update')],
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
      if (!(await canAccessProject(request, idResult.value))) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
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
      if (!(await canAccessProject(request, idResult.value))) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const userIdsResult = ensureArrayOfStrings(userIds, 'userIds');
      if (!userIdsResult.ok) return badRequest(reply, userIdsResult.message);
      const validUserIds = userIdsResult.value;

      let projectName: string;

      try {
        projectName = await withDbTransaction(async (tx) => {
          const locked = await projectsRepo.lockNameAndClientById(idResult.value, tx);
          if (!locked) throw new NotFoundError('Project');

          const previousUserIds = await projectsRepo.findNonTopManagerUserIds(idResult.value, tx);

          await projectsRepo.clearNonTopManagerAssignments(idResult.value, tx);

          await projectsRepo.addManualAssignments(idResult.value, validUserIds, tx);
          await projectsRepo.ensureClientCascadeAssignments(validUserIds, locked.clientId, tx);

          const removedUserIds = previousUserIds.filter((uid) => !validUserIds.includes(uid));
          await projectsRepo.removeClientCascadeForUsersIfUnused(
            removedUserIds,
            locked.clientId,
            tx,
          );

          return locked.name;
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ error: err.message });
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
