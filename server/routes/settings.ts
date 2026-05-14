import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, generateToken } from '../middleware/auth.ts';
import * as mcpTokensRepo from '../repositories/mcpTokensRepo.ts';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as personalAccessTokensRepo from '../repositories/personalAccessTokensRepo.ts';
import * as settingsRepo from '../repositories/settingsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import {
  generatePersonalAccessToken,
  getPersonalAccessTokenDisplayPrefix,
  hashPersonalAccessToken,
} from '../utils/personal-access-token.ts';
import { LOGIN_RATE_LIMIT, STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  badRequest,
  forbidden,
  optionalEmail,
  optionalEnum,
  optionalNonEmptyString,
  requireNonEmptyString,
} from '../utils/validation.ts';

const ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'password';

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

const mcpTokenSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    tokenPrefix: { type: 'string' },
    scope: { type: 'string', enum: [...mcpTokensRepo.MCP_TOKEN_SCOPES] },
    createdAt: { type: 'number' },
    lastUsedAt: { type: ['number', 'null'] },
  },
  required: ['id', 'name', 'tokenPrefix', 'scope', 'createdAt', 'lastUsedAt'],
} as const;

const mcpTokenCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    scope: { type: 'string', enum: [...mcpTokensRepo.MCP_TOKEN_SCOPES] },
  },
  required: ['name'],
} as const;

const mcpTokenCreateResponseSchema = {
  type: 'object',
  properties: {
    token: mcpTokenSchema,
    rawToken: { type: 'string' },
  },
  required: ['token', 'rawToken'],
} as const;

const MAX_ACTIVE_MCP_TOKENS_PER_USER = 20;

const personalAccessTokenSchema = {
  type: 'object',
  properties: {
    tokenPrefix: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
    token: { type: 'string' },
  },
  required: ['tokenPrefix', 'createdAt', 'updatedAt', 'lastUsedAt'],
} as const;

const toIsoString = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const mapPersonalAccessTokenResponse = (
  record: personalAccessTokensRepo.PersonalAccessTokenRecord,
  token?: string,
) => ({
  tokenPrefix: record.tokenPrefix,
  createdAt: toIsoString(record.createdAt),
  updatedAt: toIsoString(record.updatedAt),
  lastUsedAt: record.lastUsedAt ? toIsoString(record.lastUsedAt) : null,
  ...(token ? { token } : {}),
});

