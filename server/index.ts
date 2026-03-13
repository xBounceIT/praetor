import buildApp from './app.ts';
import { DEFAULT_ADMIN_PASSWORD, ensureBootstrapAdmin } from './db/bootstrapAdmin.ts';
import { runDemoSeedRefresh } from './db/demoSeed.ts';
import { query } from './db/index.ts';
import { closeRedis } from './services/redis.ts';
import { createChildLogger, serializeError } from './utils/logger.ts';

const PORT = Number(process.env.PORT ?? 3001);
const DEFAULT_JWT_SECRET = 'praetor-secret-key-change-in-production';
const DEFAULT_ENCRYPTION_KEY = 'praetor-encryption-key-change-in-production';
const logger = createChildLogger({ module: 'startup' });

const fastify = await buildApp();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const parseBooleanEnv = (value: string | undefined): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const warnInsecureRuntimeDefaults = () => {
  const warnings: string[] = [];

  if ((process.env.JWT_SECRET || '').trim() === DEFAULT_JWT_SECRET) {
    warnings.push('JWT_SECRET is using the default placeholder value.');
  }

  if ((process.env.ENCRYPTION_KEY || '').trim() === DEFAULT_ENCRYPTION_KEY) {
    warnings.push('ENCRYPTION_KEY is using the default placeholder value.');
  }

  if ((process.env.ADMIN_DEFAULT_PASSWORD || '').trim() === DEFAULT_ADMIN_PASSWORD) {
    warnings.push('ADMIN_DEFAULT_PASSWORD is using the default placeholder value.');
  }

  for (const warning of warnings) {
    logger.warn({ warning }, 'Security warning');
  }
};

const shutdown = async (signal: string) => {
  try {
    logger.info({ signal }, 'Shutting down');
    await closeRedis();
    await fastify.close();
  } catch (err) {
    logger.error({ signal, err: serializeError(err) }, 'Shutdown error');
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Start server
try {
  warnInsecureRuntimeDefaults();

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
      logger.warn(
        { attempt, maxAttempts: 10, err: serializeError(err) },
        'PostgreSQL not ready; retrying',
      );
      await sleep(1000);
    }
  }
  if (dbReady) logger.info('PostgreSQL ready');

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
    logger.info({ foundTables }, 'Database schema verified');

    if (!foundTables.includes('user_clients')) {
      logger.error({ foundTables }, 'Critical schema issue: user_clients table was not created');
    }

    // Ensure required bootstrap user data always exists.
    await ensureBootstrapAdmin();

    // Run demo seed.sql only when explicitly enabled.
    const isDemoSeedingEnabled = parseBooleanEnv(process.env.DEMO_SEEDING);
    if (isDemoSeedingEnabled) {
      await runDemoSeedRefresh({ source: 'startup' });
    } else {
      logger.info('Demo seeding disabled (set DEMO_SEEDING=true to enable)');
    }

    // Merge legacy client VAT/tax fields into a canonical fiscal_code field
    try {
      const { mergeClientFiscalFields } = await import('./db/merge_client_fiscal_fields.ts');
      await mergeClientFiscalFields();
    } catch (err) {
      logger.error(
        { err: serializeError(err), migration: 'merge_client_fiscal_fields' },
        'Migration failed',
      );
    }

    // Run data migration for default clients
    try {
      const { migrate: updateClients } = await import('./db/update_default_clients.ts');
      await updateClients();
    } catch (err) {
      logger.error(
        { err: serializeError(err), migration: 'update_default_clients' },
        'Migration failed',
      );
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
      logger.error(
        { err: serializeError(err), migration: 'settings_language' },
        'Migration failed',
      );
    }

    // Run migration to remove payment_terms from clients
    try {
      const { up: removePaymentTerms } = await import('./db/remove_payment_terms_from_clients.ts');
      await removePaymentTerms();
    } catch (err) {
      logger.error(
        { err: serializeError(err), migration: 'remove_payment_terms_from_clients' },
        'Migration failed',
      );
    }

    // Run sale status migration
    try {
      const { migrate: migrateSaleStatus } = await import('./db/migrate_sale_status.ts');
      await migrateSaleStatus();
    } catch (err) {
      logger.error(
        { err: serializeError(err), migration: 'migrate_sale_status' },
        'Migration failed',
      );
    }

    // Run products structure update migration
    try {
      const { migrate: updateProductsStructure } = await import(
        './db/update_products_structure.ts'
      );
      await updateProductsStructure();
    } catch (err) {
      logger.error(
        { err: serializeError(err), migration: 'update_products_structure' },
        'Migration failed',
      );
    }

    // Run migration to assign all items to manager users
    if (!isDemoSeedingEnabled) {
      try {
        const { migrate: assignItemsToManagers } = await import('./db/assign_items_to_managers.ts');
        await assignItemsToManagers();
      } catch (err) {
        logger.error(
          { err: serializeError(err), migration: 'assign_items_to_managers' },
          'Migration failed',
        );
      }
    }

    // Run migration to update currency precision
    try {
      const { migrate: updateCurrencyPrecision } = await import(
        './db/update_currency_precision.ts'
      );
      await updateCurrencyPrecision();
    } catch (err) {
      logger.error(
        { err: serializeError(err), migration: 'update_currency_precision' },
        'Migration failed',
      );
    }

    // Run migration to enforce unique downstream link indexes
    try {
      const { migrate: addUniqueDownstreamLinks } = await import(
        './db/add_unique_downstream_links.ts'
      );
      await addUniqueDownstreamLinks();
    } catch (err) {
      logger.error(
        { err: serializeError(err), migration: 'add_unique_downstream_links' },
        'Migration failed',
      );
    }

    // Run migration to add unique constraint to client_code
    try {
      const { addUniqueClientCode } = await import('./db/add_unique_client_code.ts');
      await addUniqueClientCode();
    } catch (err) {
      logger.error(
        { err: serializeError(err), migration: 'add_unique_client_code' },
        'Migration failed',
      );
    }
  } else {
    logger.warn({ schemaPath }, 'Schema file not found');
  }

  logger.info({ port: PORT }, 'Praetor API server running with HTTP/1.1 over HTTP');

  // Periodic LDAP Sync Task (every hour)
  try {
    const ldapService = (await import('./services/ldap.ts')).default;

    const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
    setInterval(async () => {
      try {
        await ldapService.loadConfig();
        if (ldapService.config?.enabled) {
          logger.info('Running periodic LDAP sync');
          await ldapService.syncUsers();
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ errorMessage }, 'Periodic LDAP sync error');
      }
    }, SYNC_INTERVAL);
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Failed to initialize LDAP sync task');
  }
} catch (err) {
  logger.error({ err: serializeError(err) }, 'Failed to start server');
  process.exit(1);
}

export default fastify;
