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

  test('rebuilds legacy rounded costs from list price and discount without intermediate rounding', async () => {
    const sql = await readMigration();

    expect(sql).toContain('("list_price" * (1 - "discount_percent" / 100.0))::numeric(19, 6)');
    expect(sql).toContain('"unit_price" IS DISTINCT FROM');

    // Legacy 32.09 is restored to 32.087500, so 150 units round once to 4813.13.
    const restoredUnitCost = 37.75 * (1 - 15 / 100);
    expect(restoredUnitCost).toBe(32.0875);
    expect(Math.round(restoredUnitCost * 150 * 100) / 100).toBe(4813.13);
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
