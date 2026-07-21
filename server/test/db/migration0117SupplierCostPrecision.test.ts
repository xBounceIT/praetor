import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(
    new URL('../../db/migrations/0117_preserve_supplier_cost_precision.sql', import.meta.url),
  ).text();

const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

const readSeed = async () => Bun.file(new URL('../../db/seed.sql', import.meta.url)).text();

describe('migration 0117 supplier-cost precision', () => {
  test('widens the derived supplier cost and every downstream client snapshot', async () => {
    const sql = await readMigration();

    for (const alteration of [
      '"customer_offer_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6)',
      '"quote_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6)',
      '"sale_items" ALTER COLUMN "supplier_quote_unit_price" SET DATA TYPE numeric(19, 6)',
      '"supplier_quote_items" ALTER COLUMN "unit_price" SET DATA TYPE numeric(19, 6)',
    ]) {
      expect(sql).toContain(alteration);
    }
  });

  test('rebuilds legacy formula-derived costs without intermediate rounding', async () => {
    const sql = await readMigration();

    expect(sql).toContain(
      '("target"."list_price" * (1 - "target"."discount_percent" / 100.0))::numeric(19, 6)',
    );
    expect(sql).toContain('"target"."unit_price" IS DISTINCT FROM');

    // Legacy 32.09 is restored to 32.087500, so 150 units round once to 4813.13.
    const restoredUnitCost = 37.75 * (1 - 15 / 100);
    expect(restoredUnitCost).toBe(32.0875);
    expect(Math.round(restoredUnitCost * 150 * 100) / 100).toBe(4813.13);
  });

  test('does not discard existing supplier order and invoice discount data', async () => {
    const sql = await readMigration();

    expect(sql).not.toContain('SET "unit_price" = ROUND("unit_price"');
    expect(sql).not.toContain('"discount" = 0');
  });

  test('does not flatten discounted lines inside historical supplier order snapshots', async () => {
    const sql = await readMigration();

    expect(sql).not.toContain("jsonb_build_object('unitPrice'");
    expect(sql).not.toContain("'discount', 0");
  });

  test('preserves manual and client-synced unit costs during the backfill', async () => {
    const sql = await readMigration();

    expect(sql).toContain(
      '"target"."unit_price" =\n    ROUND("target"."list_price" * (1 - "target"."discount_percent" / 100.0), 2)',
    );
    expect(sql).toContain('AND NOT EXISTS (');
    expect(sql).toContain('"audit"."action" = \'supplier_quote.updated\'');
    expect(sql).toContain('"audit"."entity_type" = \'supplier_quote\'');
    expect(sql).toContain('"audit"."entity_id" = "target"."quote_id"');
    expect(sql).toContain('FROM "supplier_quote_versions" AS "version"');
    expect(sql).toContain('"version"."quote_id" = "target"."quote_id"');
    expect(sql).toContain('"version"."snapshot" -> \'quote\' ->> \'id\' = "audit"."entity_id"');
    expect(sql).toContain('"audit"."details" ->> \'secondaryLabel\' = \'synced_from_client_line\'');

    const preciseFormula = 37.75 * (1 - 15 / 100);
    const oldRoundedFormula = Math.round(preciseFormula * 100) / 100;
    const shouldRebuild = (unitCost: number, hasClientSyncAudit: boolean) =>
      unitCost === oldRoundedFormula && unitCost !== preciseFormula && !hasClientSyncAudit;

    expect(shouldRebuild(32.09, false)).toBe(true);
    expect(shouldRebuild(32.09, true)).toBe(false);
    expect(shouldRebuild(31.5, false)).toBe(false);
  });

  test('upgrades current client snapshots but preserves linked orders and edited history', async () => {
    const sql = await readMigration();

    for (const table of ['quote_items', 'customer_offer_items', 'sale_items']) {
      const start = sql.indexOf(`UPDATE "${table}" AS "target"`);
      const backfill = sql.slice(start, sql.indexOf(';--> statement-breakpoint', start));

      expect(start).toBeGreaterThan(-1);
      expect(backfill).toContain('= ROUND("source"."unit_price", 2)');
      expect(backfill).toContain(
        '"supplier_quote_unit_price" IS DISTINCT FROM "source"."unit_price"',
      );
    }
    const saleItemsBackfill = sql.slice(sql.indexOf('UPDATE "sale_items" AS "target"'));
    expect(saleItemsBackfill).toContain('"target"."supplier_sale_id" IS NULL');
    expect(saleItemsBackfill).toContain('"target"."supplier_sale_item_id" IS NULL');

    const preciseSource = 32.0875;
    const upgradeSnapshot = (snapshot: number, linkedSupplierOrder = false) =>
      !linkedSupplierOrder && snapshot === Math.round(preciseSource * 100) / 100
        ? preciseSource
        : snapshot;
    expect(upgradeSnapshot(32.09)).toBe(32.0875);
    expect(upgradeSnapshot(32.09, true)).toBe(32.09);
    expect(upgradeSnapshot(31.5)).toBe(31.5);
  });

  test('upgrades matching costs inside restorable client version snapshots', async () => {
    const sql = await readMigration();

    for (const table of ['quote_versions', 'offer_versions']) {
      const start = sql.indexOf(`UPDATE "${table}" AS "version"`);
      const backfill = sql.slice(start, sql.indexOf(';--> statement-breakpoint', start));

      expect(start).toBeGreaterThan(-1);
      expect(backfill).toContain('jsonb_array_elements("version"."snapshot" -> \'items\')');
      expect(backfill).toContain('WITH ORDINALITY AS entry(item, ordinality)');
      expect(backfill).toContain('"source"."id" = item ->> \'supplierQuoteItemId\'');
      expect(backfill).toContain("jsonb_typeof(item -> 'supplierQuoteUnitPrice') = 'number'");
      expect(backfill).toContain(
        'item || jsonb_build_object(\'supplierQuoteUnitPrice\', "source"."unit_price")',
      );
      expect(backfill).toContain('ORDER BY ordinality');
    }

    const preciseSource = 32.0875;
    const upgradeVersionSnapshot = (snapshot: number) =>
      snapshot === Math.round(preciseSource * 100) / 100 ? preciseSource : snapshot;
    expect(upgradeVersionSnapshot(32.09)).toBe(32.0875);
    expect(upgradeVersionSnapshot(31.5)).toBe(31.5);
    expect(upgradeVersionSnapshot(upgradeVersionSnapshot(32.09))).toBe(32.0875);
  });

  test('keeps canonical demo supplier pricing inputs explicit', async () => {
    const seed = await readSeed();
    const block = seed.slice(
      seed.indexOf('INSERT INTO supplier_quote_items'),
      seed.indexOf('-- #779 fully derived supplier-quote statuses'),
    );

    expect(block).toContain('list_price');
    expect(block).toContain('discount_percent');
    expect(block).toContain('list_price = EXCLUDED.list_price');
    expect(block).toContain('discount_percent = EXCLUDED.discount_percent');
    expect(block).toContain('8.00, 1200.00, 20.00, 960.000000');
  });

  test('is registered after the document-description migration from main', async () => {
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
