import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import buildApp from './app.ts';
import { DEFAULT_ADMIN_PASSWORD, ensureBootstrapAdmin } from './db/bootstrapAdmin.ts';
import { runDemoSeedRefresh } from './db/demoSeed.ts';
import { query } from './db/index.ts';
import { createChildLogger, serializeError } from './utils/logger.ts';

const PORT = Number(process.env.PORT ?? 3001);
const DEFAULT_JWT_SECRET = 'praetor-secret-key-change-in-production';
const DEFAULT_ENCRYPTION_KEY = 'praetor-encryption-key-change-in-production';
const logger = createChildLogger({ module: 'startup' });
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const schemaPath = join(__dirname, 'db', 'schema.sql');
const REQUIRED_BOOTSTRAP_TABLES = [
  'roles',
  'users',
  'user_roles',
  'settings',
  'user_clients',
  'user_projects',
  'user_tasks',
] as const;

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

const bootstrapDatabase = async () => {
  if (!existsSync(schemaPath)) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }

  const schemaSql = readFileSync(schemaPath, 'utf8');
  await query(schemaSql);

  const tableCheck = await query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name
    `,
    [REQUIRED_BOOTSTRAP_TABLES],
  );

  const foundTables = tableCheck.rows.map((row) => String(row.table_name));
  const missingTables = REQUIRED_BOOTSTRAP_TABLES.filter(
    (tableName) => !foundTables.includes(tableName),
  );

  logger.info({ foundTables }, 'Database schema verified');

  if (missingTables.length > 0) {
    throw new Error(`Database bootstrap incomplete. Missing tables: ${missingTables.join(', ')}`);
  }
};

const shutdown = async (signal: string) => {
  try {
    logger.info({ signal }, 'Shutting down');
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

  await bootstrapDatabase();

  // Ensure required bootstrap user data always exists.
  await ensureBootstrapAdmin();

  // Run demo seed.sql only when explicitly enabled.
  const isDemoSeedingEnabled = parseBooleanEnv(process.env.DEMO_SEEDING);
  if (isDemoSeedingEnabled) {
    await runDemoSeedRefresh({ source: 'startup' });
  } else {
    logger.info('Demo seeding disabled (set DEMO_SEEDING=true to enable)');
  }

  await fastify.listen({ port: PORT, host: '0.0.0.0' });

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
