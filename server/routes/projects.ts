import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withTransaction } from '../db/index.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import * as projectsRepo from '../repositories/projectsRepo.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import { deriveToggleAction, getAuditChangedFields, logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { ForeignKeyError, NotFoundError } from '../utils/http-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { requestHasPermission as hasPermission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  assignClientToTopManagers,
  assignClientToUser,
  assignProjectToTopManagers,
  assignProjectToUser,
} from '../utils/top-manager-assignments.ts';
import {
  badRequest,
  ensureArrayOfStrings,
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
  },
  required: ['id', 'name', 'clientId', 'color', 'isDisabled'],
} as const;

const projectCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    clientId: { type: 'string' },
    description: { type: 'string' },
    color: { type: 'string' },
  },
  required: ['name', 'clientId'],
} as const;

const projectUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    clientId: { type: 'string' },
    description: { type: 'string' },
    color: { type: 'string' },
    isDisabled: { type: 'boolean' },
  },
} as const;

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
          'projects.tasks.view',
          'timesheets.tracker.view',
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
      onRequest: [authenticateToken, requirePermission('projects.manage.create')],
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
      const { name, clientId, description, color } = request.body as {
        name: string;
        clientId: string;
        description?: string;
        color?: string;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const id = generatePrefixedId('p');
      let projectColor = '#3b82f6';
      if (color) {
        const colorResult = validateHexColor(color, 'color');
        if (!colorResult.ok) return badRequest(reply, colorResult.message);
        projectColor = colorResult.value;
      }

      try {
        await projectsRepo.create({
          id,
          name: nameResult.value,
          clientId: clientIdResult.value,
          color: projectColor,
          description: description || null,
          isDisabled: false,
        });

        await Promise.all([
          assignClientToUser(request.user.id, clientIdResult.value),
          assignProjectToUser(request.user.id, id),
          assignClientToTopManagers(clientIdResult.value),
          assignProjectToTopManagers(id),
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
        return reply.code(201).send({
          id,
          name: nameResult.value,
          clientId: clientIdResult.value,
          color: projectColor,
          description,
          isDisabled: false,
        });
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
      onRequest: [authenticateToken, requirePermission('projects.manage.delete')],
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

      let deletedProject: { projectName: string; clientId: string };

      try {
        deletedProject = await withTransaction(async (tx) => {
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
      onRequest: [authenticateToken, requirePermission('projects.manage.update')],
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
      };
      const { name, clientId, description, color, isDisabled } = body;
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      let normalizedColor = color;
      if (color !== undefined && color !== null && color !== '') {
        const colorResult = validateHexColor(color, 'color');
        if (!colorResult.ok) return badRequest(reply, colorResult.message);
        normalizedColor = colorResult.value;
      }

      let updatedProject: {
        updated: projectsRepo.Project;
        clientChanged: boolean;
        action: string;
      };

      try {
        updatedProject = await withTransaction(async (tx) => {
          const previousClientId = await projectsRepo.lockClientIdById(idResult.value, tx);
          if (previousClientId === null) {
            throw new NotFoundError('Project');
          }

          const requestedClientId =
            typeof clientId === 'string' && clientId !== '' ? clientId : previousClientId;
          const clientChanged = requestedClientId !== previousClientId;
          const assignedUserIds = clientChanged
            ? await projectsRepo.findNonTopManagerUserIds(idResult.value, tx)
            : [];

          const updated = await projectsRepo.update(
            idResult.value,
            {
              name: name || undefined,
              clientId: clientChanged ? requestedClientId : undefined,
              color: normalizedColor || undefined,
              description: description || undefined,
              isDisabled,
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
            getAuditChangedFields(body) ?? [],
            'isDisabled',
            'project.updated',
            'project.disabled',
            'project.enabled',
            body.isDisabled,
          );

          return { updated, clientChanged, action };
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ error: err.message });
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

      const userIdsResult = ensureArrayOfStrings(userIds, 'userIds');
      if (!userIdsResult.ok) return badRequest(reply, userIdsResult.message);
      const validUserIds = userIdsResult.value;

      let projectName: string;

      try {
        projectName = await withTransaction(async (tx) => {
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
