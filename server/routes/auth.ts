import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateToken,
  generateToken,
  getSessionAuth,
  requireSessionAuth,
} from '../middleware/auth.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { applyExternalRoleIdsForUserIfMatched } from '../services/external-auth.ts';
import * as ssoService from '../services/sso.ts';
import { logAudit } from '../utils/audit.ts';
import { getRolePermissions } from '../utils/permissions.ts';
import { LOGIN_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
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

const LDAP_UNAVAILABLE_BODY = {
  error: 'Authentication service temporarily unavailable',
  errorCode: 'ldap_unavailable',
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

      let user = await usersRepo.findLoginUserByUsername(usernameResult.value);
      let ldapAutoProvisionSuccess = false;
      let ldapAutoProvisioned = false;

      if (!user) {
        try {
          const ldapService = (await import('../services/ldap.ts')).default;
          const provision = await ldapService.authenticateAndProvision(
            usernameResult.value,
            passwordResult.value,
          );
          if (provision.authenticated && provision.userId) {
            user = await usersRepo.findLoginUserById(provision.userId);
            ldapAutoProvisionSuccess = !!user;
            ldapAutoProvisioned = !!provision.created;
          }
        } catch (err) {
          fastify.log.error(
            { err, username: usernameResult.value },
            'LDAP auto-provision attempt failed',
          );
          return reply.code(503).send(LDAP_UNAVAILABLE_BODY);
        }
        if (!user) {
          return reply.code(401).send({ error: 'Invalid username or password' });
        }
      }

      if (user.isDisabled || user.employeeType !== 'app_user') {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      const { authMethod } = user;

      // LDAP Authentication
      let ldapAuthSuccess = ldapAutoProvisionSuccess;
      let ldapMatchedRoleIds: string[] = [];
      let ldapGroups: string[] = [];
      if (!ldapAuthSuccess && authMethod === 'ldap') {
        try {
          const ldapService = (await import('../services/ldap.ts')).default;
          const ldapAuthResult = await ldapService.authenticateWithProfile(
            usernameResult.value,
            passwordResult.value,
          );
          ldapAuthSuccess = ldapAuthResult.authenticated;
          ldapMatchedRoleIds = ldapAuthResult.matchedRoleIds;
          ldapGroups = ldapAuthResult.groups;
        } catch (err) {
          fastify.log.error({ err, username: usernameResult.value }, 'LDAP auth attempt failed');
          return reply.code(503).send(LDAP_UNAVAILABLE_BODY);
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

      if (ldapAuthSuccess && !ldapAutoProvisionSuccess) {
        const applied = await applyExternalRoleIdsForUserIfMatched(user.id, ldapMatchedRoleIds);
        if (applied.applied) {
          user = { ...user, role: applied.roleIds[0] };
        } else {
          fastify.log.warn(
            {
              userId: user.id,
              username: user.username,
              groups: ldapGroups,
              currentRole: user.role,
            },
            'LDAP login: no LDAP group matched a role mapping — preserving existing role',
          );
        }
      }

      if (ldapAutoProvisioned) {
        await logAudit({
          request,
          action: 'user.created',
          entityType: 'user',
          entityId: user.id,
          details: {
            targetLabel: user.name,
            secondaryLabel: user.username,
          },
          userId: user.id,
        });
      }

      const token = generateToken(user.id, Date.now(), user.role, user.sessionVersion);
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
      onRequest: [authenticateToken, requireSessionAuth],
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

      const session = getSessionAuth(request);

      const hasRole = await rolesRepo.userHasRole(session.userId, roleIdResult.value, {
        requireEnabledUser: true,
        expectedSessionVersion: session.sessionVersion,
      });
      if (!hasRole) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'auth.role_switch.denied',
          entityType: 'role',
          entityId: roleIdResult.value,
          details: { targetLabel: roleIdResult.value, secondaryLabel: 'role_switch' },
        });
      }

      const permissions = await getRolePermissions(roleIdResult.value);
      const availableRoles = await rolesRepo.listAvailableRolesForUser(session.userId);
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
        session.userId,
        session.sessionStart,
        roleIdResult.value,
        session.sessionVersion,
      );
      reply.header('x-auth-token', token);

      await logAudit({
        request,
        action: 'user.role_switched',
        entityType: 'user',
        entityId: session.userId,
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
          id: session.userId,
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

  // Bumping session_version invalidates the caller's token (and any other live tokens
  // for the same user) on the next authenticated request. For OIDC users on a provider
  // with `endSessionEnabled`, the response also carries `endSessionUrl` so the frontend
  // can redirect to the IdP's RP-Initiated Logout endpoint — otherwise the IdP cookie
  // outlives the Praetor session and a fresh SSO attempt silently re-enters as the
  // previous user.
  fastify.post(
    '/logout',
    {
      onRequest: [authenticateToken, requireSessionAuth],
      schema: {
        tags: ['auth'],
        summary: 'Logout (revoke all sessions for this user)',
        response: {
          200: {
            type: 'object',
            properties: {
              endSessionUrl: { type: ['string', 'null'] },
            },
            required: ['endSessionUrl'],
          },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = getSessionAuth(request);

      // Resolve the IdP end-session URL before bumping session_version: a broken IdP
      // must never block the local logout, so we swallow the rejection and proceed.
      let endSessionUrl: string | null = null;
      try {
        endSessionUrl = await ssoService.endOidcSession(session.userId);
      } catch (err) {
        request.log.warn({ err, userId: session.userId }, 'OIDC end-session URL build failed');
      }

      await Promise.all([
        usersRepo.bumpSessionVersion(session.userId),
        logAudit({
          request,
          action: 'user.logout',
          entityType: 'user',
          entityId: session.userId,
          details: {
            targetLabel: request.user?.name,
            secondaryLabel: request.user?.username,
          },
        }),
      ]);

      // The sliding-window refresh in authenticateToken already wrote a rotated token
      // to x-auth-token. After the bump above, that token is revoked — strip it so the
      // client doesn't persist a doomed token into localStorage.
      reply.removeHeader('x-auth-token');
      return { endSessionUrl };
    },
  );
}
