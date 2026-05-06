import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { generateToken } from '../middleware/auth.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import * as ssoService from '../services/sso.ts';
import { logAudit } from '../utils/audit.ts';
import { LOGIN_RATE_LIMIT } from '../utils/rate-limit.ts';
import { badRequest, requireNonEmptyString } from '../utils/validation.ts';

const slugParamsSchema = {
  type: 'object',
  properties: { slug: { type: 'string' } },
  required: ['slug'],
} as const;

const consumeBodySchema = {
  type: 'object',
  properties: { ticket: { type: 'string' } },
  required: ['ticket'],
} as const;

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

const loginResponseSchema = {
  type: 'object',
  properties: {
    token: { type: 'string' },
    user: authUserSchema,
  },
  required: ['token', 'user'],
} as const;

const getHeaderValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
};

const getRequestOrigin = (request: FastifyRequest): string => {
  const proto = getHeaderValue(request.headers['x-forwarded-proto']).split(',')[0] || 'http';
  const host =
    getHeaderValue(request.headers['x-forwarded-host']).split(',')[0] ||
    getHeaderValue(request.headers.host) ||
    'localhost:3001';
  return `${proto}://${host}`;
};

const buildFrontendErrorUrl = (message: string): string => {
  const configured = process.env.FRONTEND_URL?.trim();
  const fallback = `/?sso_error=${encodeURIComponent(message)}`;
  if (!configured) return fallback;
  const url = new URL(configured);
  url.searchParams.set('sso_error', message);
  return url.href;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  fastify.get(
    '/oidc/:slug/start',
    {
      onRequest: fastify.rateLimit(LOGIN_RATE_LIMIT),
      schema: {
        tags: ['sso'],
        summary: 'Start OIDC login',
        params: slugParamsSchema,
        security: [],
        response: {
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };
      const redirectUrl = await ssoService.startOidcLogin(slug, getRequestOrigin(request));
      return reply.redirect(redirectUrl, 302);
    },
  );

  fastify.get(
    '/oidc/:slug/callback',
    {
      schema: {
        tags: ['sso'],
        summary: 'Complete OIDC login',
        params: slugParamsSchema,
        security: [],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };
      try {
        const currentUrl = new URL(request.url, getRequestOrigin(request));
        const redirectUrl = await ssoService.completeOidcLogin(
          slug,
          currentUrl,
          getRequestOrigin(request),
        );
        return reply.redirect(redirectUrl, 302);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'SSO login failed';
        request.log.warn({ message, slug }, 'OIDC callback failed');
        return reply.redirect(buildFrontendErrorUrl(message), 302);
      }
    },
  );

  fastify.get(
    '/saml/:slug/start',
    {
      onRequest: fastify.rateLimit(LOGIN_RATE_LIMIT),
      schema: {
        tags: ['sso'],
        summary: 'Start SAML login',
        params: slugParamsSchema,
        security: [],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };
      const redirectUrl = await ssoService.startSamlLogin(slug, getRequestOrigin(request));
      return reply.redirect(redirectUrl, 302);
    },
  );

  fastify.post(
    '/saml/:slug/callback',
    {
      schema: {
        tags: ['sso'],
        summary: 'Complete SAML login',
        params: slugParamsSchema,
        security: [],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };
      try {
        const redirectUrl = await ssoService.completeSamlLogin(
          slug,
          request.body as Record<string, string>,
          getRequestOrigin(request),
        );
        return reply.redirect(redirectUrl, 302);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'SSO login failed';
        request.log.warn({ message, slug }, 'SAML callback failed');
        return reply.redirect(buildFrontendErrorUrl(message), 302);
      }
    },
  );

  fastify.get(
    '/saml/:slug/metadata',
    {
      schema: {
        tags: ['sso'],
        summary: 'Get SAML service provider metadata',
        params: slugParamsSchema,
        security: [],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };
      const metadata = await ssoService.getSamlMetadata(slug, getRequestOrigin(request));
      return reply.type('application/samlmetadata+xml').send(metadata);
    },
  );

  fastify.post(
    '/consume',
    {
      onRequest: fastify.rateLimit(LOGIN_RATE_LIMIT),
      schema: {
        tags: ['sso'],
        summary: 'Consume SSO login ticket',
        body: consumeBodySchema,
        security: [],
        response: {
          200: loginResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { ticket } = request.body as { ticket: unknown };
      const ticketResult = requireNonEmptyString(ticket, 'ticket');
      if (!ticketResult.ok) return badRequest(reply, ticketResult.message);

      const consumed = await ssoService.consumeLoginTicket(ticketResult.value);
      if (!consumed) return reply.code(401).send({ error: 'Invalid or expired SSO ticket' });

      const token = generateToken(consumed.tokenUser.id, Date.now(), consumed.activeRole);
      const user = await ssoService.buildAuthUserResponse(consumed.tokenUser, consumed.activeRole);
      await logAudit({
        request,
        action: 'user.sso_login',
        entityType: 'user',
        entityId: user.id,
        details: { targetLabel: user.name, secondaryLabel: user.role },
        userId: user.id,
      });
      return { token, user };
    },
  );
}
