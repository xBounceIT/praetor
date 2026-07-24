import { describe, expect, test } from 'bun:test';
import { readMigrationFile, readSchemaFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0123_enforce_internal_category_name_uniqueness.sql');
const SCHEMA = readSchemaFile('productCategories.ts');
const JOURNAL = (await Bun.file(
  new URL('../../db/migrations/meta/_journal.json', import.meta.url),
).json()) as { entries: Array<{ idx: number; tag: string }> };

describe('migration 0123 internal category name uniqueness', () => {
  test('models the category index as case-insensitive in the live schema', () => {
    expect(SCHEMA).toContain('internal_product_categories_name_type_key');
    expect(SCHEMA).toMatch(/sql`lower\(\$\{table\.name\}\)`/);
  });

  test('serializes category writes while replacing the case-sensitive uniqueness', () => {
    expect(MIGRATION).toContain(
      'LOCK TABLE "internal_product_categories" IN SHARE ROW EXCLUSIVE MODE',
    );
    expect(MIGRATION).toContain(
      'ALTER TABLE "internal_product_categories" DROP CONSTRAINT IF EXISTS "internal_product_categories_name_type_key"',
    );
    expect(MIGRATION).toContain('DROP INDEX IF EXISTS "internal_product_categories_name_type_key"');
    expect(MIGRATION).toContain(
      'CREATE UNIQUE INDEX "internal_product_categories_name_type_key" ON "internal_product_categories" USING btree (lower("name"),"type")',
    );
  });

  test('preserves and deterministically renames legacy case-only duplicates', () => {
    expect(MIGRATION).toContain('PARTITION BY LOWER("name"), "type"');
    expect(MIGRATION).toContain('ORDER BY "created_at" ASC NULLS LAST, "id" ASC');
    expect(MIGRATION).toContain('FORMAT(\' (duplicate %s)\', "duplicate_number")');
    expect(MIGRATION).toContain('LOWER("existing_category"."name") = LOWER("candidate_name")');
    expect(MIGRATION).not.toMatch(/DELETE\s+FROM\s+"internal_product_categories"/i);
  });

  test('moves internal product references before renaming each category', () => {
    const productsUpdate = MIGRATION.indexOf('UPDATE "products"');
    const categoriesUpdate = MIGRATION.indexOf('UPDATE "internal_product_categories"');
    const constraintDrop = MIGRATION.indexOf(
      'ALTER TABLE "internal_product_categories" DROP CONSTRAINT IF EXISTS "internal_product_categories_name_type_key"',
    );
    const indexDrop = MIGRATION.indexOf(
      'DROP INDEX IF EXISTS "internal_product_categories_name_type_key"',
    );

    expect(productsUpdate).toBeGreaterThan(-1);
    expect(MIGRATION).toContain('"supplier_id" IS NULL');
    expect(categoriesUpdate).toBeGreaterThan(productsUpdate);
    expect(constraintDrop).toBeGreaterThan(categoriesUpdate);
    expect(indexDrop).toBeGreaterThan(constraintDrop);
  });

  test('is registered immediately after migration 0122', () => {
    const migrationIndex = JOURNAL.entries.findIndex(
      ({ tag }) => tag === '0123_enforce_internal_category_name_uniqueness',
    );

    expect(JOURNAL.entries[migrationIndex - 1]).toEqual(
      expect.objectContaining({
        idx: 122,
        tag: '0122_enforce_resale_category_name_uniqueness',
      }),
    );
    expect(JOURNAL.entries[migrationIndex]).toEqual(
      expect.objectContaining({
        idx: 123,
        tag: '0123_enforce_internal_category_name_uniqueness',
      }),
    );
  });
});
