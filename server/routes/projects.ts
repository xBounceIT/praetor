import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type QueryExecutor, query, withTransaction } from '../db/index.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import {
  bumpNamespaceVersion,
  cacheGetSetJson,
  setCacheHeader,
  shouldBypassCache,
  TTL_LIST_SECONDS,
} from '../services/cache.ts';
import { logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  assignClientToTopManagers,
  assignClientToUser,
  assignProjectToTopManagers,
  assignProjectToUser,
  MANUAL_ASSIGNMENT_SOURCE,
  PROJECT_CASCADE_ASSIGNMENT_SOURCE,
  TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
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

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

class ProjectNotFoundError extends Error {
  constructor() {
    super('Project not found');
  }
}

const hasPermission = (request: FastifyRequest, permission: string) =>
  request.user?.permissions?.includes(permission) ?? false;

const getNonTopManagerProjectUserIds = async (db: QueryExecutor, projectId: string) => {
  const result = await db.query(
    `SELECT user_id FROM user_projects
     WHERE project_id = $1 AND assignment_source != $2`,
    [projectId, TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE],
  );
  return result.rows.map((row) => row.user_id as string);
};

const ensureProjectCascadeClientAssignment = async (
  db: QueryExecutor,
  userId: string,
  clientId: string,
) => {
  await db.query(
    `INSERT INTO user_clients (user_id, client_id, assignment_source)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [userId, clientId, PROJECT_CASCADE_ASSIGNMENT_SOURCE],
  );
};

const removeProjectCascadeClientAssignmentIfUnused = async (
  db: QueryExecutor,
  userId: string,
  clientId: string,
) => {
  const otherProjectsResult = await db.query(
    `SELECT 1 FROM user_projects up
     INNER JOIN projects p ON up.project_id = p.id
     WHERE up.user_id = $1 AND p.client_id = $2
     LIMIT 1`,
    [userId, clientId],
  );

  if (otherProjectsResult.rows.length === 0) {
    await db.query(
      `DELETE FROM user_clients
       WHERE user_id = $1 AND client_id = $2 AND assignment_source = $3`,
      [userId, clientId, PROJECT_CASCADE_ASSIGNMENT_SOURCE],
    );
  }
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
      const scopeKey = canViewAll ? 'all' : `user:${request.user.id}`;
      const bypass = shouldBypassCache(request);

      const { status, value } = await cacheGetSetJson(
        'projects',
        `v=1:scope=${scopeKey}`,
        TTL_LIST_SECONDS,
        async () => {
          let queryText = `
            SELECT id, name, client_id, color, description, is_disabled 
            FROM projects ORDER BY name
        `;
          let queryParams: string[] = [];

          if (!canViewAll) {
            queryText = `
                SELECT p.id, p.name, p.client_id, p.color, p.description, p.is_disabled 
                FROM projects p
                INNER JOIN user_projects up ON p.id = up.project_id
                WHERE up.user_id = $1
                ORDER BY p.name
            `;
            queryParams = [request.user.id];
          }

          const result = await query(queryText, queryParams);
          return result.rows.map((p) => ({
            id: p.id,
            name: p.name,
            clientId: p.client_id,
            color: p.color,
            description: p.description,
            isDisabled: p.is_disabled,
          }));
        },
        { bypass },
      );

      setCacheHeader(reply, status);
      return value;
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

      const id = 'p-' + Date.now();
      const colorResult = color ? validateHexColor(color, 'color') : null;
      if (color && colorResult && !colorResult.ok) {
        return badRequest(reply, (colorResult as { ok: false; message: string }).message);
      }
      const projectColor = (colorResult as { ok: true; value: string } | null)?.value || '#3b82f6';

      try {
        await query(
          `INSERT INTO projects (id, name, client_id, color, description, is_disabled) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, nameResult.value, clientIdResult.value, projectColor, description || null, false],
        );

        if (request.user?.id) {
          await assignClientToUser(request.user.id, clientIdResult.value);
          await assignProjectToUser(request.user.id, id);
        }
        await assignClientToTopManagers(clientIdResult.value);
        await assignProjectToTopManagers(id);
        await bumpNamespaceVersion('projects');
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
        const error = err as DatabaseError;
        if (error.code === '23503') {
          // Foreign key violation
          return reply.code(400).send({ error: 'Client not found' });
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
          const projectResult = await tx.query(
            'SELECT name, client_id FROM projects WHERE id = $1 FOR UPDATE',
            [idResult.value],
          );
          if (projectResult.rows.length === 0) {
            throw new ProjectNotFoundError();
          }

          const projectName = projectResult.rows[0].name as string;
          const clientId = projectResult.rows[0].client_id as string;
          const previousUserIds = await getNonTopManagerProjectUserIds(tx, idResult.value);

          await tx.query('DELETE FROM projects WHERE id = $1', [idResult.value]);

          for (const userId of previousUserIds) {
            await removeProjectCascadeClientAssignmentIfUnused(tx, userId, clientId);
          }

          return { projectName, clientId };
        });
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }

      await bumpNamespaceVersion('projects');
      await bumpNamespaceVersion('clients');
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
      if (color !== undefined && color !== null && color !== '') {
        const colorResult = validateHexColor(color, 'color');
        if (!colorResult.ok)
          return badRequest(reply, (colorResult as { ok: false; message: string }).message);
      }

      let updatedProject: {
        updated: {
          id: string;
          name: string;
          client_id: string;
          color: string;
          description: string | null;
          is_disabled: boolean;
        };
        clientChanged: boolean;
        action: string;
      };

      try {
        updatedProject = await withTransaction(async (tx) => {
          const existingProjectResult = await tx.query(
            'SELECT client_id FROM projects WHERE id = $1 FOR UPDATE',
            [idResult.value],
          );
          if (existingProjectResult.rows.length === 0) {
            throw new ProjectNotFoundError();
          }

          const previousClientId = existingProjectResult.rows[0].client_id as string;
          const requestedClientId =
            typeof clientId === 'string' && clientId !== '' ? clientId : previousClientId;
          const clientChanged = requestedClientId !== previousClientId;
          const assignedUserIds = clientChanged
            ? await getNonTopManagerProjectUserIds(tx, idResult.value)
            : [];

          const result = await tx.query(
            `UPDATE projects
                   SET name = COALESCE($1, name),
                       client_id = COALESCE($2, client_id),
                       color = COALESCE($3, color),
                       description = COALESCE($4, description),
                       is_disabled = COALESCE($5, is_disabled)
                   WHERE id = $6
                   RETURNING id, name, client_id, color, description, is_disabled`,
            [
              name || null,
              clientId || null,
              color || null,
              description || null,
              isDisabled,
              idResult.value,
            ],
          );

          const updated = result.rows[0] as {
            id: string;
            name: string;
            client_id: string;
            color: string;
            description: string | null;
            is_disabled: boolean;
          };

          if (clientChanged) {
            const newClientId = updated.client_id;

            for (const userId of assignedUserIds) {
              await ensureProjectCascadeClientAssignment(tx, userId, newClientId);
            }

            for (const userId of assignedUserIds) {
              await removeProjectCascadeClientAssignmentIfUnused(tx, userId, previousClientId);
            }
          }

          const isDisabledChanged = Object.hasOwn(body, 'isDisabled');
          const changedFields = [
            Object.hasOwn(body, 'name') ? 'name' : null,
            Object.hasOwn(body, 'clientId') ? 'clientId' : null,
            Object.hasOwn(body, 'description') ? 'description' : null,
            Object.hasOwn(body, 'color') ? 'color' : null,
            isDisabledChanged ? 'isDisabled' : null,
          ].filter((field): field is string => field !== null);

          let action = 'project.updated';
          if (changedFields.length === 1 && changedFields[0] === 'isDisabled') {
            action = body.isDisabled ? 'project.disabled' : 'project.enabled';
          }

          return { updated, clientChanged, action };
        });
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        const error = err as DatabaseError;
        if (error.code === '23503') {
          // Foreign key violation
          return reply.code(400).send({ error: 'Client not found' });
        }
        throw err;
      }

      await bumpNamespaceVersion('projects');
      if (updatedProject.clientChanged) {
        await bumpNamespaceVersion('clients');
      }
      await logAudit({
        request,
        action: updatedProject.action,
        entityType: 'project',
        entityId: idResult.value,
        details: {
          targetLabel: updatedProject.updated.name,
          secondaryLabel: updatedProject.updated.client_id,
        },
      });
      return {
        id: updatedProject.updated.id,
        name: updatedProject.updated.name,
        clientId: updatedProject.updated.client_id,
        color: updatedProject.updated.color,
        description: updatedProject.updated.description,
        isDisabled: updatedProject.updated.is_disabled,
      };
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
      const result = await query('SELECT user_id FROM user_projects WHERE project_id = $1', [
        idResult.value,
      ]);
      return result.rows.map((r) => r.user_id);
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
          const projectResult = await tx.query(
            'SELECT name, client_id FROM projects WHERE id = $1 FOR UPDATE',
            [idResult.value],
          );
          if (projectResult.rows.length === 0) {
            throw new ProjectNotFoundError();
          }
          const clientId = projectResult.rows[0].client_id as string;
          const projectName = projectResult.rows[0].name as string;

          const previousUserIds = await getNonTopManagerProjectUserIds(tx, idResult.value);

          await tx.query(
            `DELETE FROM user_projects
             WHERE project_id = $1 AND assignment_source != $2`,
            [idResult.value, TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE],
          );

          for (const userId of validUserIds) {
            await tx.query(
              `INSERT INTO user_projects (user_id, project_id, assignment_source)
               VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
              [userId, idResult.value, MANUAL_ASSIGNMENT_SOURCE],
            );
            await ensureProjectCascadeClientAssignment(tx, userId, clientId);
          }

          const removedUserIds = previousUserIds.filter((uid) => !validUserIds.includes(uid));
          for (const userId of removedUserIds) {
            await removeProjectCascadeClientAssignmentIfUnused(tx, userId, clientId);
          }

          return projectName;
        });
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }

      await bumpNamespaceVersion('projects');
      await bumpNamespaceVersion('clients');
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
