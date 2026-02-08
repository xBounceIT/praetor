import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import { messageResponseSchema, standardErrorResponses } from '../schemas/common.ts';
import {
  TTL_LIST_SECONDS,
  bumpNamespaceVersion,
  cacheGetSetJson,
  setCacheHeader,
  shouldBypassCache,
} from '../services/cache.ts';
import { badRequest, requireNonEmptyString, validateHexColor } from '../utils/validation.ts';

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
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const canViewAll = hasPermission(request, 'projects.manage_all.view');
      const scopeKey = canViewAll ? 'all' : `user:${request.user!.id}`;
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
            queryParams = [request.user!.id];
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

        await bumpNamespaceVersion('projects');
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

      const result = await query('DELETE FROM projects WHERE id = $1 RETURNING id', [
        idResult.value,
      ]);
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      await bumpNamespaceVersion('projects');
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
      const { name, clientId, description, color, isDisabled } = request.body as {
        name?: string;
        clientId?: string;
        description?: string;
        color?: string;
        isDisabled?: boolean;
      };
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

        await bumpNamespaceVersion('projects');
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
}
