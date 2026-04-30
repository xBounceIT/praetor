import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, generateToken } from '../middleware/auth.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { getRolePermissions } from '../utils/permissions.ts';
import { LOGIN_RATE_LIMIT } from '../utils/rate-limit.ts';
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

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // POST /login
  fastify.post(
    '/login',
    {
      onRequest: fastify.rateLimit(LOGIN_RATE_LIMIT),
      schema: {
        tags: ['auth'],
        summary: 'Login',
        body: loginBodySchema,
        security: [],
        response: {
          200: loginResponseSchema,
          ...standardRateLimitedErrorResponses,
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

      const user = await usersRepo.findLoginUserByUsername(usernameResult.value);

      if (!user) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      if (user.isDisabled) {
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
        fastify.log.warn(
          { username: usernameResult.value, errorMessage },
          'LDAP auth attempt failed; falling back to local password validation',
        );
      }

      let validPassword = false;
      if (ldapAuthSuccess) {
        validPassword = true;
      } else if (user.passwordHash) {
        validPassword = await bcrypt.compare(passwordResult.value, user.passwordHash);
      }

      if (!validPassword) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      const token = generateToken(user.id, Date.now(), user.role);
      const permissions = await getRolePermissions(user.role);

      await logAudit({
        request,
        action: 'user.login',
        entityType: 'user',
        entityId: user.id,
        details: {
          targetLabel: user.name,
          secondaryLabel: user.role,
        },
        userId: user.id,
      });
      const availableRoles = await rolesRepo.listAvailableRolesForUser(user.id);
      const effectiveAvailableRoles =
        availableRoles.length > 0
          ? availableRoles
          : [
              {
                id: user.role,
                name: user.role,
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
          avatarInitials: user.avatarInitials,
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
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const availableRoles = request.user?.id
        ? await rolesRepo.listAvailableRolesForUser(request.user.id)
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
        avatarInitials: request.user?.avatarInitials,
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
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { roleId } = request.body as { roleId: unknown };
      const roleIdResult = requireNonEmptyString(roleId, 'roleId');
      if (!roleIdResult.ok) return badRequest(reply, roleIdResult.message);

      const userId = request.user?.id;
      if (!userId) return reply.code(401).send({ error: 'Authentication required' });

      const hasRole = await rolesRepo.userHasRole(userId, roleIdResult.value);
      if (!hasRole) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const permissions = await getRolePermissions(roleIdResult.value);
      const availableRoles = await rolesRepo.listAvailableRolesForUser(userId);
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

      await logAudit({
        request,
        action: 'user.role_switched',
        entityType: 'user',
        entityId: userId,
        details: {
          targetLabel: request.user?.name,
          secondaryLabel: request.user?.username,
          fromValue: request.user?.role,
          toValue: roleIdResult.value,
        },
      });

      return {
        token,
        user: {
          id: userId,
          name: request.user?.name,
          username: request.user?.username,
          role: roleIdResult.value,
          avatarInitials: request.user?.avatarInitials,
          permissions,
          availableRoles: effectiveAvailableRoles,
        },
      };
    },
  );
}
