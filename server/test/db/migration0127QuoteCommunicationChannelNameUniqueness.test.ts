import { describe, expect, test } from 'bun:test';
import { readMigrationFile, readSchemaFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0127_enforce_quote_communication_channel_name_uniqueness.sql');
const SCHEMA = readSchemaFile('quoteCommunicationChannels.ts');
const JOURNAL = (await Bun.file(
  new URL('../../db/migrations/meta/_journal.json', import.meta.url),
).json()) as { entries: Array<{ idx: number; tag: string }> };

describe('migration 0127 quote communication channel name uniqueness', () => {
  test('models the channel index as case-insensitive in the live schema', () => {
    expect(SCHEMA).toContain('quote_communication_channels_name_unique');
    expect(SCHEMA).toMatch(/sql`lower\(\$\{table\.name\}\)`/);
    expect(SCHEMA).not.toMatch(/\.notNull\(\)\.unique\(\)/);
  });

  test('serializes channel writes while replacing the case-sensitive unique constraint', () => {
    expect(MIGRATION).toContain(
      'LOCK TABLE "quote_communication_channels" IN SHARE ROW EXCLUSIVE MODE',
    );
    expect(MIGRATION).toContain(
      'DROP CONSTRAINT IF EXISTS "quote_communication_channels_name_unique"',
    );
    expect(MIGRATION).toContain(
      'CREATE UNIQUE INDEX "quote_communication_channels_name_unique" ON "quote_communication_channels" USING btree (lower("name"))',
    );
  });

  test('preserves and deterministically renames legacy case-only duplicates', () => {
    expect(MIGRATION).toContain('PARTITION BY LOWER("name")');
    expect(MIGRATION).toContain('ORDER BY "created_at" ASC NULLS LAST, "id" ASC');
    expect(MIGRATION).toContain('FORMAT(\' (duplicate %s)\', "duplicate_number")');
    expect(MIGRATION).toContain('LOWER("existing_channel"."name") = LOWER("candidate_name")');
    expect(MIGRATION).not.toMatch(/DELETE\s+FROM\s+"quote_communication_channels"/i);
  });

  test('is registered immediately after migration 0126', () => {
    const migrationIndex = JOURNAL.entries.findIndex(
      ({ tag }) => tag === '0127_enforce_quote_communication_channel_name_uniqueness',
    );

    expect(JOURNAL.entries[migrationIndex - 1]).toEqual(
      expect.objectContaining({
        idx: 126,
        tag: '0126_enforce_customer_offer_item_product_cost_non_negative',
      }),
    );
    expect(JOURNAL.entries[migrationIndex]).toEqual(
      expect.objectContaining({
        idx: 127,
        tag: '0127_enforce_quote_communication_channel_name_uniqueness',
      }),
    );
  });
});
