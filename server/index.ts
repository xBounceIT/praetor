import buildApp from './app.ts';
import { ensureBootstrapAdmin } from './db/bootstrapAdmin.ts';
import { runDemoSeedRefresh } from './db/demoSeed.ts';
import { query } from './db/index.ts';
import { prepareDatabaseForStartup } from './db/startup.ts';
import {
  type LdapSyncSchedulerHandle,
  startLdapSyncScheduler,
} from './services/ldapSyncScheduler.ts';
import {
  type ProjectRulesSchedulerHandle,
  startProjectRulesScheduler,
} from './services/projectRulesScheduler.ts';
import siemService from './services/siem.ts';
import { performShutdown } from './shutdown.ts';
import { createChildLogger, serializeError } from './utils/logger.ts';
import {
  INSECURE_DEFAULT_ENCRYPTION_KEYS,
  INSECURE_DEFAULT_JWT_SECRETS,
  validateRequiredNonDefaultEnv,
} from './utils/runtimeConfig.ts';

const PORT = Number(process.env.PORT ?? 3001);
const logger = createChildLogger({ module: 'startup' });

const fastify = await buildApp();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const parseBooleanEnv = (value: string | undefined): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const assertSecureRuntimeConfig = () => {
  const errors = [
    validateRequiredNonDefaultEnv('JWT_SECRET', INSECURE_DEFAULT_JWT_SECRETS),
    validateRequiredNonDefaultEnv('ENCRYPTION_KEY', INSECURE_DEFAULT_ENCRYPTION_KEYS),
  ].filter((error): error is string => error !== null);

  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }
};

let ldapSyncScheduler: LdapSyncSchedulerHandle | null = null;
let projectRulesScheduler: ProjectRulesSchedulerHandle | null = null;

const shutdown = async (signal: string) => {
  ldapSyncScheduler?.stop();
  projectRulesScheduler?.stop();
  const code = await performShutdown(fastify, signal, logger, () => siemService.shutdown());
  process.exit(code);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Start server
try {
  assertSecureRuntimeConfig();

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

  const readiness = await prepareDatabaseForStartup();
  logger.info(
    {
      appliedMigrations: readiness.appliedMigrations,
      expectedMigrations: readiness.expectedMigrations,
      probedTableCount: readiness.probedTables.length,
    },
    'Database schema verified',
  );

  // Ensure required bootstrap user data always exists.
  await ensureBootstrapAdmin();

  // Run demo seed.sql only when explicitly enabled.
  const isDemoSeedingEnabled = parseBooleanEnv(process.env.DEMO_SEEDING);
  if (isDemoSeedingEnabled) {
    await runDemoSeedRefresh({ source: 'startup' });
  } else {
    logger.info('Demo seeding disabled (set DEMO_SEEDING=true to enable)');
  }

  // SIEM starts only after migrations/readiness so bootstrap logs remain stdout-only.
  await siemService.initialize();

  await fastify.listen({ port: PORT, host: '0.0.0.0' });

  logger.info({ port: PORT }, 'Praetor API server running with HTTP/1.1 over HTTP');

  try {
    const ldapService = (await import('./services/ldap.ts')).default;
    ldapSyncScheduler = startLdapSyncScheduler({
      ldapService,
      logger,
      intervalMs: 60 * 60 * 1000,
    });
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Failed to initialize LDAP sync task');
  }

  projectRulesScheduler = startProjectRulesScheduler({ logger });
} catch (err) {
  logger.error({ err: serializeError(err) }, 'Failed to start server');
  process.exit(1);
}

export default fastify;