const buildTokenParts = () => {
  const token = generatePersonalAccessToken();
  return {
    token,
    tokenHash: hashPersonalAccessToken(token),
    tokenPrefix: getPersonalAccessTokenDisplayPrefix(token),
  };
};

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

      const languageResult = optionalEnum(language, settingsRepo.LANGUAGES, 'language');
      if (!languageResult.ok) return badRequest(reply, languageResult.message);

      // Identity fields (name, email) are mastered by the upstream IdP for
      // non-local users; only the UI-preference `language` field stays editable.
      if (fullNameResult.value !== null || emailResult.value !== null) {
        const userCore = await usersRepo.findCoreById(request.user.id);
        if (userCore && userCore.authMethod !== 'local') {
          return forbidden(reply, 'Profile is managed by the identity provider');
        }
      }

      return settingsRepo.upsertForUser(request.user.id, {
        fullName: fullNameResult.value,
        email: emailResult.value,
        language: languageResult.value,
      });
    },
  );

  // GET /mcp-tokens - List current user's active MCP tokens
  fastify.get(
    '/mcp-tokens',
    {
      onRequest: [fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT), authenticateToken],
      schema: {
        tags: ['settings'],
        summary: 'List current user MCP tokens',
        response: {
          200: { type: 'array', items: mcpTokenSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      return mcpTokensRepo.listForUser(request.user.id);
    },
  );

  // POST /mcp-tokens - Create current user's MCP token
  fastify.post(
    '/mcp-tokens',
    {
      onRequest: [fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT), authenticateToken],
      schema: {
        tags: ['settings'],
        summary: 'Create current user MCP token',
        body: mcpTokenCreateBodySchema,
        response: {
          201: mcpTokenCreateResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { name, scope } = request.body as { name?: unknown; scope?: unknown };
      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);
      if (nameResult.value.length > 120) return badRequest(reply, 'name is too long');

      const scopeResult = optionalEnum(scope, mcpTokensRepo.MCP_TOKEN_SCOPES, 'scope');
      if (!scopeResult.ok) return badRequest(reply, scopeResult.message);

      const activeTokens = await mcpTokensRepo.listForUser(request.user.id);
      if (activeTokens.length >= MAX_ACTIVE_MCP_TOKENS_PER_USER) {
        return reply.code(409).send({ error: 'Maximum active MCP token limit reached' });
      }

      const rawToken = mcpTokensRepo.generateRawToken();
      const token = await mcpTokensRepo.createForUser({
        id: generatePrefixedId('mcp-token'),
        userId: request.user.id,
        name: nameResult.value,
        rawToken,
        scope: scopeResult.value ?? 'full',
      });

      return reply.code(201).send({ token, rawToken });
    },
  );

  // DELETE /mcp-tokens/:id - Revoke current user's MCP token
  fastify.delete(
    '/mcp-tokens/:id',
    {
      onRequest: [fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT), authenticateToken],
      schema: {
        tags: ['settings'],
        summary: 'Revoke current user MCP token',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          204: { type: 'null' },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { id } = request.params as { id?: unknown };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const revoked = await mcpTokensRepo.revokeForUser(idResult.value, request.user.id);
      if (!revoked) return reply.code(404).send({ error: 'MCP token not found' });

      return reply.code(204).send();
    },
  );

  // PUT /password - Update user password. LOGIN_RATE_LIMIT (not the standard
  // per-route limit) because this verifies the current password — same threat
  // model as login, so it gets the same anti-brute-force budget.
  fastify.put(
    '/password',
    {
      onRequest: [fastify.rateLimit(LOGIN_RATE_LIMIT), authenticateToken],
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

      if (currentPasswordResult.value === newPasswordResult.value) {
        return badRequest(reply, 'New password must be different from the current password');
      }

      // The password lives in the upstream IdP for non-local users; reject before
      // bcrypt so we surface a clear error instead of "Incorrect current password".
      const userCore = await usersRepo.findCoreById(request.user.id);
      if (userCore && userCore.authMethod !== 'local') {
        return forbidden(reply, 'Password is managed by the identity provider');
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

      const newSessionVersion = await usersRepo.rotatePasswordAndBumpSession(
        request.user.id,
        newHash,
      );

      // Re-sign x-auth-token before the admin-warning side effects below: the
      // password is already rotated, and authenticateToken's sliding-window
      // refresh wrote a pre-bump token in onRequest. If a downstream side
      // effect throws, Fastify's 500 response still carries this rotated
      // header — without it, the admin would be force-logged-out by their own
      // password change. PAT callers have nothing to rotate.
      if (request.auth?.source === 'session' && request.auth.sessionStart !== undefined) {
        const refreshedToken = generateToken(
          request.user.id,
          request.auth.sessionStart,
          request.user.role,
          newSessionVersion,
        );
        reply.header('x-auth-token', refreshedToken);
      }

      await logAudit({
        request,
        action: 'password.updated',
        entityType: 'user',
        entityId: request.user.id,
      });

      if (request.user.username === ADMIN_USERNAME) {
        if (newPasswordResult.value === DEFAULT_ADMIN_PASSWORD) {
          await notificationsRepo.upsertAdminPasswordWarning(request.user.id);
        } else {
          await notificationsRepo.deleteAdminPasswordWarning();
        }
      }

      return { message: 'Password updated successfully' };
    },
  );

  // GET /personal-access-token - Get current user's PAT metadata, creating one if missing
  fastify.get(
    '/personal-access-token',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['settings'],
        summary: 'Get current user personal access token metadata',
        response: {
          200: personalAccessTokenSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const existing = await personalAccessTokensRepo.findByUserId(request.user.id);
      if (existing) return mapPersonalAccessTokenResponse(existing);

      const nextToken = buildTokenParts();
      const { record, created } = await personalAccessTokensRepo.createForUserIfMissing(
        request.user.id,
        nextToken.tokenHash,
        nextToken.tokenPrefix,
      );

      return mapPersonalAccessTokenResponse(record, created ? nextToken.token : undefined);
    },
  );

  // POST /personal-access-token/renew - Rotate current user's PAT
  fastify.post(
    '/personal-access-token/renew',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['settings'],
        summary: 'Renew current user personal access token',
        response: {
          200: personalAccessTokenSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const nextToken = buildTokenParts();
      const record = await personalAccessTokensRepo.renewForUser(
        request.user.id,
        nextToken.tokenHash,
        nextToken.tokenPrefix,
      );

      return mapPersonalAccessTokenResponse(record, nextToken.token);
    },
  );
}
