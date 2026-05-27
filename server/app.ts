import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import dotenv from 'dotenv';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit, { type errorResponseBuilderContext } from 'fastify-rate-limit';
import aiRoutes from './routes/ai.ts';
import authRoutes from './routes/auth.ts';
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
import projectsRoutes from './routes/projects.ts';
import reportsRoutes from './routes/reports.ts';
import rolesRoutes from './routes/roles.ts';
import settingsRoutes from './routes/settings.ts';
import ssoRoutes from './routes/sso.ts';
import ssoAuthRoutes from './routes/sso-auth.ts';
import supplierInvoicesRoutes from './routes/supplier-invoices.ts';
import supplierOrdersRoutes from './routes/supplier-orders.ts';
import supplierQuotesRoutes from './routes/supplier-quotes.ts';
import suppliersRoutes from './routes/suppliers.ts';
import tasksRoutes from './routes/tasks.ts';
import usersRoutes from './routes/users.ts';
import workUnitsRoutes from './routes/work-units.ts';
import { ajvFormatsPlugin, ajvFormatsPluginOptions } from './utils/ajv-formats.ts';
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

  await fastify.register(cors, {
    // Default to the documented Praetor dev frontend port (3000). Anything else (legacy
    // Vite default 5173, deployed origin, …) is opt-in via FRONTEND_URL.
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(rateLimit, {
    ...GLOBAL_RATE_LIMIT,
    global: true,
    hook: 'onRequest',
    errorResponseBuilder: buildRateLimitErrorResponse,
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
      fields: 0,
    },
  });

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Praetor API',
        description: 'Praetor API documentation',
        version: '0.7.0',
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

  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(ssoAuthRoutes, { prefix: '/api/auth/sso' });
  await fastify.register(aiRoutes, { prefix: '/api/ai' });
  await fastify.register(usersRoutes, { prefix: '/api/users' });
  await fastify.register(clientsRoutes, { prefix: '/api/clients' });
  await fastify.register(projectsRoutes, { prefix: '/api/projects' });
  await fastify.register(tasksRoutes, { prefix: '/api/tasks' });
  await fastify.register(entriesRoutes, { prefix: '/api/entries' });
  await fastify.register(settingsRoutes, { prefix: '/api/settings' });
  await fastify.register(ssoRoutes, { prefix: '/api/sso' });
  await fastify.register(ldapRoutes, { prefix: '/api/ldap' });
  await fastify.register(generalSettingsRoutes, { prefix: '/api/general-settings' });
  await fastify.register(productsRoutes, { prefix: '/api/products' });
  await fastify.register(clientQuotesRoutes, { prefix: '/api/sales/client-quotes' });
  await fastify.register(clientOffersRoutes, { prefix: '/api/sales/client-offers' });
  await fastify.register(workUnitsRoutes, { prefix: '/api/work-units' });
  await fastify.register(clientsOrdersRoutes, { prefix: '/api/clients-orders' });
  await fastify.register(invoicesRoutes, { prefix: '/api/invoices' });
  await fastify.register(suppliersRoutes, { prefix: '/api/suppliers' });
  await fastify.register(supplierQuotesRoutes, { prefix: '/api/sales/supplier-quotes' });
  await fastify.register(supplierOrdersRoutes, { prefix: '/api/accounting/supplier-orders' });
  await fastify.register(supplierInvoicesRoutes, { prefix: '/api/accounting/supplier-invoices' });
  await fastify.register(notificationsRoutes, { prefix: '/api/notifications' });
  await fastify.register(emailRoutes, { prefix: '/api/email' });
  await fastify.register(rolesRoutes, { prefix: '/api/roles' });
  await fastify.register(reportsRoutes, { prefix: '/api/reports' });
  await fastify.register(logsRoutes, { prefix: '/api/logs' });
  await fastify.register(mcpRoutes, { prefix: '/api/mcp' });

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

  return fastify;
};

export default buildApp;
