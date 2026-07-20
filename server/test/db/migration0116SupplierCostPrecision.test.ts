import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(
    new URL('../../db/migrations/0116_preserve_supplier_cost_precision.sql', import.meta.url),
  ).text();

const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

const readSeed = async () => Bun.file(new URL('../../db/seed.sql', import.meta.url)).text();

describe('migration 0116 supplier-cost precision', () => {
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

  test('freezes existing supplier order and invoice lines at their historical unit cost', async () => {
    const sql = await readMigration();

    for (const table of ['supplier_sale_items', 'supplier_invoice_items']) {
      expect(sql).toContain(`UPDATE "${table}"`);
    }
    expect(
      sql.match(
        /SET "unit_price" = ROUND\("unit_price" \* \(1 - COALESCE\("discount", 0\) \/ 100\.0\), 2\),/g,
      ),
    ).toHaveLength(2);
    expect(sql.match(/WHERE COALESCE\("discount", 0\) <> 0/g)).toHaveLength(2);

    const historicalUnitCost = Math.round(37.75 * (1 - 15 / 100) * 100) / 100;
    expect(historicalUnitCost).toBe(32.09);
    expect(Math.round(historicalUnitCost * 150 * 100) / 100).toBe(4813.5);
  });

  test('freezes discounted lines inside historical supplier order snapshots', async () => {
    const sql = await readMigration();

    expect(sql).toContain('UPDATE "supplier_order_versions"');
    expect(sql).toContain('jsonb_set(');
    expect(sql).toContain('jsonb_array_elements("snapshot" -> \'items\') WITH ORDINALITY');
    expect(sql).toContain("'unitPrice'");
    expect(sql).toContain("'discount', 0");
    expect(sql).toContain('ORDER BY ordinality');
    expect(sql).toContain("WHERE jsonb_typeof(\"snapshot\" -> 'items') = 'array'");
    expect(sql).toContain("WHERE COALESCE(NULLIF(item ->> 'discount', '')::numeric, 0) <> 0");

    const restoreSnapshotLine = (unitPrice: number, discount: number) =>
      discount === 0
        ? { unitPrice, discount }
        : {
            unitPrice: Math.round(unitPrice * (1 - discount / 100) * 100) / 100,
            discount: 0,
          };
    expect(restoreSnapshotLine(37.75, 15)).toEqual({ unitPrice: 32.09, discount: 0 });
    expect(restoreSnapshotLine(32.09, 0)).toEqual({ unitPrice: 32.09, discount: 0 });
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
    expect(sql).toContain('"audit"."details" ->> \'secondaryLabel\' = \'synced_from_client_line\'');

    const preciseFormula = 37.75 * (1 - 15 / 100);
    const oldRoundedFormula = Math.round(preciseFormula * 100) / 100;
    const shouldRebuild = (unitCost: number, hasClientSyncAudit: boolean) =>
      unitCost === oldRoundedFormula && unitCost !== preciseFormula && !hasClientSyncAudit;

    expect(shouldRebuild(32.09, false)).toBe(true);
    expect(shouldRebuild(32.09, true)).toBe(false);
    expect(shouldRebuild(31.5, false)).toBe(false);
  });

  test('upgrades only current two-decimal snapshots and preserves stale or edited history', async () => {
    const sql = await readMigration();

    for (const table of ['quote_items', 'customer_offer_items', 'sale_items']) {
      expect(sql).toContain(`UPDATE "${table}" AS "target"`);
    }
    expect(sql.match(/= ROUND\("source"\."unit_price", 2\)/g)).toHaveLength(3);
    expect(
      sql.match(/"supplier_quote_unit_price" IS DISTINCT FROM "source"\."unit_price"/g),
    ).toHaveLength(3);

    const preciseSource = 32.0875;
    const upgradeSnapshot = (snapshot: number) =>
      snapshot === Math.round(preciseSource * 100) / 100 ? preciseSource : snapshot;
    expect(upgradeSnapshot(32.09)).toBe(32.0875);
    expect(upgradeSnapshot(31.5)).toBe(31.5);
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

  test('is registered after migration 0115', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const migrationIndex = journal.entries.findIndex(
      ({ tag }) => tag === '0116_preserve_supplier_cost_precision',
    );

    expect(journal.entries[migrationIndex - 1]).toEqual(expect.objectContaining({ idx: 115 }));
    expect(journal.entries[migrationIndex]).toEqual(
      expect.objectContaining({ idx: 116, tag: '0116_preserve_supplier_cost_precision' }),
    );
  });
});
