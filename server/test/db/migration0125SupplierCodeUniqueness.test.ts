import { describe, expect, test } from 'bun:test';
import { readMigrationFile, readSchemaFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0125_enforce_supplier_code_uniqueness.sql');
const SCHEMA = readSchemaFile('suppliers.ts');
const JOURNAL = (await Bun.file(
  new URL('../../db/migrations/meta/_journal.json', import.meta.url),
).json()) as { entries: Array<{ idx: number; tag: string }> };

describe('migration 0125 supplier code uniqueness', () => {
  test('models the supplier-code index as case-insensitive in the live schema', () => {
    expect(SCHEMA).toContain('idx_suppliers_supplier_code_unique');
    expect(SCHEMA).toMatch(/sql`LOWER\(\$\{table\.supplierCode\}\)`/);
  });

  test('serializes supplier writes while backfilling and creating the unique index', () => {
    expect(MIGRATION).toContain('LOCK TABLE "suppliers" IN SHARE ROW EXCLUSIVE MODE');
    expect(MIGRATION).toContain(
      'CREATE UNIQUE INDEX "idx_suppliers_supplier_code_unique" ON "suppliers" USING btree (LOWER("supplier_code"))',
    );
  });

  test('preserves and deterministically renames legacy case-insensitive duplicates', () => {
    expect(MIGRATION).toContain('PARTITION BY LOWER("supplier_code")');
    expect(MIGRATION).toContain('ORDER BY "created_at" ASC NULLS LAST, "id" ASC');
    expect(MIGRATION).toContain('FORMAT(\' (duplicate %s)\', "duplicate_number")');
    expect(MIGRATION).toContain(
      'LOWER("existing_supplier"."supplier_code") = LOWER("candidate_code")',
    );
    expect(MIGRATION).not.toMatch(/DELETE\s+FROM\s+"suppliers"/i);
  });

  test('is registered immediately after migration 0124', () => {
    const migrationIndex = JOURNAL.entries.findIndex(
      ({ tag }) => tag === '0125_enforce_supplier_code_uniqueness',
    );

    expect(JOURNAL.entries[migrationIndex - 1]).toEqual(
      expect.objectContaining({
        idx: 124,
        tag: '0124_restrict_user_roles_role_id_fk',
      }),
    );
    expect(JOURNAL.entries[migrationIndex]).toEqual(
      expect.objectContaining({
        idx: 125,
        tag: '0125_enforce_supplier_code_uniqueness',
      }),
    );
  });
});
