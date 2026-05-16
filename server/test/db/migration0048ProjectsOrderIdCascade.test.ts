import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

// Migration 0048 retrofitted ON UPDATE CASCADE onto `projects.order_id` → `sales(id)`.
// The generic FK-cascade invariant for `sales.id` lives in `renamablePkFkCascade.test.ts`;
// this file pins migration-specific shape so a replay against a correct DB stays a no-op
// and the probe stays scoped to the right table.

describe('migration 0048: adds ON UPDATE CASCADE to projects.order_id → sales(id)', () => {
  const MIGRATION = readMigrationFile('0048_add_projects_order_id_on_update_cascade.sql');

  test('drops the existing constraint before recreating it', () => {
    expect(MIGRATION).toContain(
      'ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_order_id_sales_id_fk"',
    );
  });

  test('re-adds the constraint with ON DELETE SET NULL ON UPDATE CASCADE', () => {
    expect(MIGRATION).toMatch(
      /ADD CONSTRAINT "projects_order_id_sales_id_fk"[\s\S]*?FOREIGN KEY \("order_id"\)[\s\S]*?REFERENCES "public"\."sales"\("id"\)[\s\S]*?ON DELETE SET NULL[\s\S]*?ON UPDATE CASCADE/i,
    );
  });

  test('probe gates the drop so a replay against a correct DB is a true no-op', () => {
    // The IF NOT EXISTS probe must come before the DROPs; otherwise the DROPs run
    // unconditionally and the probe (running inside the same DO transaction) always sees
    // the constraint gone. Pin the order: probe → drop → add.
    const probeIdx = MIGRATION.search(
      /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint[\s\S]*?confupdtype = 'c'/,
    );
    const dropIdx = MIGRATION.indexOf('DROP CONSTRAINT IF EXISTS "projects_order_id_sales_id_fk"');
    const addIdx = MIGRATION.search(/ADD CONSTRAINT "projects_order_id_sales_id_fk"/);
    expect(probeIdx).toBeGreaterThanOrEqual(0);
    expect(dropIdx).toBeGreaterThan(probeIdx);
    expect(addIdx).toBeGreaterThan(dropIdx);
  });

  test('probe scopes to projects.order_id → sales.id so a same-named FK on another table cannot mask it', () => {
    // `pg_constraint.conname` is unique within (conrelid, connamespace), not globally.
    // The probe must filter on `conrelid` and `confrelid` so a same-named FK on a
    // different table can't make the IF NOT EXISTS check falsely return true and skip
    // the migration.
    expect(MIGRATION).toMatch(/conrelid\s*=\s*'public\.projects'::regclass/);
    expect(MIGRATION).toMatch(/confrelid\s*=\s*'public\.sales'::regclass/);
  });
});
