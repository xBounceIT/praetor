import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { getForeignKeyViolation } from '../utils/db-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import {
  ADMIN_BASE_PERMISSIONS,
  ADMINISTRATION_PERMISSIONS,
  ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS,
  filterAdminExplicitPermissions,
  isPermissionKnown,
  isTopManagerOnlyPermission,
  normalizePermission,
  TOP_MANAGER_ROLE_ID,
} from '../utils/permissions.ts';
import { replyError } from '../utils/replyError.ts';
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
  const explicit = row.isAdmin ? filterAdminExplicitPermissions(normalized) : normalized;
  const permissions = row.isAdmin
    ? Array.from(
        new Set([
          ...ADMINISTRATION_PERMISSIONS,
          ...ADMIN_BASE_PERMISSIONS,
          ...explicit,
          ...ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS,
        ]),
      )
    : Array.from(new Set([...explicit, ...ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS]));

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

      await withDbTransaction(async (tx) => {
        await rolesRepo.insertRole(id, nameResult.value, tx);
        await rolesRepo.insertPermissions(id, normalizedPermissions, tx);
      });

      const [role] = await Promise.all([
        mapRoleRow({
          id,
          name: nameResult.value,
          isSystem: false,
          isAdmin: false,
        }),
        logAudit({
          request,
          action: 'role.created',
          entityType: 'role',
          entityId: id,
          details: {
            targetLabel: nameResult.value,
            counts:
              permissionsResult.value.length > 0
                ? { permissions: permissionsResult.value.length }
                : undefined,
          },
        }),
      ]);
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
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Role not found',
          action: 'role.rename.not_found',
          entityType: 'role',
          entityId: idResult.value,
        });
      }

      if (roleRow.isAdmin || roleRow.isSystem) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'System roles cannot be renamed',
          action: 'role.rename.denied',
          entityType: 'role',
          entityId: idResult.value,
          details: { secondaryLabel: roleRow.isAdmin ? 'admin_role' : 'system_role' },
        });
      }

      await rolesRepo.updateRoleName(idResult.value, nameResult.value);
      const [updatedRole] = await Promise.all([
        mapRoleRow({ ...roleRow, name: nameResult.value }),
        logAudit({
          request,
          action: 'role.updated',
          entityType: 'role',
          entityId: idResult.value,
          details: {
            targetLabel: nameResult.value,
            fromValue: roleRow.name,
            toValue: nameResult.value,
          },
        }),
      ]);
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
          204: { type: 'null' },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      // Lock the role row, re-check in-use refs, and delete in one transaction so a concurrent
      // secondary assignment cannot land between the precheck and DELETE (and then get
      // silently cascade-removed). user_roles.role_id is also ON DELETE RESTRICT as a
      // belt-and-suspenders FK guard — translate 23503 to the same 409.
      type DeleteOutcome =
        | { kind: 'not_found' }
        | { kind: 'denied'; isAdmin: boolean }
        | { kind: 'in_use' }
        | { kind: 'deleted'; roleName: string };

      let outcome: DeleteOutcome;
      try {
        outcome = await withDbTransaction(async (tx): Promise<DeleteOutcome> => {
          const roleRow = await rolesRepo.lockById(idResult.value, tx);
          if (!roleRow) return { kind: 'not_found' };

          if (roleRow.isAdmin || roleRow.isSystem) {
            return { kind: 'denied', isAdmin: roleRow.isAdmin };
          }

          if (await rolesRepo.isRoleInUse(idResult.value, tx)) {
            return { kind: 'in_use' };
          }

          await rolesRepo.deleteRole(idResult.value, tx);
          return { kind: 'deleted', roleName: roleRow.name };
        });
      } catch (err) {
        if (getForeignKeyViolation(err)) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Role is in use by existing users',
            action: 'role.delete.conflict',
            entityType: 'role',
            entityId: idResult.value,
            details: { secondaryLabel: 'role_in_use' },
          });
        }
        throw err;
      }

      if (outcome.kind === 'not_found') {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Role not found',
          action: 'role.delete.not_found',
          entityType: 'role',
          entityId: idResult.value,
        });
      }

      if (outcome.kind === 'denied') {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'System roles cannot be deleted',
          action: 'role.delete.denied',
          entityType: 'role',
          entityId: idResult.value,
          details: { secondaryLabel: outcome.isAdmin ? 'admin_role' : 'system_role' },
        });
      }

      if (outcome.kind === 'in_use') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Role is in use by existing users',
          action: 'role.delete.conflict',
          entityType: 'role',
          entityId: idResult.value,
          details: { secondaryLabel: 'role_in_use' },
        });
      }

      await logAudit({
        request,
        action: 'role.deleted',
        entityType: 'role',
        entityId: idResult.value,
        details: {
          targetLabel: outcome.roleName,
        },
      });
      return reply.code(204).send();
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
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Role not found',
          action: 'role.update_permissions.not_found',
          entityType: 'role',
          entityId: idResult.value,
        });
      }
      if (roleRow.isAdmin) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Admin role permissions are locked',
          action: 'role.update_permissions.denied',
          entityType: 'role',
          entityId: idResult.value,
          details: { secondaryLabel: 'admin_role' },
        });
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

      await withDbTransaction(async (tx) => {
        await rolesRepo.clearPermissions(idResult.value, tx);
        await rolesRepo.insertPermissions(idResult.value, normalizedPermissions, tx);
      });

      const [updatedRole] = await Promise.all([
        mapRoleRow(roleRow),
        logAudit({
          request,
          action: 'role.permissions_updated',
          entityType: 'role',
          entityId: idResult.value,
          details: {
            targetLabel: roleRow.name,
            counts: { permissions: normalizedPermissions.length },
          },
        }),
      ]);
      return reply.send(updatedRole);
    },
  );
}
