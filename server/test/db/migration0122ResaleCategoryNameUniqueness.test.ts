import { describe, expect, test } from 'bun:test';
import { readMigrationFile, readSchemaFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0122_enforce_resale_category_name_uniqueness.sql');
const SCHEMA = readSchemaFile('resales.ts');
const JOURNAL = (await Bun.file(
  new URL('../../db/migrations/meta/_journal.json', import.meta.url),
).json()) as { entries: Array<{ idx: number; tag: string }> };

describe('migration 0122 resale category name uniqueness', () => {
  test('models the category index as case-insensitive in the live schema', () => {
    expect(SCHEMA).toContain('idx_resale_categories_name_unique');
    expect(SCHEMA).toMatch(/sql`lower\(\$\{table\.name\}\)`/);
  });

  test('serializes category writes while replacing the case-sensitive index', () => {
    expect(MIGRATION).toContain('LOCK TABLE "resale_categories" IN SHARE ROW EXCLUSIVE MODE');
    expect(MIGRATION).toContain('DROP INDEX IF EXISTS "idx_resale_categories_name_unique"');
    expect(MIGRATION).toContain(
      'CREATE UNIQUE INDEX "idx_resale_categories_name_unique" ON "resale_categories" USING btree (lower("name"))',
    );
  });

  test('preserves and deterministically renames legacy case-only duplicates', () => {
    expect(MIGRATION).toContain('PARTITION BY LOWER("name")');
    expect(MIGRATION).toContain('ORDER BY "created_at" ASC NULLS LAST, "id" ASC');
    expect(MIGRATION).toContain('FORMAT(\' (duplicate %s)\', "duplicate_number")');
    expect(MIGRATION).toContain('LOWER("existing_category"."name") = LOWER("candidate_name")');
    expect(MIGRATION).not.toMatch(/DELETE\s+FROM\s+"resale_categories"/i);
  });

  test('is registered immediately after migration 0121', () => {
    const migrationIndex = JOURNAL.entries.findIndex(
      ({ tag }) => tag === '0122_enforce_resale_category_name_uniqueness',
    );

    expect(JOURNAL.entries[migrationIndex - 1]).toEqual(
      expect.objectContaining({ idx: 121, tag: '0121_enforce_time_entry_keys' }),
    );
    expect(JOURNAL.entries[migrationIndex]).toEqual(
      expect.objectContaining({
        idx: 122,
        tag: '0122_enforce_resale_category_name_uniqueness',
      }),
    );
  });
});
