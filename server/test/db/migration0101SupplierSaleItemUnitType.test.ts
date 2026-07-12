import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(
    new URL('../../db/migrations/0101_add_supplier_sale_item_unit_type.sql', import.meta.url),
  ).text();

const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

const readSeed = async () => Bun.file(new URL('../../db/seed.sql', import.meta.url)).text();

describe('migration 0101 supplier-sale item quantity unit', () => {
  test('adds a constrained column and backfills only unambiguous linked-quote units', async () => {
    const sql = await readMigration();

    expect(sql).toContain(`ADD COLUMN "unit_type" varchar(10) DEFAULT 'hours' NOT NULL`);
    expect(sql).toContain('WITH "unambiguous_quote_units" AS');
    expect(sql).toContain('INNER JOIN "supplier_quote_items"');
    expect(sql).toContain('HAVING COUNT(DISTINCT "sqi"."unit_type") = 1');
    expect(sql).toContain('SET "unit_type" = "uqu"."unit_type"');
    expect(sql).toContain(`CHECK ("supplier_sale_items"."unit_type" IN ('hours', 'days', 'unit'))`);
  });

  test('keeps canonical demo supplier-order units explicit', async () => {
    const sql = await readSeed();

    expect(sql).toMatch(/INSERT INTO supplier_sale_items \([\s\S]*?unit_type,[\s\S]*?\)/);
    expect(sql).toContain("'dm_ssi_01', pg_temp.demo_document_code('supplier_order', 1)");
    expect(sql).toContain("4.00, 'unit', 960.00");
    expect(sql).toContain('unit_type = EXCLUDED.unit_type');
  });

  test('is registered after migration 0100', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    expect(journal.entries.at(-1)).toEqual(
      expect.objectContaining({ idx: 101, tag: '0101_add_supplier_sale_item_unit_type' }),
    );
  });
});
