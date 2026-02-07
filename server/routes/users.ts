import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import { messageResponseSchema, standardErrorResponses } from '../schemas/common.ts';
import {
  badRequest,
  optionalArrayOfStrings,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
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
    role: { type: 'string' },
    avatarInitials: { type: 'string' },
    costPerHour: { type: 'number' },
    isDisabled: { type: 'boolean' },
    employeeType: { type: 'string', enum: ['app_user', 'internal', 'external'] },
  },
  required: [
    'id',
    'name',
    'username',
    'role',
    'avatarInitials',
    'costPerHour',
    'isDisabled',
    'employeeType',
  ],
} as const;

const userCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string' },
    role: { type: 'string' },
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

const hasPermission = (request: FastifyRequest, permission: string) =>
  request.user?.permissions?.includes(permission) ?? false;

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List users
  fastify.get(
    '/',
    {
      onRequest: [
        authenticateToken,
        requireAnyPermission(
          'administration.user_management.view',
          'administration.user_management_all.view',
          'hr.internal.view',
          'hr.external.view',
          'timesheets.tracker.view',
          'projects.manage.view',
          'projects.tasks.view',
          'administration.work_units.view',
        ),
      ],
      schema: {
        tags: ['users'],
        summary: 'List users',
        response: {
          200: { type: 'array', items: userSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const canViewAllUsers = hasPermission(request, 'administration.user_management_all.view');
      const canViewUserManagement = hasPermission(request, 'administration.user_management.view');
      const canViewManagedUsers =
        hasPermission(request, 'timesheets.tracker.view') ||
        hasPermission(request, 'administration.work_units.view') ||
        canViewUserManagement;
      const canViewInternal = hasPermission(request, 'hr.internal.view');
      const canViewExternal = hasPermission(request, 'hr.external.view');

      let result: Awaited<ReturnType<typeof query>>;
      if (canViewAllUsers) {
        result = await query(
          'SELECT id, name, username, role, avatar_initials, cost_per_hour, is_disabled, employee_type FROM users ORDER BY name',
        );
      } else {
        const conditions: string[] = ['u.id = $1'];
        if (canViewManagedUsers) {
          conditions.push('wum.user_id = $1');
        }
        if (canViewInternal) {
          conditions.push("u.employee_type = 'internal'");
        }
        if (canViewExternal) {
          conditions.push("u.employee_type = 'external'");
        }

        result = await query(
          `SELECT DISTINCT u.id, u.name, u.username, u.role, u.avatar_initials, u.cost_per_hour, u.is_disabled, u.employee_type
                 FROM users u
                 LEFT JOIN user_work_units uw ON u.id = uw.user_id
                 LEFT JOIN work_unit_managers wum ON uw.work_unit_id = wum.work_unit_id
                 WHERE ${conditions.join(' OR ')}
                 ORDER BY u.name`,
          [request.user?.id],
        );
      }
      const users = result.rows.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        role: u.role,
        avatarInitials: u.avatar_initials,
        costPerHour: parseFloat(u.cost_per_hour || 0),
        isDisabled: !!u.is_disabled,
        employeeType: u.employee_type || 'app_user',
      }));

      return users;
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
      const { name, username, password, role, costPerHour, employeeType } = request.body as {
        name: string;
        username?: string;
        password?: string;
        role?: string;
        costPerHour?: number;
        employeeType?: string;
      };

      // Validate employee type if provided
      const employeeTypeResult = employeeType
        ? validateEnum(employeeType, ['app_user', 'internal', 'external'], 'employeeType')
        : { ok: true, value: 'app_user' };
      if (!employeeTypeResult.ok)
        return badRequest(reply, (employeeTypeResult as { ok: false; message: string }).message);

      const effectiveEmployeeType = (employeeTypeResult as { ok: true; value: string }).value;

      const canCreateAppUser = hasPermission(request, 'administration.user_management.create');
      const canCreateInternal = hasPermission(request, 'hr.internal.create');
      const canCreateExternal = hasPermission(request, 'hr.external.create');

      if (effectiveEmployeeType === 'app_user' && !canCreateAppUser) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      if (effectiveEmployeeType === 'internal' && !canCreateInternal) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      if (effectiveEmployeeType === 'external' && !canCreateExternal) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const costPerHourResult = optionalLocalizedNonNegativeNumber(costPerHour, 'costPerHour');
      if (!costPerHourResult.ok) return badRequest(reply, costPerHourResult.message);

      let usernameValue: string;
      let passwordHash: string;
      let roleValue: string;

      if (effectiveEmployeeType === 'internal' || effectiveEmployeeType === 'external') {
        // Internal/external employees: generate dummy username, placeholder password, user role
        usernameValue = `emp-${randomUUID()}`;
        passwordHash = await bcrypt.hash(randomUUID(), 12); // Random unguessable password
        roleValue = 'user'; // Internal/external employees have user role but cannot login
      } else {
        // App users: require username, password, and role
        const usernameResult = requireNonEmptyString(username, 'username');
        if (!usernameResult.ok) return badRequest(reply, usernameResult.message);
        usernameValue = usernameResult.value;

        const passwordResult = requireNonEmptyString(password, 'password');
        if (!passwordResult.ok) return badRequest(reply, passwordResult.message);
        passwordHash = await bcrypt.hash(passwordResult.value, 12);

        const roleResult = requireNonEmptyString(role, 'role');
        if (!roleResult.ok) return badRequest(reply, roleResult.message);
        roleValue = roleResult.value;

        const roleCheck = await query('SELECT id FROM roles WHERE id = $1', [roleValue]);
        if (roleCheck.rows.length === 0) {
          return badRequest(reply, 'Invalid role');
        }

        // Check username uniqueness for app users
        const existingUser = await query('SELECT id FROM users WHERE username = $1', [
          usernameValue,
        ]);
        if (existingUser.rows.length > 0) {
          return badRequest(reply, 'Username already exists');
        }
      }

      const avatarInitials = nameResult.value
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
      const id = 'u-' + Date.now();

      try {
        await query(
          `INSERT INTO users (id, name, username, password_hash, role, avatar_initials, cost_per_hour, is_disabled, employee_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            nameResult.value,
            usernameValue,
            passwordHash,
            roleValue,
            avatarInitials,
            costPerHourResult.value || 0,
            false,
            effectiveEmployeeType,
          ],
        );

        return reply.code(201).send({
          id,
          name: nameResult.value,
          username: usernameValue,
          role: roleValue,
          avatarInitials,
          costPerHour: costPerHourResult.value || 0,
          isDisabled: false,
          employeeType: effectiveEmployeeType,
        });
      } catch (err) {
        const error = err as DatabaseError;
        if (error.code === '23505') {
          // Unique violation
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

      // Check the user's employee type
      const userCheck = await query('SELECT employee_type FROM users WHERE id = $1', [id]);
      if (userCheck.rows.length === 0) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const employeeType = userCheck.rows[0].employee_type || 'app_user';

      if (employeeType === 'app_user') {
        if (!hasPermission(request, 'administration.user_management.delete')) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      }

      if (employeeType === 'internal') {
        if (!hasPermission(request, 'hr.internal.delete')) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      }

      if (employeeType === 'external') {
        if (!hasPermission(request, 'hr.external.delete')) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      }

      const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'User not found' });
      }

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
      const { name, isDisabled, costPerHour, role } = request.body as {
        name?: string;
        isDisabled?: boolean;
        costPerHour?: number;
        role?: string;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (name !== undefined) {
        const nameResult = optionalNonEmptyString(name, 'name');
        if (!nameResult.ok)
          return badRequest(reply, (nameResult as { ok: false; message: string }).message);
      }

      if (costPerHour !== undefined) {
        const costPerHourResult = optionalLocalizedNonNegativeNumber(costPerHour, 'costPerHour');
        if (!costPerHourResult.ok)
          return badRequest(reply, (costPerHourResult as { ok: false; message: string }).message);
      }

      const targetUserResult = await query(
        'SELECT id, role, employee_type FROM users WHERE id = $1',
        [idResult.value],
      );
      if (targetUserResult.rows.length === 0) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const targetEmployeeType = targetUserResult.rows[0].employee_type || 'app_user';

      if (targetEmployeeType === 'app_user') {
        if (!hasPermission(request, 'administration.user_management.update')) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }

        if (
          !hasPermission(request, 'administration.user_management_all.view') &&
          idResult.value !== request.user?.id
        ) {
          const managedCheck = await query(
            `SELECT 1
               FROM user_work_units uw
               JOIN work_unit_managers wum ON uw.work_unit_id = wum.work_unit_id
               WHERE uw.user_id = $1 AND wum.user_id = $2
               LIMIT 1`,
            [idResult.value, request.user?.id],
          );
          if (managedCheck.rows.length === 0) {
            return reply.code(403).send({ error: 'Insufficient permissions' });
          }
        }
      }

      if (targetEmployeeType === 'internal') {
        if (!hasPermission(request, 'hr.internal.update')) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      }

      if (targetEmployeeType === 'external') {
        if (!hasPermission(request, 'hr.external.update')) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      }

      let roleValue: string | null = null;
      if (role !== undefined) {
        if (idResult.value === request.user?.id) {
          return reply.code(403).send({ error: 'Cannot change your own role' });
        }
        const roleResult = requireNonEmptyString(role, 'role');
        if (!roleResult.ok) return badRequest(reply, roleResult.message);
        roleValue = roleResult.value;

        const roleCheck = await query('SELECT id FROM roles WHERE id = $1', [roleValue]);
        if (roleCheck.rows.length === 0) {
          return badRequest(reply, 'Invalid role');
        }
      }

      if (idResult.value === request.user?.id && isDisabled === true) {
        return badRequest(reply, 'Cannot disable your own account');
      }

      const updates = [];
      const values = [];
      let paramIdx = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIdx++}`);
        values.push((requireNonEmptyString(name, 'name') as { ok: true; value: string }).value);
      }

      if (isDisabled !== undefined) {
        updates.push(`is_disabled = $${paramIdx++}`);
        values.push(isDisabled);
      }

      if (costPerHour !== undefined) {
        updates.push(`cost_per_hour = $${paramIdx++}`);
        values.push(
          (
            optionalLocalizedNonNegativeNumber(costPerHour, 'costPerHour') as {
              ok: true;
              value: number | null;
            }
          ).value,
        );
      }

      if (role !== undefined) {
        updates.push(`role = $${paramIdx++}`);
        values.push(roleValue);
      }

      if (updates.length === 0) {
        return badRequest(reply, 'No fields to update');
      }

      values.push(idResult.value);
      const result = await query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id, name, username, role, avatar_initials, cost_per_hour, is_disabled, employee_type`,
        values,
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const u = result.rows[0];

      return {
        id: u.id,
        name: u.name,
        username: u.username,
        role: u.role,
        avatarInitials: u.avatar_initials,
        costPerHour: parseFloat(u.cost_per_hour || 0),
        isDisabled: !!u.is_disabled,
        employeeType: u.employee_type || 'app_user',
      };
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

      const canViewAllUsers = hasPermission(request, 'administration.user_management_all.view');
      const canViewAssignments =
        request.user?.id === id ||
        hasPermission(request, 'administration.user_management.view') ||
        hasPermission(request, 'administration.user_management.update') ||
        hasPermission(request, 'timesheets.tracker.view');

      if (!canViewAssignments) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      if (request.user?.id !== id && !canViewAllUsers) {
        const managedCheck = await query(
          `SELECT 1
             FROM user_work_units uw
             JOIN work_unit_managers wum ON uw.work_unit_id = wum.work_unit_id
             WHERE uw.user_id = $1 AND wum.user_id = $2
             LIMIT 1`,
          [idResult.value, request.user?.id],
        );
        if (managedCheck.rows.length === 0) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      }

      const clientsRes = await query('SELECT client_id FROM user_clients WHERE user_id = $1', [
        idResult.value,
      ]);
      const projectsRes = await query('SELECT project_id FROM user_projects WHERE user_id = $1', [
        idResult.value,
      ]);
      const tasksRes = await query('SELECT task_id FROM user_tasks WHERE user_id = $1', [
        idResult.value,
      ]);

      return {
        clientIds: clientsRes.rows.map((r) => r.client_id),
        projectIds: projectsRes.rows.map((r) => r.project_id),
        taskIds: tasksRes.rows.map((r) => r.task_id),
      };
    },
  );

  // POST /:id/assignments - Update user assignments (manager only)
  fastify.post(
    '/:id/assignments',
    {
      onRequest: [authenticateToken, requirePermission('administration.user_management.update')],
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

      if (
        !hasPermission(request, 'administration.user_management_all.view') &&
        idResult.value !== request.user?.id
      ) {
        const managedCheck = await query(
          `SELECT 1
             FROM user_work_units uw
             JOIN work_unit_managers wum ON uw.work_unit_id = wum.work_unit_id
             WHERE uw.user_id = $1 AND wum.user_id = $2
             LIMIT 1`,
          [idResult.value, request.user?.id],
        );
        if (managedCheck.rows.length === 0) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      }

      const clientIdsResult = optionalArrayOfStrings(clientIds, 'clientIds');
      if (!clientIdsResult.ok)
        return badRequest(reply, (clientIdsResult as { ok: false; message: string }).message);

      const projectIdsResult = optionalArrayOfStrings(projectIds, 'projectIds');
      if (!projectIdsResult.ok)
        return badRequest(reply, (projectIdsResult as { ok: false; message: string }).message);

      const taskIdsResult = optionalArrayOfStrings(taskIds, 'taskIds');
      if (!taskIdsResult.ok)
        return badRequest(reply, (taskIdsResult as { ok: false; message: string }).message);

      try {
        await query('BEGIN');

        // Update Clients
        if (clientIds) {
          await query('DELETE FROM user_clients WHERE user_id = $1', [idResult.value]);
          for (const clientId of (clientIdsResult as { ok: true; value: string[] | null }).value ||
            []) {
            await query(
              'INSERT INTO user_clients (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [idResult.value, clientId],
            );
          }
        }

        // Update Projects
        if (projectIds) {
          await query('DELETE FROM user_projects WHERE user_id = $1', [idResult.value]);
          for (const projectId of (projectIdsResult as { ok: true; value: string[] | null })
            .value || []) {
            await query(
              'INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [idResult.value, projectId],
            );
          }
        }

        // Update Tasks
        if (taskIds) {
          await query('DELETE FROM user_tasks WHERE user_id = $1', [idResult.value]);
          for (const taskId of (taskIdsResult as { ok: true; value: string[] | null }).value ||
            []) {
            await query(
              'INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [idResult.value, taskId],
            );
          }
        }

        await query('COMMIT');
        return { message: 'Assignments updated' };
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    },
  );
}
