import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { generateTokenWithCurrentIdleTimeout } from '../middleware/auth.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { authUserSchema } from '../services/sessionResponse.ts';
import * as ssoService from '../services/sso.ts';
import { logAudit } from '../utils/audit.ts';
import { buildFrontendUrl } from '../utils/frontend-url.ts';
import { NotFoundError } from '../utils/http-errors.ts';
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

const loginResponseSchema = {
  type: 'object',
  properties: {
    token: { type: 'string' },
    user: authUserSchema,
  },
  required: ['token', 'user'],
} as const;

// The `sso_error` query param carries a stable code (e.g. `invalid_response`, `provider_disabled`)
// — never the raw `err.message`. The frontend maps the code to a translated message; raw library
// wording would leak implementation details and bypass i18n. See issue #604.
//
// NotFoundError reaches this handler when a disabled/missing/wrong-protocol provider is hit via
// a callback URL (start/metadata routes propagate it to the global 404 handler instead). Treat
// it as `provider_disabled` so the login screen shows a translated message rather than a
// generic one.
const ssoCallbackErrorCode = (err: unknown): ssoService.SsoLoginErrorCode => {
  if (err instanceof ssoService.SsoLoginError) return err.code;
  if (err instanceof NotFoundError) return 'provider_disabled';
  return 'generic';
};

const handleSsoCallbackError = (
  request: FastifyRequest,
  reply: FastifyReply,
  err: unknown,
  context: { protocol: 'oidc' | 'saml'; slug: string },
) => {
  const message = err instanceof Error ? err.message : 'SSO login failed';
  const code = ssoCallbackErrorCode(err);
  request.log.warn({ message, code, ...context }, 'SSO callback failed');
  return reply.redirect(buildFrontendUrl('sso_error', code), 302);
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
      const redirectUrl = await ssoService.startOidcLogin(slug);
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
        // We only need the search params from the inbound URL — never construct an
        // origin from request headers. The service builds the public callback URL from
        // server config (SSO_CALLBACK_BASE_URL / FRONTEND_URL).
        const currentUrl = new URL(request.url, 'http://internal.invalid');
        const redirectUrl = await ssoService.completeOidcLogin(slug, currentUrl);
        return reply.redirect(redirectUrl, 302);
      } catch (err) {
        return handleSsoCallbackError(request, reply, err, { protocol: 'oidc', slug });
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
      const redirectUrl = await ssoService.startSamlLogin(slug);
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
        );
        return reply.redirect(redirectUrl, 302);
      } catch (err) {
        return handleSsoCallbackError(request, reply, err, { protocol: 'saml', slug });
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
      const metadata = await ssoService.getSamlMetadata(slug);
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

      const token = await generateTokenWithCurrentIdleTimeout(
        consumed.tokenUser.id,
        Date.now(),
        consumed.activeRole,
        consumed.tokenUser.sessionVersion,
      );
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
