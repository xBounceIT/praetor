import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as settingsRepo from '../repositories/settingsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import { getAuditCounts, logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { isUniqueViolation } from '../utils/db-errors.ts';
import { computeAvatarInitials } from '../utils/initials.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import {
  ADMIN_ROLE_ID,
  requestHasPermission as hasPermission,
  TOP_MANAGER_ROLE_ID,
} from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  MANUAL_ASSIGNMENT_SOURCE,
  syncTopManagerAssignmentsForUser,
  userHasTopManagerRole,
} from '../utils/top-manager-assignments.ts';
import {
  badRequest,
  ensureArrayOfStrings,
  optionalArrayOfStrings,
  optionalEmail,
  optionalLocalizedNonNegativeNumber,
  requireNonEmptyString,
  validateEnum,
} from '../utils/validation.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    username: { type: 'string' },
    email: { type: 'string' },
    role: { type: 'string' },
    avatarInitials: { type: 'string' },
    costPerHour: { type: 'number' },
    isDisabled: { type: 'boolean' },
    employeeType: { type: 'string', enum: ['app_user', 'internal', 'external'] },
    hasTopManagerRole: { type: 'boolean' },
    isAdminOnly: { type: 'boolean' },
  },
  required: [
    'id',
    'name',
    'username',
    'email',
    'role',
    'avatarInitials',
    'costPerHour',
    'isDisabled',
    'employeeType',
    'hasTopManagerRole',
    'isAdminOnly',
  ],
} as const;

const userCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string' },
    role: { type: 'string' },
    email: { type: 'string' },
    costPerHour: { type: 'number' },
    employeeType: { type: 'string', enum: ['app_user', 'internal', 'external'] },
  },
  required: ['name'],
} as const;

const userUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    isDisabled: { type: 'boolean' },
    costPerHour: { type: 'number' },
    role: { type: 'string' },
    email: { type: 'string' },
  },
} as const;

