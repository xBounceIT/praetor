import { describe, expect, test } from 'bun:test';
import { readMigrationFile, readSchemaFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile(
  '0126_enforce_customer_offer_item_product_cost_non_negative.sql',
);
const SCHEMA = readSchemaFile('customerOfferItems.ts');
const JOURNAL = (await Bun.file(
  new URL('../../db/migrations/meta/_journal.json', import.meta.url),
).json()) as { entries: Array<{ idx: number; tag: string }> };

describe('migration 0126 customer offer item product cost non-negative', () => {
  test('models the non-negative product_cost check in the live schema', () => {
    expect(SCHEMA).toContain('chk_customer_offer_items_product_cost_non_negative');
    expect(SCHEMA).toMatch(/sql`\$\{table\.productCost\} >= 0`/);
  });

  test('clamps legacy negative costs before adding the CHECK constraint', () => {
    expect(MIGRATION).toContain(
      'UPDATE "customer_offer_items" SET "product_cost" = 0 WHERE "product_cost" < 0',
    );
    expect(MIGRATION).toContain('chk_customer_offer_items_product_cost_non_negative');
    expect(MIGRATION).toContain('CHECK ("customer_offer_items"."product_cost" >= 0)');
    expect(MIGRATION.indexOf('UPDATE "customer_offer_items"')).toBeLessThan(
      MIGRATION.indexOf('ADD CONSTRAINT "chk_customer_offer_items_product_cost_non_negative"'),
    );
  });

  test('is registered immediately after migration 0125', () => {
    const migrationIndex = JOURNAL.entries.findIndex(
      ({ tag }) => tag === '0126_enforce_customer_offer_item_product_cost_non_negative',
    );

    expect(JOURNAL.entries[migrationIndex - 1]).toEqual(
      expect.objectContaining({
        idx: 125,
        tag: '0125_enforce_supplier_code_uniqueness',
      }),
    );
    expect(JOURNAL.entries[migrationIndex]).toEqual(
      expect.objectContaining({
        idx: 126,
        tag: '0126_enforce_customer_offer_item_product_cost_non_negative',
      }),
    );
  });
});
