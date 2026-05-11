import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, generateToken } from '../middleware/auth.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { applyExternalRoleIdsForUser } from '../services/external-auth.ts';
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
    email: { type: 'string' },
    costPerHour: { type: 'number' },
    isDisabled: { type: 'boolean' },
    employeeType: { type: 'string', enum: ['app_user', 'internal', 'external'] },
    authMethod: { type: 'string', enum: ['local', 'ldap', 'oidc', 'saml'] },
    authProviderId: { type: ['string', 'null'] },
    authProviderName: { type: ['string', 'null'] },
    hasTopManagerRole: { type: 'boolean' },
    isAdminOnly: { type: 'boolean' },
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
  required: [
    'id',
    'name',
    'username',
    'role',
    'avatarInitials',
    'email',
    'costPerHour',
    'employeeType',
    'authMethod',
    'permissions',
    'availableRoles',
  ],
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

type AvailableRole = { id: string; name: string; isSystem: boolean; isAdmin: boolean };
type CanonicalAuthUser = usersRepo.UserListRow & {
  permissions: string[];
  availableRoles: AvailableRole[];
};

// When the user has no explicit role assignments yet, synthesize a single
// "available role" from the effective role so the client always has at least
// one entry to render (matches the historical /login fallback).
const fallbackAvailableRoles = (effectiveRole: string): AvailableRole[] => [
  { id: effectiveRole, name: effectiveRole, isSystem: false, isAdmin: effectiveRole === 'admin' },
];

const buildCanonicalAuthUser = async (
  userId: string,
  effectiveRole: string,
  permissions: string[],
): Promise<CanonicalAuthUser | null> => {
  const [fullUser, availableRoles] = await Promise.all([
    usersRepo.findById(userId),
    rolesRepo.listAvailableRolesForUser(userId),
  ]);

  if (!fullUser) return null;

  return {
    ...fullUser,
    role: effectiveRole,
    permissions,
    availableRoles:
      availableRoles.length > 0 ? availableRoles : fallbackAvailableRoles(effectiveRole),
  };
};

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

      let user = await usersRepo.findLoginUserByUsername(usernameResult.value);

      if (!user) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      if (user.isDisabled || user.employeeType !== 'app_user') {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      const { authMethod } = user;

      // LDAP Authentication
      let ldapAuthSuccess = false;
      let ldapRoleIds: string[] = [];
      if (authMethod === 'ldap') {
        try {
          const ldapService = (await import('../services/ldap.ts')).default;
          const ldapAuthResult = await ldapService.authenticateWithProfile(
            usernameResult.value,
            passwordResult.value,
          );
          ldapAuthSuccess = ldapAuthResult.authenticated;
          ldapRoleIds = ldapAuthResult.roleIds;
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          fastify.log.warn(
            { username: usernameResult.value, errorMessage },
            'LDAP auth attempt failed',
          );
        }
      }

      let validPassword = false;
      if (ldapAuthSuccess) {
        validPassword = true;
      } else if (authMethod === 'local' && user.passwordHash) {
        validPassword = await bcrypt.compare(passwordResult.value, user.passwordHash);
      }

      if (!validPassword) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      if (ldapAuthSuccess) {
        const roleIds = await applyExternalRoleIdsForUser(user.id, ldapRoleIds);
        user = { ...user, role: roleIds[0] };
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

      const canonicalUser = await buildCanonicalAuthUser(user.id, user.role, permissions);
      if (!canonicalUser) {
        return reply.code(500).send({ error: 'Authenticated user not found' });
      }

      return {
        token,
        user: canonicalUser,
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id;
      const role = request.user?.role;
      if (!userId || !role) {
        return reply.code(401).send({ error: 'Authentication required' });
      }
      const canonicalUser = await buildCanonicalAuthUser(
        userId,
        role,
        request.user?.permissions ?? [],
      );
      if (!canonicalUser) {
        return reply.code(401).send({ error: 'User not found' });
      }
      return canonicalUser;
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

      if (request.auth?.source === 'personalAccessToken') {
        return reply.code(403).send({ error: 'Session authentication required' });
      }

      const userId = request.user?.id;
      if (!userId) return reply.code(401).send({ error: 'Authentication required' });

      const hasRole = await rolesRepo.userHasRole(userId, roleIdResult.value);
      if (!hasRole) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const permissions = await getRolePermissions(roleIdResult.value);
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

      const canonicalUser = await buildCanonicalAuthUser(userId, roleIdResult.value, permissions);
      if (!canonicalUser) {
        return reply.code(401).send({ error: 'User not found' });
      }

      return {
        token,
        user: canonicalUser,
      };
    },
  );
}
