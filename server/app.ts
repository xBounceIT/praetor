import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import dotenv from 'dotenv';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit, { type errorResponseBuilderContext } from 'fastify-rate-limit';
import aiRoutes from './routes/ai.ts';
import authRoutes from './routes/auth.ts';
import brandingRoutes from './routes/branding.ts';
import clientOffersRoutes from './routes/client-offers.ts';
import clientQuotesRoutes from './routes/client-quotes.ts';
import clientsRoutes from './routes/clients.ts';
import clientsOrdersRoutes from './routes/clients-orders.ts';
import emailRoutes from './routes/email.ts';
import entriesRoutes from './routes/entries.ts';
import generalSettingsRoutes from './routes/general-settings.ts';
import invoicesRoutes from './routes/invoices.ts';
import ldapRoutes from './routes/ldap.ts';
import logsRoutes from './routes/logs.ts';
import mcpRoutes from './routes/mcp.ts';
import notificationsRoutes from './routes/notifications.ts';
import productsRoutes from './routes/products.ts';
import projectRulesRoutes from './routes/project-rules.ts';
import projectsRoutes from './routes/projects.ts';
import quoteCommunicationChannelsRoutes from './routes/quote-communication-channels.ts';
import reportsRoutes from './routes/reports.ts';
import resalesRoutes from './routes/resales.ts';
import rilDraftsRoutes from './routes/ril-drafts.ts';
import rolesRoutes from './routes/roles.ts';
import settingsRoutes from './routes/settings.ts';
import ssoRoutes from './routes/sso.ts';
import ssoAuthRoutes from './routes/sso-auth.ts';
import supplierInvoicesRoutes from './routes/supplier-invoices.ts';
import supplierOrdersRoutes from './routes/supplier-orders.ts';
import supplierQuotesRoutes from './routes/supplier-quotes.ts';
import suppliersRoutes from './routes/suppliers.ts';
import tasksRoutes from './routes/tasks.ts';
import twoFactorRoutes from './routes/two-factor.ts';
import usersRoutes from './routes/users.ts';
import viewsRoutes from './routes/views.ts';
import webhooksRoutes from './routes/webhooks.ts';
import workUnitsRoutes from './routes/work-units.ts';
import { ajvFormatsPlugin, ajvFormatsPluginOptions } from './utils/ajv-formats.ts';
import { APP_VERSION } from './utils/app-version.ts';
import { loggerOptions, serializeError } from './utils/logger.ts';
import { GLOBAL_RATE_LIMIT } from './utils/rate-limit.ts';

dotenv.config({ quiet: true });

const parseTrustProxyEnv = (value: string | undefined): boolean | string | number => {
  if (!value) return false;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;

  if (normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }

  return value.trim();
};

// Exported for testing. In production, sanitize 5xx response bodies so internal error details
// (stack traces, DB column names, etc.) never reach API clients. The full error is still
// recorded server-side via request.log.error. 4xx responses pass through unchanged so
// validation/auth/etc. messages remain useful to API clients in every environment.
export const buildErrorResponseMessage = (
  error: Error & { statusCode?: number },
  env: NodeJS.ProcessEnv = process.env,
): { statusCode: number; message: string } => {
  const statusCode = error.statusCode || 500;
  const isProduction = env.NODE_ENV === 'production';
  const shouldMaskMessage = isProduction && statusCode >= 500;
  const message = shouldMaskMessage
    ? 'Internal server error'
    : error.message || 'Internal server error';
  return { statusCode, message };
};

export const buildRateLimitErrorResponse = (
  _request: unknown,
  context: errorResponseBuilderContext,
): Error & { statusCode: number } => {
  const error = new Error('Too many requests') as Error & { statusCode: number };
  error.statusCode = context.statusCode;
  return error;
};

// Exported so tests can register the exact production error handler against a minimal
// Fastify instance, rather than re-implementing setErrorHandler in test setup.
export const registerErrorHandler = (fastify: FastifyInstance) => {
  fastify.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    request.log.error(
      {
        err: serializeError(error),
        statusCode: error.statusCode,
      },
      'Unhandled request error',
    );

    const { statusCode, message } = buildErrorResponseMessage(error);
    reply.code(statusCode).send({ error: message });
  });
};

