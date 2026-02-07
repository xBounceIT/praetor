import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.ts';
import { generateToken, authenticateToken } from '../middleware/auth.ts';
import { getRolePermissions } from '../utils/permissions.ts';
import { requireNonEmptyString, badRequest } from '../utils/validation.ts';
import { errorResponseSchema, standardErrorResponses } from '../schemas/common.ts';

const authUserSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    username: { type: 'string' },
    role: { type: 'string' },
    avatarInitials: { type: 'string' },
    permissions: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'name', 'username', 'role', 'avatarInitials', 'permissions'],
} as const;

const loginBodySchema = {
  type: 'object',
  properties: {
    username: { type: 'string' },
    password: { type: 'string' },
  },
  required: ['username', 'password'],
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

      const token = generateToken(user.id);
      const permissions = await getRolePermissions(user.role);

      return {
        token,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          avatarInitials: user.avatar_initials,
          permissions,
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
      return {
        id: request.user!.id,
        name: request.user!.name,
        username: request.user!.username,
        role: request.user!.role,
        avatarInitials: request.user!.avatar_initials,
        permissions: request.user!.permissions || [],
      };
    },
  );
}
