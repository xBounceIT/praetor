#!/usr/bin/env bun
import 'dotenv/config';
import pool from '../db/index.ts';
import { verifyDbReadiness } from '../db/readiness.ts';

try {
  const result = await verifyDbReadiness();
  console.info(
    `Database ready: ${result.appliedMigrations}/${result.expectedMigrations} migrations applied; ${result.probedTables.length} tables probed.`,
  );
} catch (err) {
  console.error('Database readiness check failed:');
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
