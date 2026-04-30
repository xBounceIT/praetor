import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withTransaction } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import { messageResponseSchema, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import {
  ADMIN_BASE_PERMISSIONS,
  ADMINISTRATION_PERMISSIONS,
  ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS,
  isPermissionKnown,
  isTopManagerOnlyPermission,
  normalizePermission,
  TOP_MANAGER_ROLE_ID,
} from '../utils/permissions.ts';
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

const buildRolePayload = (row: rolesRepo.Role, explicitPerms: string[]) => {
  const normalized = explicitPerms.map(normalizePermission);
  const permissions = row.isAdmin
    ? Array.from(
        new Set([
          ...ADMINISTRATION_PERMISSIONS,
          ...ADMIN_BASE_PERMISSIONS,
          ...normalized,
          ...ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS,
        ]),
      )
    : Array.from(new Set([...normalized, ...ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS]));

  return {
    id: row.id,
    name: row.name,
    isSystem: row.isSystem,
    isAdmin: row.isAdmin,
    permissions,
  };
};

const mapRoleRow = async (row: rolesRepo.Role) =>
  buildRolePayload(row, await rolesRepo.listExplicitPermissions(row.id));

const isForbiddenAdministrationPermissionForNonAdmin = (permission: string) =>
  permission.startsWith('administration.') || permission.startsWith('configuration.');

const findForbiddenAdministrationPermission = (permissions: string[]) =>
  permissions.find(isForbiddenAdministrationPermissionForNonAdmin);

const findForbiddenTopManagerOnlyPermission = (roleId: string, permissions: string[]) =>
  roleId === TOP_MANAGER_ROLE_ID ? undefined : permissions.find(isTopManagerOnlyPermission);

const normalizeSubmittedPermissions = (permissions: string[]) =>
  Array.from(new Set(permissions.map((permission) => normalizePermission(permission))));

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List roles
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('administration.roles.view')],
      schema: {
        tags: ['roles'],
        summary: 'List roles',
        response: {
          200: rolesListSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const rows = await rolesRepo.listAll();
      const permsByRole = await rolesRepo.listExplicitPermissionsForRoles(
        rows.map((row) => row.id),
      );
      return rows.map((row) => buildRolePayload(row, permsByRole.get(row.id) ?? []));
    },
  );

  // POST / - Create role
  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('administration.roles.create')],
      schema: {
        tags: ['roles'],
        summary: 'Create role',
        body: roleCreateBodySchema,
        response: {
          201: roleSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, permissions } = request.body as { name?: string; permissions?: string[] };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const permissionsResult = ensureArrayOfStrings(permissions || [], 'permissions');
      if (!permissionsResult.ok) return badRequest(reply, permissionsResult.message);

      const normalizedPermissions = normalizeSubmittedPermissions(permissionsResult.value);

      const invalidPermission = normalizedPermissions.find(
        (permission) => !isPermissionKnown(permission),
      );
      if (invalidPermission) {
        return badRequest(reply, `Unknown permission: ${invalidPermission}`);
      }
      const forbiddenPermission = findForbiddenAdministrationPermission(normalizedPermissions);
      if (forbiddenPermission) {
        return badRequest(
          reply,
          `Non-admin roles cannot include administration permissions: ${forbiddenPermission}`,
        );
      }
      const id = generatePrefixedId('role');

      const forbiddenTopManagerPermission = findForbiddenTopManagerOnlyPermission(
        id,
        normalizedPermissions,
      );
      if (forbiddenTopManagerPermission) {
        return badRequest(
          reply,
          `Only the Top Manager role can include work unit permissions: ${forbiddenTopManagerPermission}`,
        );
      }

      await withTransaction(async (tx) => {
        await rolesRepo.insertRole(id, nameResult.value, tx);

        for (const permission of normalizedPermissions) {
          await rolesRepo.insertPermission(id, permission, tx);
        }
      });

      const role = await mapRoleRow({
        id,
        name: nameResult.value,
        isSystem: false,
        isAdmin: false,
      });
      await logAudit({
        request,
        action: 'role.created',
        entityType: 'role',
        entityId: id,
        details: {
          targetLabel: role.name,
          counts:
            permissionsResult.value.length > 0
              ? { permissions: permissionsResult.value.length }
              : undefined,
        },
      });
      return reply.code(201).send(role);
    },
  );

  // PUT /:id - Rename role
  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('administration.roles.update')],
      schema: {
        tags: ['roles'],
        summary: 'Rename role',
        params: idParamSchema,
        body: roleUpdateBodySchema,
        response: {
          200: roleSchema,
          ...standardRateLimitedErrorResponses,
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

      const roleRow = await rolesRepo.findById(idResult.value);
      if (!roleRow) {
        return reply.code(404).send({ error: 'Role not found' });
      }

      if (roleRow.isAdmin || roleRow.isSystem) {
        return reply.code(403).send({ error: 'System roles cannot be renamed' });
      }

      await rolesRepo.updateRoleName(idResult.value, nameResult.value);
      await logAudit({
        request,
        action: 'role.updated',
        entityType: 'role',
        entityId: idResult.value,
        details: {
          targetLabel: nameResult.value,
          fromValue: roleRow.name,
          toValue: nameResult.value,
        },
      });

      const updatedRole = await mapRoleRow({ ...roleRow, name: nameResult.value });
      return reply.send(updatedRole);
    },
  );

  // DELETE /:id - Delete role
  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('administration.roles.delete')],
      schema: {
        tags: ['roles'],
        summary: 'Delete role',
        params: idParamSchema,
        response: {
          200: messageResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const roleRow = await rolesRepo.findById(idResult.value);
      if (!roleRow) {
        return reply.code(404).send({ error: 'Role not found' });
      }

      if (roleRow.isAdmin || roleRow.isSystem) {
        return reply.code(403).send({ error: 'System roles cannot be deleted' });
      }

      if (await rolesRepo.isRoleInUse(idResult.value)) {
        return reply.code(409).send({ error: 'Role is in use by existing users' });
      }

      await rolesRepo.deleteRole(idResult.value);
      await logAudit({
        request,
        action: 'role.deleted',
        entityType: 'role',
        entityId: idResult.value,
        details: {
          targetLabel: roleRow.name,
        },
      });
      return { message: 'Role deleted' };
    },
  );

  // PUT /:id/permissions - Update role permissions
  fastify.put(
    '/:id/permissions',
    {
      onRequest: [authenticateToken, requirePermission('administration.roles.update')],
      schema: {
        tags: ['roles'],
        summary: 'Update role permissions',
        params: idParamSchema,
        body: rolePermissionsBodySchema,
        response: {
          200: roleSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { permissions } = request.body as { permissions?: string[] };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const permissionsResult = ensureArrayOfStrings(permissions, 'permissions');
      if (!permissionsResult.ok) return badRequest(reply, permissionsResult.message);

      const normalizedPermissions = normalizeSubmittedPermissions(permissionsResult.value);

      const invalidPermission = normalizedPermissions.find(
        (permission) => !isPermissionKnown(permission),
      );
      if (invalidPermission) {
        return badRequest(reply, `Unknown permission: ${invalidPermission}`);
      }

      const roleRow = await rolesRepo.findById(idResult.value);
      if (!roleRow) {
        return reply.code(404).send({ error: 'Role not found' });
      }
      if (roleRow.isAdmin) {
        return reply.code(403).send({ error: 'Admin role permissions are locked' });
      }
      const forbiddenPermission = findForbiddenAdministrationPermission(normalizedPermissions);
      if (forbiddenPermission) {
        return badRequest(
          reply,
          `Non-admin roles cannot include administration permissions: ${forbiddenPermission}`,
        );
      }
      const forbiddenTopManagerPermission = findForbiddenTopManagerOnlyPermission(
        idResult.value,
        normalizedPermissions,
      );
      if (forbiddenTopManagerPermission) {
        return badRequest(
          reply,
          `Only the Top Manager role can include work unit permissions: ${forbiddenTopManagerPermission}`,
        );
      }

      await withTransaction(async (tx) => {
        await rolesRepo.clearPermissions(idResult.value, tx);
        for (const permission of normalizedPermissions) {
          await rolesRepo.insertPermission(idResult.value, permission, tx);
        }
      });

      const updatedRole = await mapRoleRow(roleRow);
      await logAudit({
        request,
        action: 'role.permissions_updated',
        entityType: 'role',
        entityId: idResult.value,
        details: {
          targetLabel: updatedRole.name,
          counts: { permissions: normalizedPermissions.length },
        },
      });
      return reply.send(updatedRole);
    },
  );
}