export const buildApp = async () => {
  const fastify = Fastify({
    logger: loggerOptions,
    trustProxy: parseTrustProxyEnv(process.env.TRUST_PROXY),
    // Register `ajv-formats` so JSON-schema `format` keywords (`date-time`, `date`, `email`, ...)
    // are actually validated. Without this, schemas like `{ type: 'string', format: 'date-time' }`
    // silently accept any string. See server/utils/ajv-formats.ts for the plugin wiring.
    ajv: {
      customOptions: {},
      plugins: [[ajvFormatsPlugin, ajvFormatsPluginOptions]],
    },
  });

  fastify.register(cors, {
    // Default to the documented Praetor dev frontend port (3000). Anything else (legacy
    // Vite default 5173, deployed origin, …) is opt-in via FRONTEND_URL.
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  fastify.register(rateLimit, {
    ...GLOBAL_RATE_LIMIT,
    global: true,
    hook: 'onRequest',
    errorResponseBuilder: buildRateLimitErrorResponse,
  });

  fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
      fields: 0,
    },
  });

  fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Praetor API',
        description: 'Praetor API documentation',
        version: APP_VERSION,
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.register(authRoutes, { prefix: '/api/auth' });
  fastify.register(ssoAuthRoutes, { prefix: '/api/auth/sso' });
  fastify.register(twoFactorRoutes, { prefix: '/api/auth/2fa' });
  fastify.register(aiRoutes, { prefix: '/api/ai' });
  fastify.register(usersRoutes, { prefix: '/api/users' });
  fastify.register(viewsRoutes, { prefix: '/api/views' });
  fastify.register(clientsRoutes, { prefix: '/api/clients' });
  fastify.register(projectsRoutes, { prefix: '/api/projects' });
  fastify.register(projectRulesRoutes, { prefix: '/api/projects' });
  fastify.register(resalesRoutes, { prefix: '/api/projects/resales' });
  fastify.register(tasksRoutes, { prefix: '/api/tasks' });
  fastify.register(entriesRoutes, { prefix: '/api/entries' });
  fastify.register(rilDraftsRoutes, { prefix: '/api/ril-drafts' });
  fastify.register(settingsRoutes, { prefix: '/api/settings' });
  fastify.register(ssoRoutes, { prefix: '/api/sso' });
  fastify.register(ldapRoutes, { prefix: '/api/ldap' });
  fastify.register(generalSettingsRoutes, { prefix: '/api/general-settings' });
  fastify.register(brandingRoutes, { prefix: '/api/branding' });
  fastify.register(productsRoutes, { prefix: '/api/products' });
  fastify.register(quoteCommunicationChannelsRoutes, {
    prefix: '/api/sales/quote-communication-channels',
  });
  fastify.register(clientQuotesRoutes, { prefix: '/api/sales/client-quotes' });
  fastify.register(clientOffersRoutes, { prefix: '/api/sales/client-offers' });
  fastify.register(workUnitsRoutes, { prefix: '/api/work-units' });
  fastify.register(clientsOrdersRoutes, { prefix: '/api/clients-orders' });
  fastify.register(invoicesRoutes, { prefix: '/api/invoices' });
  fastify.register(suppliersRoutes, { prefix: '/api/suppliers' });
  fastify.register(supplierQuotesRoutes, { prefix: '/api/sales/supplier-quotes' });
  fastify.register(supplierOrdersRoutes, { prefix: '/api/accounting/supplier-orders' });
  fastify.register(supplierInvoicesRoutes, { prefix: '/api/accounting/supplier-invoices' });
  fastify.register(notificationsRoutes, { prefix: '/api/notifications' });
  fastify.register(emailRoutes, { prefix: '/api/email' });
  fastify.register(rolesRoutes, { prefix: '/api/roles' });
  fastify.register(reportsRoutes, { prefix: '/api/reports' });
  fastify.register(logsRoutes, { prefix: '/api/logs' });
  fastify.register(mcpRoutes, { prefix: '/api/mcp' });
  fastify.register(webhooksRoutes, { prefix: '/api/webhooks' });

  fastify.get(
    '/api/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Health check',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
            },
            required: ['status', 'timestamp'],
          },
        },
      },
    },
    async (_request, _reply) => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    },
  );

  registerErrorHandler(fastify);

  await fastify.ready();

  return fastify;
};

export default buildApp;
