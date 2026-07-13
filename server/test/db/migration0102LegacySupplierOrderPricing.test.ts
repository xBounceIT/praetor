import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(
    new URL('../../db/migrations/0102_backfill_legacy_supplier_order_pricing.sql', import.meta.url),
  ).text();

const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

describe('migration 0102 legacy supplier-order pricing', () => {
  test('restores list price and supplier discount from an unambiguous linked quote item', async () => {
    const sql = await readMigration();

    expect(sql).toContain('WITH "unambiguous_legacy_pricing" AS');
    expect(sql).toContain('INNER JOIN "supplier_quote_items"');
    expect(sql).toContain('MIN("sqi"."list_price") AS "list_price"');
    expect(sql).toContain('MIN("sqi"."discount_percent") AS "discount_percent"');
    expect(sql).toContain('COUNT(DISTINCT "sqi"."list_price") = 1');
    expect(sql).toContain('COUNT(DISTINCT "sqi"."discount_percent") = 1');
    expect(sql).toContain('"unit_price" = "ulp"."list_price"');
    expect(sql).toContain('"discount" = "ulp"."discount_percent"');
  });

  test('only updates untouched legacy net-price rows and is retry-safe', async () => {
    const sql = await readMigration();

    expect(sql).toContain('COALESCE("ssi"."discount", 0) = 0');
    expect(sql).toContain('"sqi"."discount_percent" > 0');
    expect(sql).toContain('"ssi"."unit_price" = "sqi"."unit_price"');
    expect(sql).toContain('"ssi"."product_id" IS NOT NULL');
    expect(sql).toContain('"sqi"."product_id" = "ssi"."product_id"');
    expect(sql).toContain('"sqi"."product_name" = "ssi"."product_name"');
  });

  test('is registered after migration 0101', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    expect(journal.entries.at(-1)).toEqual(
      expect.objectContaining({
        idx: 102,
        tag: '0102_backfill_legacy_supplier_order_pricing',
      }),
    );
  });
});
