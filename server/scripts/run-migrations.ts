#!/usr/bin/env bun
// Programmatic Drizzle migration runner.
//
// We use drizzle-orm's migrator directly instead of `drizzle-kit migrate`
// because drizzle-kit 0.31.10's CLI swallows errors in non-TTY environments:
// hanji's renderWithTask consumes the migrate promise's rejection inside its
// spinner machinery, so the outer catch never prints the actual error and
// stderr is left empty when migrations fail. This blocks CI diagnosis and
// breaks any deploy script that relies on stderr to surface failures.
//
// drizzle-orm's `migrate` function reads the same `db/migrations/` directory
// and `meta/_journal.json` as drizzle-kit, applies migrations in the same
// order, and records them in the same `__drizzle_migrations` tracking table.
// The behaviour is identical; only the framing differs.

import 'dotenv/config';
import { runDrizzleMigrations } from '../db/migrationsRunner.ts';

try {
  await runDrizzleMigrations();
} catch (err) {
  console.error('Migration failed:');
  console.error(err);
  process.exitCode = 1;
}
