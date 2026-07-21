import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(
    new URL('../../db/migrations/0117_preserve_supplier_cost_precision.sql', import.meta.url),
  ).text();

const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

const readSeed = async () => Bun.file(new URL('../../db/seed.sql', import.meta.url)).text();

describe('migration 0117 supplier discount history', () => {
  test('adds a legacy-safe calculation marker to supplier document lines', async () => {
    const sql = await readMigration();

    for (const table of ['supplier_invoice_items', 'supplier_sale_items']) {
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD COLUMN "legacy_discount_rounding" boolean DEFAULT true NOT NULL`,
      );
    }
  });

  test('marks discounted legacy rows without overwriting gross price or discount', async () => {
    const sql = await readMigration();

    expect(sql).toContain('old app instance during a rolling deployment');
    expect(sql).not.toContain('SET "legacy_discount_rounding" = true');
    expect(sql).not.toContain('UPDATE "supplier_invoice_items"\nSET "unit_price"');
    expect(sql).not.toContain('UPDATE "supplier_sale_items"\nSET "unit_price"');
    expect(sql).not.toContain('UPDATE "supplier_invoice_items"\nSET "discount"');
    expect(sql).not.toContain('UPDATE "supplier_sale_items"\nSET "discount"');

    const historicalLine = { unitPrice: 37.75, discount: 15, legacyDiscountRounding: true };
    const calculationUnitPrice = historicalLine.legacyDiscountRounding
      ? Math.round(historicalLine.unitPrice * (1 - historicalLine.discount / 100) * 100) / 100
      : historicalLine.unitPrice * (1 - historicalLine.discount / 100);
    expect(historicalLine).toEqual({
      unitPrice: 37.75,
      discount: 15,
      legacyDiscountRounding: true,
    });
    expect(calculationUnitPrice * 150).toBeCloseTo(4813.5);
  });

  test('marks historical order snapshots without changing their pricing fields', async () => {
    const sql = await readMigration();

    expect(sql).toContain('UPDATE "supplier_order_versions"');
    expect(sql).toContain("jsonb_build_object('legacyDiscountRounding', true)");
    expect(sql).toContain('ORDER BY ordinality');
    expect(sql).toContain("item -> 'legacyDiscountRounding' IS DISTINCT FROM 'true'::jsonb");
    expect(sql).not.toContain("jsonb_build_object('unitPrice'");
    expect(sql).not.toContain("'discount', 0");

    const snapshot = { unitPrice: 37.75, discount: 15, note: 'negotiated' };
    expect({ ...snapshot, legacyDiscountRounding: true }).toEqual({
      unitPrice: 37.75,
      discount: 15,
      note: 'negotiated',
      legacyDiscountRounding: true,
    });
  });

  test('keeps newly seeded supplier documents on precise calculation semantics', async () => {
    const seedSql = await readSeed();

    expect(seedSql.match(/legacy_discount_rounding/g)?.length).toBeGreaterThanOrEqual(4);
    expect(seedSql).toMatch(/v\.discount,\r?\n\s+false,\r?\n\s+v\.note/);
    expect(seedSql).toContain('960.00, 0.00, false)');
  });

  test('ships in the combined precision migration immediately after main', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const migrationIndex = journal.entries.findIndex(
      ({ tag }) => tag === '0117_preserve_supplier_cost_precision',
    );

    expect(journal.entries[migrationIndex - 1]).toEqual(
      expect.objectContaining({ idx: 116, tag: '0116_add_document_descriptions' }),
    );
    expect(journal.entries[migrationIndex]).toEqual(
      expect.objectContaining({ idx: 117, tag: '0117_preserve_supplier_cost_precision' }),
    );
  });
});
