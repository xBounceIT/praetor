import { runDemoSeedRefresh } from '../db/demoSeed.ts';
import pool from '../db/index.ts';
import { createChildLogger, serializeError } from '../utils/logger.ts';

const logger = createChildLogger({ module: 'scripts:seed-demo' });

try {
  await runDemoSeedRefresh({ source: 'manual' });
  logger.info('Demo seed refresh finished successfully');
  await pool.end();
  process.exit(0);
} catch (err) {
  logger.error({ err: serializeError(err) }, 'Demo seed refresh failed');
  await pool.end();
  process.exit(1);
}