const assignmentsSchema = {
  type: 'object',
  properties: {
    clientIds: { type: 'array', items: { type: 'string' } },
    projectIds: { type: 'array', items: { type: 'string' } },
    taskIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['clientIds', 'projectIds', 'taskIds'],
} as const;

const assignmentsUpdateBodySchema = {
  type: 'object',
  properties: {
    clientIds: { type: 'array', items: { type: 'string' } },
    projectIds: { type: 'array', items: { type: 'string' } },
    taskIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

const userRolesSchema = {
  type: 'object',
  properties: {
    roleIds: { type: 'array', items: { type: 'string' } },
    primaryRoleId: { type: 'string' },
  },
  required: ['roleIds', 'primaryRoleId'],
} as const;

const userRolesUpdateBodySchema = {
  type: 'object',
  properties: {
    roleIds: { type: 'array', items: { type: 'string' } },
    primaryRoleId: { type: 'string' },
  },
  required: ['roleIds', 'primaryRoleId'],
} as const;

const canViewUserEmails = (request: FastifyRequest) =>
  hasPermission(request, 'administration.user_management_all.view') ||
  hasPermission(request, 'administration.user_management.view');

const canViewAllUsers = (request: FastifyRequest) =>
  hasPermission(request, 'administration.user_management_all.view') ||
  hasPermission(request, 'hr.work_units_all.view');

const CREATE_PERM_BY_EMPLOYEE_TYPE: Record<usersRepo.EmployeeType, string> = {
  app_user: 'administration.user_management.create',
  internal: 'hr.internal.create',
  external: 'hr.external.create',
};

const UPDATE_PERM_BY_EMPLOYEE_TYPE: Record<usersRepo.EmployeeType, string> = {
  app_user: 'administration.user_management.update',
  internal: 'hr.internal.update',
  external: 'hr.external.update',
};

const DELETE_PERM_BY_EMPLOYEE_TYPE: Record<usersRepo.EmployeeType, string> = {
  app_user: 'administration.user_management.delete',
  internal: 'hr.internal.delete',
  external: 'hr.external.delete',
};

const maskUserResponse = (
  user: usersRepo.UserListRow,
  canViewCosts: boolean,
  canRevealUserEmails: boolean,
) => ({
  ...user,
  email: canRevealUserEmails ? user.email : '',
  costPerHour: canViewCosts ? user.costPerHour : 0,
});

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List users
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireAnyPermission(
          'administration.user_management.view',
          'administration.user_management_all.view',
          'hr.internal.view',
          'hr.external.view',
          'timesheets.tracker.view',
          'projects.manage.view',
          'projects.tasks.view',
          'hr.work_units.view',
        ),
      ],
      schema: {
        tags: ['users'],
        summary: 'List users',
        response: {
          200: { type: 'array', items: userSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const canViewUserManagement = hasPermission(request, 'administration.user_management.view');
      const canViewManagedUsers =
        hasPermission(request, 'timesheets.tracker.view') ||
        hasPermission(request, 'hr.work_units.view') ||
        canViewUserManagement;
      const canViewInternal = hasPermission(request, 'hr.internal.view');
      const canViewExternal = hasPermission(request, 'hr.external.view');

      const canViewCosts = hasPermission(request, 'hr.costs.view');
      const canRevealUserEmails = canViewUserEmails(request);

      const users = canViewAllUsers(request)
        ? await usersRepo.listAllForAdmin()
        : await usersRepo.listScopedForManager(request.user.id, {
            canViewManagedUsers,
            canViewInternal,
            canViewExternal,
          });

      return users.map((u) => maskUserResponse(u, canViewCosts, canRevealUserEmails));
    },
  );

  // POST / - Create user (admin only for app_user, manager can create internal/external)
  fastify.post(
    '/',
    {
      onRequest: [
        authenticateToken,
        requireAnyPermission(
          'administration.user_management.create',
          'hr.internal.create',
          'hr.external.create',
        ),
      ],
      schema: {
        tags: ['users'],
        summary: 'Create user',
        body: userCreateBodySchema,
        response: {
          201: userSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, username, password, role, email, costPerHour, employeeType } = request.body as {
        name: string;
        username?: string;
        password?: string;
        role?: string;
        email?: string;
        costPerHour?: number;
        employeeType?: string;
      };

      const employeeTypeResult:
        | { ok: true; value: usersRepo.EmployeeType }
        | { ok: false; message: string } = employeeType
        ? validateEnum(employeeType, ['app_user', 'internal', 'external'] as const, 'employeeType')
        : { ok: true, value: 'app_user' };
      if (!employeeTypeResult.ok) return badRequest(reply, employeeTypeResult.message);

      const effectiveEmployeeType = employeeTypeResult.value;

      if (!hasPermission(request, CREATE_PERM_BY_EMPLOYEE_TYPE[effectiveEmployeeType])) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const emailResult = optionalEmail(email, 'email');
      if (!emailResult.ok) return badRequest(reply, emailResult.message);

      const costPerHourResult = optionalLocalizedNonNegativeNumber(costPerHour, 'costPerHour');
      if (!costPerHourResult.ok) return badRequest(reply, costPerHourResult.message);

      let usernameValue: string;
      let passwordHash: string;
      let roleValue: string;

      if (effectiveEmployeeType === 'internal' || effectiveEmployeeType === 'external') {
        // Internal/external employees never log in: generated username, random unguessable
        // password, default user role kept only for FK consistency.
        usernameValue = generatePrefixedId('emp');
        passwordHash = await bcrypt.hash(randomUUID(), 12);
        roleValue = 'user';
      } else {
        const usernameResult = requireNonEmptyString(username, 'username');
        if (!usernameResult.ok) return badRequest(reply, usernameResult.message);
        usernameValue = usernameResult.value;

        const passwordResult = requireNonEmptyString(password, 'password');
        if (!passwordResult.ok) return badRequest(reply, passwordResult.message);
        passwordHash = await bcrypt.hash(passwordResult.value, 12);

        const roleResult = requireNonEmptyString(role, 'role');
        if (!roleResult.ok) return badRequest(reply, roleResult.message);
        roleValue = roleResult.value;

        const [roleExists, usernameTaken] = await Promise.all([
          rolesRepo.findById(roleValue),
          usersRepo.existsByUsername(usernameValue),
        ]);
        if (!roleExists) return badRequest(reply, 'Invalid role');
        if (usernameTaken) return badRequest(reply, 'Username already exists');
      }

      const avatarInitials = computeAvatarInitials(nameResult.value);
      const id = generatePrefixedId('u');

      try {
        await usersRepo.insertUser({
          id,
          name: nameResult.value,
          username: usernameValue,
          passwordHash,
          role: roleValue,
          avatarInitials,
          costPerHour: costPerHourResult.value || 0,
          isDisabled: false,
          employeeType: effectiveEmployeeType,
        });

        // Keep user_roles in sync with users.role (primary/default role).
        await usersRepo.addUserRole(id, roleValue);

        await settingsRepo.upsertForUser(id, {
          fullName: nameResult.value,
          email: emailResult.value || '',
          language: null,
        });

        if (roleValue === TOP_MANAGER_ROLE_ID) {
          await syncTopManagerAssignmentsForUser(id);
        }

        await logAudit({
          request,
          action: 'user.created',
          entityType: 'user',
          entityId: id,
          details: {
            targetLabel: nameResult.value,
            secondaryLabel: usernameValue,
          },
        });
        return reply.code(201).send({
          id,
          name: nameResult.value,
          username: usernameValue,
          email: canViewUserEmails(request) ? emailResult.value || '' : '',
          role: roleValue,
          avatarInitials,
          costPerHour: costPerHourResult.value || 0,
          isDisabled: false,
          employeeType: effectiveEmployeeType,
          hasTopManagerRole: roleValue === TOP_MANAGER_ROLE_ID,
          isAdminOnly: roleValue === ADMIN_ROLE_ID,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          return badRequest(reply, 'Username already exists');
        }
        throw err;
      }
    },
  );

  // DELETE /:id - Delete user (admin can delete any, manager can delete internal/external only)
  fastify.delete(
    '/:id',
    {
      onRequest: [
        authenticateToken,
        requireAnyPermission(
          'administration.user_management.delete',
          'hr.internal.delete',
          'hr.external.delete',
        ),
      ],
      schema: {
        tags: ['users'],
        summary: 'Delete user',
        params: idParamSchema,
        response: {
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      if (id === request.user?.id) {
        return badRequest(reply, 'Cannot delete your own account');
      }

      const user = await usersRepo.findCoreById(id);
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      if (!hasPermission(request, DELETE_PERM_BY_EMPLOYEE_TYPE[user.employeeType])) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const deleted = await usersRepo.deleteById(id);

      if (!deleted) {
        return reply.code(404).send({ error: 'User not found' });
      }

      await logAudit({
        request,
        action: 'user.deleted',
        entityType: 'user',
        entityId: id,
        details: {
          targetLabel: user.name,
          secondaryLabel: user.username,
        },
      });
      return { message: 'User deleted' };
    },
  );

  // PUT /:id - Update user (admin and manager)
  fastify.put(
    '/:id',
    {
      onRequest: [
        authenticateToken,
        requireAnyPermission(
          'administration.user_management.update',
          'hr.internal.update',
          'hr.external.update',
        ),
      ],
      schema: {
        tags: ['users'],
        summary: 'Update user',
        params: idParamSchema,
        body: userUpdateBodySchema,
        response: {
          200: userSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { name, email, isDisabled, costPerHour, role } = request.body as {
        name?: string;
        email?: string;
        isDisabled?: boolean;
        costPerHour?: number;
        role?: string;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const fields: usersRepo.UserUpdateFields = {};

      if (name !== undefined) {
        const nameResult = requireNonEmptyString(name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
        fields.name = nameResult.value;
      }

      if (costPerHour !== undefined && hasPermission(request, 'hr.costs.update')) {
        const costPerHourResult = optionalLocalizedNonNegativeNumber(costPerHour, 'costPerHour');
        if (!costPerHourResult.ok) return badRequest(reply, costPerHourResult.message);
        fields.costPerHour = costPerHourResult.value;
      }

      let validatedEmail: string | null | undefined;
      if (email !== undefined) {
        const emailResult = optionalEmail(email, 'email');
        if (!emailResult.ok) return badRequest(reply, emailResult.message);
        validatedEmail = emailResult.value;
      }

      const targetUser = await usersRepo.findCoreById(idResult.value);
      if (!targetUser) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const targetEmployeeType = targetUser.employeeType;
      const currentRole = targetUser.role;
      const currentName = targetUser.name;
      const currentUsername = targetUser.username;

      if (!hasPermission(request, UPDATE_PERM_BY_EMPLOYEE_TYPE[targetEmployeeType])) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      if (
        targetEmployeeType === 'app_user' &&
        !hasPermission(request, 'administration.user_management_all.view') &&
        idResult.value !== request.user?.id &&
        !(await usersRepo.canManageUser(idResult.value, request.user?.id ?? ''))
      ) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      let roleValue: string | null = null;
      if (role !== undefined) {
        if (idResult.value === request.user?.id) {
          return reply.code(403).send({ error: 'Cannot change your own role' });
        }
        const roleResult = requireNonEmptyString(role, 'role');
        if (!roleResult.ok) return badRequest(reply, roleResult.message);
        roleValue = roleResult.value;

        const roleExists = await rolesRepo.findById(roleValue);
        if (!roleExists) {
          return badRequest(reply, 'Invalid role');
        }
        fields.role = roleValue;
      }

      if (idResult.value === request.user?.id && isDisabled === true) {
        return badRequest(reply, 'Cannot disable your own account');
      }

      if (isDisabled !== undefined) fields.isDisabled = isDisabled;

      const hasFieldUpdates = Object.keys(fields).length > 0;

      if (!hasFieldUpdates && email === undefined) {
        return badRequest(reply, 'No fields to update');
      }

      if (hasFieldUpdates) {
        const updatedRow = await withDbTransaction(async (tx) => {
          const row = await usersRepo.updateUserDynamic(idResult.value, fields, tx);
          if (row && roleValue !== null) {
            await usersRepo.clearUserRoles(idResult.value, tx);
            await usersRepo.addUserRole(idResult.value, roleValue, tx);
          }
          return row;
        });

        if (!updatedRow) {
          return reply.code(404).send({ error: 'User not found' });
        }
        if (roleValue !== null) {
          await syncTopManagerAssignmentsForUser(idResult.value);
        }
      }

      const changedFields = [
        name !== undefined ? 'name' : null,
        email !== undefined ? 'email' : null,
        isDisabled !== undefined ? 'isDisabled' : null,
        costPerHour !== undefined && hasPermission(request, 'hr.costs.update')
          ? 'costPerHour'
          : null,
        role !== undefined ? 'role' : null,
      ].filter((field): field is string => field !== null);

      let action = 'user.updated';
      if (changedFields.length === 1) {
        if (changedFields[0] === 'isDisabled') {
          action = isDisabled ? 'user.disabled' : 'user.enabled';
        } else if (changedFields[0] === 'role') {
          action = 'user.role_changed';
        }
      }

      // Settings upsert must complete before findById — findById LEFT JOINs settings to
      // populate `email`, and parallel reads on different pool connections can observe the
      // pre-update row under read-committed isolation, returning stale email in the response.
      if (fields.name !== undefined || validatedEmail !== undefined) {
        await settingsRepo.upsertForUser(idResult.value, {
          fullName: fields.name ?? null,
          email: validatedEmail ?? null,
          language: null,
        });
      }
      const fullUser = await usersRepo.findById(idResult.value);
      if (!fullUser) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const canRevealUserEmails = canViewUserEmails(request);

      await logAudit({
        request,
        action,
        entityType: 'user',
        entityId: idResult.value,
        details: {
          targetLabel: fullUser.name || currentName,
          secondaryLabel: fullUser.username || currentUsername,
          changedFields: changedFields.length > 0 ? changedFields : undefined,
          fromValue: role !== undefined ? currentRole : undefined,
          toValue: role !== undefined ? fullUser.role : undefined,
        },
      });
      return maskUserResponse(
        fullUser,
        hasPermission(request, 'hr.costs.view'),
        canRevealUserEmails,
      );
    },
  );

  // GET /:id/roles - Get assigned roles for a user
  fastify.get(
    '/:id/roles',
    {
      onRequest: [authenticateToken, requirePermission('administration.user_management.update')],
      schema: {
        tags: ['users'],
        summary: 'Get user roles',
        params: idParamSchema,
        response: {
          200: userRolesSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const [user, assignedRoleIds] = await Promise.all([
        usersRepo.findCoreById(idResult.value),
        usersRepo.getUserRoleIds(idResult.value),
      ]);
      if (!user) return reply.code(404).send({ error: 'User not found' });

      const primaryRoleId = user.role;
      const roleIds = Array.from(
        new Set(assignedRoleIds.concat(primaryRoleId ? [primaryRoleId] : [])),
      );

      return { roleIds, primaryRoleId };
    },
  );

  // PUT /:id/roles - Replace assigned roles + set primary role
  fastify.put(
    '/:id/roles',
    {
      onRequest: [authenticateToken, requirePermission('administration.user_management.update')],
      schema: {
        tags: ['users'],
        summary: 'Update user roles',
        params: idParamSchema,
        body: userRolesUpdateBodySchema,
        response: {
          200: userRolesSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (idResult.value === request.user?.id) {
        return reply.code(403).send({ error: 'Cannot change your own role' });
      }

      const { roleIds, primaryRoleId } = request.body as {
        roleIds?: unknown;
        primaryRoleId?: unknown;
      };

      const roleIdsResult = ensureArrayOfStrings(roleIds, 'roleIds');
      if (!roleIdsResult.ok) return badRequest(reply, roleIdsResult.message);
      if (roleIdsResult.value.length < 1) return badRequest(reply, 'roleIds must not be empty');

      const primaryRoleIdResult = requireNonEmptyString(primaryRoleId, 'primaryRoleId');
      if (!primaryRoleIdResult.ok) return badRequest(reply, primaryRoleIdResult.message);

      if (!roleIdsResult.value.includes(primaryRoleIdResult.value)) {
        return badRequest(reply, 'primaryRoleId must be included in roleIds');
      }

      const user = await usersRepo.findCoreById(idResult.value);
      if (!user) return reply.code(404).send({ error: 'User not found' });

      const found = await rolesRepo.findExistingIds(roleIdsResult.value);
      const missing = roleIdsResult.value.filter((rid) => !found.has(rid));
      if (missing.length > 0) return badRequest(reply, `Invalid role(s): ${missing.join(', ')}`);

      await withDbTransaction(async (tx) => {
        await usersRepo.replaceUserRoles(idResult.value, roleIdsResult.value, tx);
        await usersRepo.setPrimaryRole(idResult.value, primaryRoleIdResult.value, tx);
      });

      await syncTopManagerAssignmentsForUser(idResult.value);
      await logAudit({
        request,
        action: 'user.roles_updated',
        entityType: 'user',
        entityId: idResult.value,
        details: {
          targetLabel: user.name,
          secondaryLabel: user.username,
          counts: getAuditCounts({ roles: roleIdsResult.value.length }),
          toValue: primaryRoleIdResult.value,
        },
      });
      return { roleIds: roleIdsResult.value, primaryRoleId: primaryRoleIdResult.value };
    },
  );

  // GET /:id/assignments - Get user assignments
  fastify.get(
    '/:id/assignments',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['users'],
        summary: 'Get user assignments',
        params: idParamSchema,
        response: {
          200: assignmentsSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const canViewAssignments =
        request.user?.id === id ||
        hasPermission(request, 'administration.user_management.view') ||
        hasPermission(request, 'administration.user_management.update') ||
        hasPermission(request, 'timesheets.tracker.view') ||
        hasPermission(request, 'hr.employee_assignments.update');

      if (!canViewAssignments) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      if (request.user?.id !== id && !canViewAllUsers(request)) {
        if (!(await usersRepo.canManageUser(idResult.value, request.user?.id ?? ''))) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      }

      return await usersRepo.getAssignments(idResult.value);
    },
  );

  // POST /:id/assignments - Update user assignments
  fastify.post(
    '/:id/assignments',
    {
      onRequest: [authenticateToken, requirePermission('hr.employee_assignments.update')],
      schema: {
        tags: ['users'],
        summary: 'Update user assignments',
        params: idParamSchema,
        body: assignmentsUpdateBodySchema,
        response: {
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { clientIds, projectIds, taskIds } = request.body as {
        clientIds?: string[];
        projectIds?: string[];
        taskIds?: string[];
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (!canViewAllUsers(request) && idResult.value !== request.user?.id) {
        if (!(await usersRepo.canManageUser(idResult.value, request.user?.id ?? ''))) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      }

      const clientIdsResult = optionalArrayOfStrings(clientIds, 'clientIds');
      if (!clientIdsResult.ok) return badRequest(reply, clientIdsResult.message);

      const projectIdsResult = optionalArrayOfStrings(projectIds, 'projectIds');
      if (!projectIdsResult.ok) return badRequest(reply, projectIdsResult.message);

      const taskIdsResult = optionalArrayOfStrings(taskIds, 'taskIds');
      if (!taskIdsResult.ok) return badRequest(reply, taskIdsResult.message);

      const [targetUser, isTopManager] = await Promise.all([
        usersRepo.findCoreById(idResult.value),
        userHasTopManagerRole(idResult.value),
      ]);
      if (!targetUser) return reply.code(404).send({ error: 'User not found' });

      if (isTopManager) {
        return reply.code(409).send({
          error: 'Top Manager assignments are managed automatically and cannot be edited manually',
        });
      }

      const resolvedClientIds = (clientIdsResult as { ok: true; value: string[] | null }).value;
      const resolvedProjectIds = (projectIdsResult as { ok: true; value: string[] | null }).value;
      const resolvedTaskIds = (taskIdsResult as { ok: true; value: string[] | null }).value;

      await withDbTransaction(async (tx) => {
        if (clientIds) {
          await usersRepo.replaceUserClients(
            idResult.value,
            resolvedClientIds ?? [],
            MANUAL_ASSIGNMENT_SOURCE,
            tx,
          );
        }

        if (projectIds) {
          await usersRepo.replaceUserProjects(
            idResult.value,
            resolvedProjectIds ?? [],
            MANUAL_ASSIGNMENT_SOURCE,
            tx,
          );
        }

        if (taskIds) {
          await usersRepo.replaceUserTasks(
            idResult.value,
            resolvedTaskIds ?? [],
            MANUAL_ASSIGNMENT_SOURCE,
            tx,
          );
        }

        if (projectIds || clientIds) {
          await usersRepo.clearProjectCascadeAssignments(idResult.value, tx);
        }

        await usersRepo.applyProjectCascadeToClients(idResult.value, tx);
      });

      await logAudit({
        request,
        action: 'user.assignments_updated',
        entityType: 'user',
        entityId: idResult.value,
        details: {
          targetLabel: targetUser.name,
          secondaryLabel: targetUser.username,
          counts: getAuditCounts({
            clients: clientIds ? (resolvedClientIds?.length ?? 0) : undefined,
            projects: projectIds ? (resolvedProjectIds?.length ?? 0) : undefined,
            tasks: taskIds ? (resolvedTaskIds?.length ?? 0) : undefined,
          }),
        },
      });
      return { message: 'Assignments updated' };
    },
  );
}
