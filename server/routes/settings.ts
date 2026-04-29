import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken } from '../middleware/auth.ts';
import * as settingsRepo from '../repositories/settingsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  badRequest,
  optionalEmail,
  optionalEnum,
  optionalNonEmptyString,
  requireNonEmptyString,
} from '../utils/validation.ts';

const settingsSchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    email: { type: 'string' },
    language: { type: 'string', enum: [...settingsRepo.LANGUAGES] },
  },
  required: ['fullName', 'email', 'language'],
} as const;

const settingsUpdateBodySchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    email: { type: 'string' },
    language: { type: 'string', enum: [...settingsRepo.LANGUAGES] },
  },
} as const;

const passwordUpdateBodySchema = {
  type: 'object',
  properties: {
    currentPassword: { type: 'string' },
    newPassword: { type: 'string' },
  },
  required: ['currentPassword', 'newPassword'],
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - Get current user's settings
  fastify.get(
    '/',
    {
      onRequest: [fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT), authenticateToken],
      schema: {
        tags: ['settings'],
        summary: 'Get current user settings',
        response: {
          200: settingsSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      return settingsRepo.getOrCreateForUser(request.user.id, {
        fullName: request.user.name ?? null,
        email: `${request.user.username}@example.com`,
      });
    },
  );

  // PUT / - Update settings
  fastify.put(
    '/',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['settings'],
        summary: 'Update settings',
        body: settingsUpdateBodySchema,
        response: {
          200: settingsSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const { fullName, email, language } = request.body as {
        fullName?: string;
        email?: string;
        language?: string;
      };
      const fullNameResult = optionalNonEmptyString(fullName, 'fullName');
      if (!fullNameResult.ok) return badRequest(reply, fullNameResult.message);

      const emailResult = optionalEmail(email, 'email');
      if (!emailResult.ok) return badRequest(reply, emailResult.message);

      const languageResult = optionalEnum(language, [...settingsRepo.LANGUAGES], 'language');
      if (!languageResult.ok) return badRequest(reply, languageResult.message);

      return settingsRepo.upsertForUser(request.user.id, {
        fullName: fullNameResult.value,
        email: emailResult.value,
        language: languageResult.value as settingsRepo.Language | null,
      });
    },
  );

  // PUT /password - Update user password
  fastify.put(
    '/password',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['settings'],
        summary: 'Update password',
        body: passwordUpdateBodySchema,
        response: {
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const { currentPassword, newPassword } = request.body as {
        currentPassword: string;
        newPassword: string;
      };
      const currentPasswordResult = requireNonEmptyString(currentPassword, 'currentPassword');
      if (!currentPasswordResult.ok) return badRequest(reply, currentPasswordResult.message);

      const newPasswordResult = requireNonEmptyString(newPassword, 'newPassword');
      if (!newPasswordResult.ok) return badRequest(reply, newPasswordResult.message);

      if (newPasswordResult.value.length < 8) {
        return badRequest(reply, 'New password must be at least 8 characters long');
      }

      const passwordHash = await usersRepo.getPasswordHash(request.user.id);
      if (passwordHash === null) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const isMatch = await bcrypt.compare(currentPasswordResult.value, passwordHash);
      if (!isMatch) {
        return badRequest(reply, 'Incorrect current password');
      }

      const newHash = await bcrypt.hash(newPasswordResult.value, 12);

      await usersRepo.updatePasswordHash(request.user.id, newHash);

      return { message: 'Password updated successfully' };
    },
  );
}
