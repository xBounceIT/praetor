import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { messageResponseSchema, standardErrorResponses } from '../schemas/common.ts';
import { CONFIGURATION_PERMISSIONS, isPermissionKnown } from '../utils/permissions.ts';
import { badRequest, ensureArrayOfStrings, requireNonEmptyString } from '../utils/validation.ts';

const roleSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    isSystem: { type: 'boolean' },
    isAdmin: { type: 'boolean' },
    permissions: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'name', 'isSystem', 'isAdmin', 'permissions'],
} as const;

const rolesListSchema = {
  type: 'array',
  items: roleSchema,
} as const;

const roleCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    permissions: { type: 'array', items: { type: 'string' } },
  },
  required: ['name'],
} as const;

const roleUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
  },
  required: ['name'],
} as const;

const rolePermissionsBodySchema = {
  type: 'object',
  properties: {
    permissions: { type: 'array', items: { type: 'string' } },
  },
  required: ['permissions'],
} as const;

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const mapRoleRow = async (row: {
  id: string;
  name: string;
  is_system: boolean;
  is_admin: boolean;
}) => {
  const explicitPerms = (
    await query('SELECT permission FROM role_permissions WHERE role_id = $1', [row.id])
  ).rows.map((perm) => perm.permission);

  const permissions = row.is_admin
    ? Array.from(new Set([...CONFIGURATION_PERMISSIONS, ...explicitPerms]))
    : explicitPerms;

  return {
    id: row.id,
    name: row.name,
    isSystem: row.is_system,
    isAdmin: row.is_admin,
    permissions,
  };
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List roles
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('configuration.roles.view')],
      schema: {
        tags: ['roles'],
        summary: 'List roles',
        response: {
          200: rolesListSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const result = await query('SELECT id, name, is_system, is_admin FROM roles ORDER BY name');
      const roles = await Promise.all(result.rows.map(mapRoleRow));
      return roles;
    },
  );

  // POST / - Create role
  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('configuration.roles.create')],
      schema: {
        tags: ['roles'],
        summary: 'Create role',
        body: roleCreateBodySchema,
        response: {
          201: roleSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, permissions } = request.body as { name?: string; permissions?: string[] };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const permissionsResult = ensureArrayOfStrings(permissions || [], 'permissions');
      if (!permissionsResult.ok)
        return badRequest(reply, (permissionsResult as { ok: false; message: string }).message);

      const invalidPermission = permissionsResult.value.find(
        (permission) => !isPermissionKnown(permission),
      );
      if (invalidPermission) {
        return badRequest(reply, `Unknown permission: ${invalidPermission}`);
      }

      const id = `role-${randomUUID()}`;

      try {
        await query('BEGIN');
        await query('INSERT INTO roles (id, name, is_system, is_admin) VALUES ($1, $2, $3, $4)', [
          id,
          nameResult.value,
          false,
          false,
        ]);

        for (const permission of permissionsResult.value) {
          await query(
            'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, permission],
          );
        }

        await query('COMMIT');
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }

      const roleRow = await query('SELECT id, name, is_system, is_admin FROM roles WHERE id = $1', [
        id,
      ]);
      const role = await mapRoleRow(roleRow.rows[0]);
      return reply.code(201).send(role);
    },
  );

  // PUT /:id - Rename role
  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('configuration.roles.update')],
      schema: {
        tags: ['roles'],
        summary: 'Rename role',
        params: idParamSchema,
        body: roleUpdateBodySchema,
        response: {
          200: roleSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { name } = request.body as { name?: string };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const roleResult = await query('SELECT id, is_system, is_admin FROM roles WHERE id = $1', [
        idResult.value,
      ]);
      if (roleResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Role not found' });
      }

      const roleRow = roleResult.rows[0];
      if (roleRow.is_admin || roleRow.is_system) {
        return reply.code(403).send({ error: 'System roles cannot be renamed' });
      }

      await query('UPDATE roles SET name = $1 WHERE id = $2', [nameResult.value, idResult.value]);

      const updatedRoleResult = await query(
        'SELECT id, name, is_system, is_admin FROM roles WHERE id = $1',
        [idResult.value],
      );
      const updatedRole = await mapRoleRow(updatedRoleResult.rows[0]);
      return reply.send(updatedRole);
    },
  );

  // DELETE /:id - Delete role
  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('configuration.roles.delete')],
      schema: {
        tags: ['roles'],
        summary: 'Delete role',
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

      const roleResult = await query('SELECT id, is_system, is_admin FROM roles WHERE id = $1', [
        idResult.value,
      ]);
      if (roleResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Role not found' });
      }

      const roleRow = roleResult.rows[0];
      if (roleRow.is_admin || roleRow.is_system) {
        return reply.code(403).send({ error: 'System roles cannot be deleted' });
      }

      const userCheck = await query('SELECT id FROM users WHERE role = $1 LIMIT 1', [
        idResult.value,
      ]);
      if (userCheck.rows.length > 0) {
        return reply.code(409).send({ error: 'Role is in use by existing users' });
      }

      await query('DELETE FROM roles WHERE id = $1', [idResult.value]);
      return { message: 'Role deleted' };
    },
  );

  // PUT /:id/permissions - Update role permissions
  fastify.put(
    '/:id/permissions',
    {
      onRequest: [authenticateToken, requirePermission('configuration.roles.update')],
      schema: {
        tags: ['roles'],
        summary: 'Update role permissions',
        params: idParamSchema,
        body: rolePermissionsBodySchema,
        response: {
          200: roleSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { permissions } = request.body as { permissions?: string[] };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const permissionsResult = ensureArrayOfStrings(permissions, 'permissions');
      if (!permissionsResult.ok)
        return badRequest(reply, (permissionsResult as { ok: false; message: string }).message);

      const invalidPermission = permissionsResult.value.find(
        (permission) => !isPermissionKnown(permission),
      );
      if (invalidPermission) {
        return badRequest(reply, `Unknown permission: ${invalidPermission}`);
      }

      const roleResult = await query('SELECT id, is_admin FROM roles WHERE id = $1', [
        idResult.value,
      ]);
      if (roleResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Role not found' });
      }

      try {
        await query('BEGIN');
        await query('DELETE FROM role_permissions WHERE role_id = $1', [idResult.value]);
        for (const permission of permissionsResult.value) {
          await query(
            'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [idResult.value, permission],
          );
        }
        await query('COMMIT');
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }

      const updatedRoleResult = await query(
        'SELECT id, name, is_system, is_admin FROM roles WHERE id = $1',
        [idResult.value],
      );
      const updatedRole = await mapRoleRow(updatedRoleResult.rows[0]);
      return reply.send(updatedRole);
    },
  );
}
