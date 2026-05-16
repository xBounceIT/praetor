import { describe, expect, test } from 'bun:test';
import { listSchemaFiles, readMigrationFile, readSchemaFile } from '../helpers/schemaFiles.ts';

// PUT /api/clients-orders/:id renames a sales.id (the route accepts a new `id` and
// validates it through `clientsOrdersRepo.findIdConflict`). Every FK that references
// `sales.id` must therefore declare `onUpdate: 'cascade'`, otherwise the rename fails
// mid-transaction with a FK violation from whichever child table didn't cascade.

const SALES_ID_REFERENCE = /\.references\(\s*\(\s*\)\s*=>\s*sales\.id\s*,\s*\{([\s\S]*?)\}\s*\)/g;

const salesIdFks = listSchemaFiles().flatMap((file) => {
  const content = readSchemaFile(file);
  return [...content.matchAll(SALES_ID_REFERENCE)].map((match, index) => ({
    file,
    index,
    optionsBlock: match[1],
  }));
});

describe('every FK to sales.id declares onUpdate: cascade', () => {
  // Sanity check: if the regex above ever silently stops matching (formatter rewrite,
  // Drizzle API change), `salesIdFks` would be empty and `test.each` would emit zero
  // tests — a silent pass. Pin a floor matching the known FK count so a regression in
  // the discovery regex fails loudly.
  test('discovers at least 4 FKs (sale_items, invoices, order_versions, projects)', () => {
    expect(salesIdFks.length).toBeGreaterThanOrEqual(4);
  });

  test.each(salesIdFks)('FK #$index in $file declares onUpdate: cascade', ({ optionsBlock }) => {
    expect(optionsBlock).toMatch(/onUpdate:\s*'cascade'/);
  });
});

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
});
