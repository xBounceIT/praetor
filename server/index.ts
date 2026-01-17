import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import clientsRoutes from './routes/clients.js';
import projectsRoutes from './routes/projects.js';
import tasksRoutes from './routes/tasks.js';
import entriesRoutes from './routes/entries.js';
import settingsRoutes from './routes/settings.js';
import ldapRoutes from './routes/ldap.js';
import generalSettingsRoutes from './routes/general-settings.js';
import productsRoutes from './routes/products.js';
import quotesRoutes from './routes/quotes.js';
import workUnitsRoutes from './routes/work-units.js';
import salesRoutes from './routes/sales.js';
import invoicesRoutes from './routes/invoices.js';
import paymentsRoutes from './routes/payments.js';
import expensesRoutes from './routes/expenses.js';
import suppliersRoutes from './routes/suppliers.js';
import supplierQuotesRoutes from './routes/supplier-quotes.js';
import specialBidsRoutes from './routes/special-bids.js';

dotenv.config();

const PORT = Number(process.env.PORT ?? 3001);

// Create Fastify instance with HTTP/2 support
const fastify = Fastify({
  logger: false,
  http2: true
});

// Register CORS
await fastify.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
});

// Register routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(usersRoutes, { prefix: '/api/users' });
await fastify.register(clientsRoutes, { prefix: '/api/clients' });
await fastify.register(projectsRoutes, { prefix: '/api/projects' });
await fastify.register(tasksRoutes, { prefix: '/api/tasks' });
await fastify.register(entriesRoutes, { prefix: '/api/entries' });
await fastify.register(settingsRoutes, { prefix: '/api/settings' });
await fastify.register(ldapRoutes, { prefix: '/api/ldap' });
await fastify.register(generalSettingsRoutes, { prefix: '/api/general-settings' });
await fastify.register(productsRoutes, { prefix: '/api/products' });
await fastify.register(quotesRoutes, { prefix: '/api/quotes' });
await fastify.register(workUnitsRoutes, { prefix: '/api/work-units' });
await fastify.register(salesRoutes, { prefix: '/api/sales' });
await fastify.register(invoicesRoutes, { prefix: '/api/invoices' });
await fastify.register(paymentsRoutes, { prefix: '/api/payments' });
await fastify.register(expensesRoutes, { prefix: '/api/expenses' });
await fastify.register(suppliersRoutes, { prefix: '/api/suppliers' });
await fastify.register(supplierQuotesRoutes, { prefix: '/api/supplier-quotes' });
await fastify.register(specialBidsRoutes, { prefix: '/api/special-bids' });

// Health check
fastify.get('/api/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  console.error('Error:', error);
  reply.code(error.statusCode || 500).send({
    error: error.message || 'Internal server error'
  });
});

// Start server
try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });

  // Run automatic migration on startup
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');

  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    const { query } = await import('./db/index.js');
    await query(schemaSql);

    // Explicitly verify that the new tables exist
    const tableCheck = await query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('user_clients', 'user_projects', 'user_tasks')
    `);

    const foundTables = tableCheck.rows.map(r => r.table_name);
    console.log(`Database schema verified. Found tables: ${foundTables.join(', ')}`);

    if (!foundTables.includes('user_clients')) {
      console.error('CRITICAL: user_clients table was not created!');
    }

    // Run seed.sql for initial data (uses ON CONFLICT DO NOTHING, safe to run repeatedly)
    const seedPath = path.join(__dirname, 'db', 'seed.sql');
    if (fs.existsSync(seedPath)) {
      const seedSql = fs.readFileSync(seedPath, 'utf8');
      await query(seedSql);
      console.log('Seed data applied.');
    }

    // Run data migration for default clients
    try {
      const { migrate: updateClients } = await import('./db/update_default_clients.js');
      await updateClients();
    } catch (err) {
      console.error('Failed to run default clients data update:', err);
    }
  } else {
    console.warn('Schema file not found at:', schemaPath);
  }

  console.log(`Praetor API server running on port ${PORT} with HTTP/2`);

  // Periodic LDAP Sync Task (every hour)
  try {
    const ldapService = (await import('./services/ldap.js')).default;

    const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
    setInterval(async () => {
      try {
        await ldapService.loadConfig();
        if (ldapService.config && ldapService.config.enabled) {
          console.log('Running periodic LDAP sync...');
          await ldapService.syncUsers();
        }
      } catch (err) {
        console.error('Periodic LDAP Sync Error:', err.message);
      }
    }, SYNC_INTERVAL);
  } catch (err) {
    console.error('Failed to initialize LDAP sync task:', err);
  }
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}

export default fastify;
