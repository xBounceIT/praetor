import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import rateLimit from 'fastify-rate-limit';
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
import notificationsRoutes from './routes/notifications.ts';
import productsRoutes from './routes/products.ts';
import projectsRoutes from './routes/projects.ts';
import reportsRoutes from './routes/reports.ts';
import rolesRoutes from './routes/roles.ts';
import settingsRoutes from './routes/settings.ts';
import supplierInvoicesRoutes from './routes/supplier-invoices.ts';
import supplierOrdersRoutes from './routes/supplier-orders.ts';
import supplierQuotesRoutes from './routes/supplier-quotes.ts';
import suppliersRoutes from './routes/suppliers.ts';
import tasksRoutes from './routes/tasks.ts';
import usersRoutes from './routes/users.ts';
import workUnitsRoutes from './routes/work-units.ts';
import { loggerOptions, serializeError } from './utils/logger.ts';
import { GLOBAL_RATE_LIMIT } from './utils/rate-limit.ts';

dotenv.config();

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

export const buildApp = async () => {
  const fastify = Fastify({
    logger: loggerOptions,
    trustProxy: parseTrustProxyEnv(process.env.TRUST_PROXY),
  });

  await fastify.register(cors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  await fastify.register(rateLimit, {
    ...GLOBAL_RATE_LIMIT,
    global: true,
    hook: 'onRequest',
    errorResponseBuilder: () => ({
      error: 'Too many requests',
    }),
  });

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Praetor API',
        description: 'Praetor API documentation',
        version: '0.5.0',
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
  await fastify.register(aiRoutes, { prefix: '/api/ai' });
  await fastify.register(usersRoutes, { prefix: '/api/users' });
  await fastify.register(clientsRoutes, { prefix: '/api/clients' });
  await fastify.register(projectsRoutes, { prefix: '/api/projects' });
  await fastify.register(tasksRoutes, { prefix: '/api/tasks' });
  await fastify.register(entriesRoutes, { prefix: '/api/entries' });
  await fastify.register(settingsRoutes, { prefix: '/api/settings' });
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
  await fastify.register(supplierQuotesRoutes, { prefix: '/api/supplier-quotes' });
  await fastify.register(notificationsRoutes, { prefix: '/api/notifications' });
  await fastify.register(emailRoutes, { prefix: '/api/email' });
  await fastify.register(rolesRoutes, { prefix: '/api/roles' });
  await fastify.register(reportsRoutes, { prefix: '/api/reports' });
  await fastify.register(logsRoutes, { prefix: '/api/logs' });

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

  fastify.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    request.log.error(
      {
        err: serializeError(error),
        statusCode: error.statusCode,
      },
      'Unhandled request error',
    );

    reply.code(error.statusCode || 500).send({
      error: error.message || 'Internal server error',
    });
  });

  return fastify;
};

export default buildApp;
