import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
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

const hasPermission = (request: FastifyRequest, permission: string) =>
  request.user?.permissions?.includes(permission) ?? false;

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

      const result = await query(
        'DELETE FROM projects WHERE id = $1 RETURNING id, name, client_id',
        [idResult.value],
      );
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      await bumpNamespaceVersion('projects');
      await logAudit({
        request,
        action: 'project.deleted',
        entityType: 'project',
        entityId: idResult.value,
        details: {
          targetLabel: result.rows[0].name as string,
          secondaryLabel: result.rows[0].client_id as string,
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

      try {
        const result = await query(
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

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Project not found' });
        }

        const updated = result.rows[0];

        const isDisabledChanged = Object.hasOwn(body, 'isDisabled');
        const changedFields = [
          Object.hasOwn(body, 'name') ? 'name' : null,
          Object.hasOwn(body, 'clientId') ? 'clientId' : null,
          Object.hasOwn(body, 'description') ? 'description' : null,
          Object.hasOwn(body, 'color') ? 'color' : null,
          isDisabledChanged ? 'isDisabled' : null,
        ].filter((field): field is string => field !== null);

        // Determine specific action based on what changed
        let action = 'project.updated';
        if (changedFields.length === 1 && changedFields[0] === 'isDisabled') {
          action = body.isDisabled ? 'project.disabled' : 'project.enabled';
        }

        await bumpNamespaceVersion('projects');
        await logAudit({
          request,
          action,
          entityType: 'project',
          entityId: idResult.value,
          details: {
            targetLabel: updated.name as string,
            secondaryLabel: updated.client_id as string,
          },
        });
        return {
          id: updated.id,
          name: updated.name,
          clientId: updated.client_id,
          color: updated.color,
          description: updated.description,
          isDisabled: updated.is_disabled,
        };
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

      const projectResult = await query('SELECT name, client_id FROM projects WHERE id = $1', [
        idResult.value,
      ]);
      if (projectResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Project not found' });
      }
      const clientId = projectResult.rows[0].client_id as string;
      const projectName = projectResult.rows[0].name as string;

      try {
        await query('BEGIN');

        // Snapshot current assignments before wiping
        const currentResult = await query(
          'SELECT user_id FROM user_projects WHERE project_id = $1',
          [idResult.value],
        );
        const previousUserIds = currentResult.rows.map((r) => r.user_id as string);

        // Replace project assignments
        await query('DELETE FROM user_projects WHERE project_id = $1', [idResult.value]);

        for (const userId of validUserIds) {
          await query(
            `INSERT INTO user_projects (user_id, project_id, assignment_source)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [userId, idResult.value, MANUAL_ASSIGNMENT_SOURCE],
          );
          // Cascade UP: ensure the user is also assigned to the parent client
          await query(
            `INSERT INTO user_clients (user_id, client_id, assignment_source)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [userId, clientId, MANUAL_ASSIGNMENT_SOURCE],
          );
        }

        // Cascade DOWN: for removed users, unassign from client if no other projects remain
        const removedUserIds = previousUserIds.filter((uid) => !validUserIds.includes(uid));
        for (const userId of removedUserIds) {
          const otherProjectsResult = await query(
            `SELECT 1 FROM user_projects up
             INNER JOIN projects p ON up.project_id = p.id
             WHERE up.user_id = $1 AND p.client_id = $2
             LIMIT 1`,
            [userId, clientId],
          );
          if (otherProjectsResult.rows.length === 0) {
            await query(
              `DELETE FROM user_clients
               WHERE user_id = $1 AND client_id = $2 AND assignment_source = $3`,
              [userId, clientId, MANUAL_ASSIGNMENT_SOURCE],
            );
          }
        }

        await query('COMMIT');
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
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    },
  );
}
