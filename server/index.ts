import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import buildApp from './app.ts';
import { query } from './db/index.ts';
import { closeRedis } from './services/redis.ts';

const PORT = Number(process.env.PORT ?? 3001);
const ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_USER_ID = 'u1';
const DEFAULT_ADMIN_PASSWORD = 'password';

const fastify = await buildApp();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const parseBooleanEnv = (value: string | undefined): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const ensureBootstrapAdmin = async () => {
  const existingAdmin = await query('SELECT id FROM users WHERE username = $1 LIMIT 1', [
    ADMIN_USERNAME,
  ]);

  let adminId: string;
  if (existingAdmin.rows.length > 0) {
    adminId = existingAdmin.rows[0].id as string;
    console.log('Bootstrap admin already exists. Skipping admin creation.');
  } else {
    const defaultIdCheck = await query('SELECT 1 FROM users WHERE id = $1 LIMIT 1', [
      DEFAULT_ADMIN_USER_ID,
    ]);
    adminId = defaultIdCheck.rows.length === 0 ? DEFAULT_ADMIN_USER_ID : randomUUID();

    const rawPassword = process.env.ADMIN_DEFAULT_PASSWORD?.trim();
    const adminPassword =
      rawPassword && rawPassword.length > 0 ? rawPassword : DEFAULT_ADMIN_PASSWORD;
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    await query(
      `INSERT INTO users (id, name, username, password_hash, role, avatar_initials)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminId, 'Admin User', ADMIN_USERNAME, passwordHash, 'admin', 'AD'],
    );
    console.log(
      'Bootstrap admin created. Password source:',
      rawPassword && rawPassword.length > 0 ? 'ADMIN_DEFAULT_PASSWORD' : 'fallback',
    );
  }

  await query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    adminId,
    'admin',
  ]);
};

const shutdown = async (signal: string) => {
  try {
    console.log(`Shutting down (${signal})...`);
    await closeRedis();
    await fastify.close();
  } catch (err) {
    console.error('Shutdown error:', err);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Start server
try {
  // One-time probe to confirm DB connectivity without logging on every pooled connection.
  // Retry briefly to handle container startup ordering.
  let dbReady = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await query('SELECT 1');
      dbReady = true;
      break;
    } catch (err) {
      if (attempt === 10) throw err;
      console.error(`PostgreSQL not ready (attempt ${attempt}/10). Retrying...`, err);
      await sleep(1000);
    }
  }
  if (dbReady) console.log('PostgreSQL ready.');

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
    const { query } = await import('./db/index.ts');
    await query(schemaSql);

    // Explicitly verify that the new tables exist
    const tableCheck = await query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('user_clients', 'user_projects', 'user_tasks')
    `);

    const foundTables = tableCheck.rows.map((r) => r.table_name);
    console.log(`Database schema verified. Found tables: ${foundTables.join(', ')}`);

    if (!foundTables.includes('user_clients')) {
      console.error('CRITICAL: user_clients table was not created!');
    }

    // Run migration to add quote_code (Must run BEFORE seed.sql because seed.sql references this column)
    try {
      const { addQuoteCode } = await import('./db/add_quote_code.ts');
      await addQuoteCode();
    } catch (err) {
      console.error('Failed to run quote_code migration:', err);
    }

    // Ensure required bootstrap user data always exists.
    await ensureBootstrapAdmin();

    // Run demo seed.sql only when explicitly enabled.
    const seedPath = path.join(__dirname, 'db', 'seed.sql');
    const isDemoSeedingEnabled = parseBooleanEnv(process.env.DEMO_SEEDING);
    if (isDemoSeedingEnabled && fs.existsSync(seedPath)) {
      const seedSql = fs.readFileSync(seedPath, 'utf8');
      await query(seedSql);
      console.log('Demo seed data applied.');
    } else if (isDemoSeedingEnabled) {
      console.warn('Demo seeding requested but seed file not found at:', seedPath);
    } else {
      console.log('Demo seeding disabled (set DEMO_SEEDING=true to enable).');
    }

    // Run data migration for default clients
    try {
      const { migrate: updateClients } = await import('./db/update_default_clients.ts');
      await updateClients();
    } catch (err) {
      console.error('Failed to run default clients data update:', err);
    }

    // Run settings language migration
    try {
      const { migrate: addLanguageToSettings } = await import('./db/add_language_to_settings.ts');
      await addLanguageToSettings();
      // Run update language constraint migration
      const { migrate: updateLanguageConstraint } = await import(
        './db/update_language_constraint.ts'
      );
      await updateLanguageConstraint();
    } catch (err) {
      console.error('Failed to run settings language migration:', err);
    }

    // Run migration to remove payment_terms from clients
    try {
      const { up: removePaymentTerms } = await import('./db/remove_payment_terms_from_clients.ts');
      await removePaymentTerms();
    } catch (err) {
      console.error('Failed to run payment_terms removal migration:', err);
    }

    // Run sale status migration
    try {
      const { migrate: migrateSaleStatus } = await import('./db/migrate_sale_status.ts');
      await migrateSaleStatus();
    } catch (err) {
      console.error('Failed to run sale status migration:', err);
    }

    // Run products structure update migration
    try {
      const { migrate: updateProductsStructure } = await import(
        './db/update_products_structure.ts'
      );
      await updateProductsStructure();
    } catch (err) {
      console.error('Failed to run products structure update migration:', err);
    }

    // Run migration to assign all items to manager users
    try {
      const { migrate: assignItemsToManagers } = await import('./db/assign_items_to_managers.ts');
      await assignItemsToManagers();
    } catch (err) {
      console.error('Failed to run manager assignments migration:', err);
    }

    // Run migration to update currency precision
    try {
      const { migrate: updateCurrencyPrecision } = await import(
        './db/update_currency_precision.ts'
      );
      await updateCurrencyPrecision();
    } catch (err) {
      console.error('Failed to run currency precision update migration:', err);
    }

    // Run migration to add unique constraint to client_code
    try {
      const { addUniqueClientCode } = await import('./db/add_unique_client_code.ts');
      await addUniqueClientCode();
    } catch (err) {
      console.error('Failed to run client_code unique constraint migration:', err);
    }
  } else {
    console.warn('Schema file not found at:', schemaPath);
  }

  console.log(`Praetor API server running on port ${PORT} with HTTP/1.1 over HTTP`);

  // Periodic LDAP Sync Task (every hour)
  try {
    const ldapService = (await import('./services/ldap.ts')).default;

    const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
    setInterval(async () => {
      try {
        await ldapService.loadConfig();
        if (ldapService.config?.enabled) {
          console.log('Running periodic LDAP sync...');
          await ldapService.syncUsers();
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Periodic LDAP Sync Error:', errorMessage);
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
