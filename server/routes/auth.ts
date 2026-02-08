import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, generateToken } from '../middleware/auth.ts';
import { errorResponseSchema, standardErrorResponses } from '../schemas/common.ts';
import { getRolePermissions } from '../utils/permissions.ts';
import { badRequest, requireNonEmptyString } from '../utils/validation.ts';

const authUserSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    username: { type: 'string' },
    role: { type: 'string' },
    avatarInitials: { type: 'string' },
    permissions: { type: 'array', items: { type: 'string' } },
    availableRoles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          isSystem: { type: 'boolean' },
          isAdmin: { type: 'boolean' },
        },
        required: ['id', 'name', 'isSystem', 'isAdmin'],
      },
    },
  },
  required: ['id', 'name', 'username', 'role', 'avatarInitials', 'permissions', 'availableRoles'],
} as const;

const loginBodySchema = {
  type: 'object',
  properties: {
    username: { type: 'string' },
    password: { type: 'string' },
  },
  required: ['username', 'password'],
} as const;

const switchRoleBodySchema = {
  type: 'object',
  properties: {
    roleId: { type: 'string' },
  },
  required: ['roleId'],
} as const;

const loginResponseSchema = {
  type: 'object',
  properties: {
    token: { type: 'string' },
    user: authUserSchema,
  },
  required: ['token', 'user'],
} as const;

const getAvailableRolesForUser = async (userId: string) => {
  try {
    const result = await query(
      `SELECT r.id, r.name, r.is_system, r.is_admin
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
        ORDER BY r.name`,
      [userId],
    );

    return result.rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      isSystem: !!r.is_system,
      isAdmin: !!r.is_admin,
    }));
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === '42P01') return []; // undefined_table during startup migrations
    throw err;
  }
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // POST /login
  fastify.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Login',
        body: loginBodySchema,
        security: [],
        response: {
          200: loginResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { username, password } = request.body as { username: unknown; password: unknown };

      const usernameResult = requireNonEmptyString(username, 'username');
      if (!usernameResult.ok) {
        return badRequest(reply, usernameResult.message);
      }

      const passwordResult = requireNonEmptyString(password, 'password');
      if (!passwordResult.ok) {
        return badRequest(reply, passwordResult.message);
      }

      const result = await query(
        'SELECT id, name, username, password_hash, role, avatar_initials, is_disabled FROM users WHERE username = $1',
        [usernameResult.value],
      );

      if (result.rows.length === 0) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      const user = result.rows[0];

      if (user.is_disabled) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      // LDAP Authentication
      let ldapAuthSuccess = false;
      try {
        const ldapService = (await import('../services/ldap.ts')).default;
        ldapAuthSuccess = await ldapService.authenticate(
          usernameResult.value,
          passwordResult.value,
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('LDAP Auth Attempt Failed:', errorMessage);
      }

      let validPassword = false;
      if (ldapAuthSuccess) {
        validPassword = true;
      } else {
        validPassword = await bcrypt.compare(passwordResult.value, user.password_hash);
      }

      if (!validPassword) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      const token = generateToken(user.id, Date.now(), user.role);
      const permissions = await getRolePermissions(user.role);
      const availableRoles = await getAvailableRolesForUser(user.id);
      const effectiveAvailableRoles =
        availableRoles.length > 0
          ? availableRoles
          : [
              {
                id: user.role as string,
                name: user.role as string,
                isSystem: false,
                isAdmin: user.role === 'admin',
              },
            ];

      return {
        token,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          avatarInitials: user.avatar_initials,
          permissions,
          availableRoles: effectiveAvailableRoles,
        },
      };
    },
  );

  // GET /me - Get current user
  fastify.get(
    '/me',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['auth'],
        summary: 'Get current user',
        response: {
          200: authUserSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const availableRoles = request.user?.id
        ? await getAvailableRolesForUser(request.user.id)
        : [];
      const effectiveAvailableRoles =
        availableRoles.length > 0
          ? availableRoles
          : [
              {
                id: request.user?.role as string,
                name: request.user?.role as string,
                isSystem: false,
                isAdmin: request.user?.role === 'admin',
              },
            ];
      return {
        id: request.user?.id,
        name: request.user?.name,
        username: request.user?.username,
        role: request.user?.role,
        avatarInitials: request.user?.avatar_initials,
        permissions: request.user?.permissions || [],
        availableRoles: effectiveAvailableRoles,
      };
    },
  );

  // POST /switch-role - Switch the active role for this session
  fastify.post(
    '/switch-role',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['auth'],
        summary: 'Switch active role (session-only)',
        body: switchRoleBodySchema,
        response: {
          200: loginResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { roleId } = request.body as { roleId: unknown };
      const roleIdResult = requireNonEmptyString(roleId, 'roleId');
      if (!roleIdResult.ok) return badRequest(reply, roleIdResult.message);

      const userId = request.user?.id;
      if (!userId) return reply.code(401).send({ error: 'Authentication required' });

      try {
        const membership = await query(
          'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 LIMIT 1',
          [userId, roleIdResult.value],
        );
        if (membership.rows.length === 0) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === '42P01') {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
        throw err;
      }

      const permissions = await getRolePermissions(roleIdResult.value);
      const availableRoles = await getAvailableRolesForUser(userId);
      const effectiveAvailableRoles =
        availableRoles.length > 0
          ? availableRoles
          : [
              {
                id: roleIdResult.value,
                name: roleIdResult.value,
                isSystem: false,
                isAdmin: roleIdResult.value === 'admin',
              },
            ];
      const token = generateToken(
        userId,
        request.auth?.sessionStart ?? Date.now(),
        roleIdResult.value,
      );
      reply.header('x-auth-token', token);

      return {
        token,
        user: {
          id: userId,
          name: request.user?.name,
          username: request.user?.username,
          role: roleIdResult.value,
          avatarInitials: request.user?.avatar_initials,
          permissions,
          availableRoles: effectiveAvailableRoles,
        },
      };
    },
  );
}
