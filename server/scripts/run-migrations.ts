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
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const parsedDbPort = Number.parseInt(process.env.DB_PORT ?? '5432', 10);
const dbPort = Number.isFinite(parsedDbPort) ? parsedDbPort : 5432;

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: dbPort,
  database: process.env.DB_NAME || 'praetor',
  user: process.env.DB_USER || 'praetor',
  password: process.env.DB_PASSWORD || 'praetor',
});

const db = drizzle(pool);

try {
  console.log(
    `Applying Drizzle migrations against ${process.env.DB_HOST ?? 'localhost'}:${dbPort}/${process.env.DB_NAME ?? 'praetor'}...`,
  );
  await migrate(db, { migrationsFolder: './db/migrations' });
  console.log('Migrations applied (or already up to date).');
} catch (err) {
  console.error('Migration failed:');
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
