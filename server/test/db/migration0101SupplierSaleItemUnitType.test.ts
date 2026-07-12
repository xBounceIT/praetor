import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(
    new URL('../../db/migrations/0101_add_supplier_sale_item_unit_type.sql', import.meta.url),
  ).text();

const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

const readSeed = async () => Bun.file(new URL('../../db/seed.sql', import.meta.url)).text();

const getInsertSelectBlock = (sql: string, table: string) => {
  const match = sql.match(
    new RegExp(
      `INSERT INTO ${table}\\s*\\(([\\s\\S]*?)\\)\\s*SELECT([\\s\\S]*?)FROM\\s*\\([\\s\\S]*?\\) AS v\\(([^)]*)\\)`,
    ),
  );
  if (!match) throw new Error(`Could not parse INSERT ... SELECT block for ${table}`);
  return {
    insertColumns: match[1].split(',').map((column) => column.trim()),
    selectExpressions: match[2].split(',').map((expression) => expression.trim()),
    aliasColumns: new Set(match[3].split(',').map((column) => column.trim())),
  };
};

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
    const supplierSaleItems = getInsertSelectBlock(sql, 'supplier_sale_items');

    expect(supplierSaleItems.insertColumns).toContain('unit_type');
    expect(supplierSaleItems.selectExpressions).toContain('v.unit_type');
    expect(supplierSaleItems.aliasColumns).toContain('unit_type');
    expect(supplierSaleItems.selectExpressions).toHaveLength(
      supplierSaleItems.insertColumns.length,
    );
    expect(sql).toContain("'dm_ssi_01', pg_temp.demo_document_code('supplier_order', 1)");
    expect(sql).toContain("4.00, 'unit', 960.00");
    expect(sql).toContain('unit_type = EXCLUDED.unit_type');
  });

  test('every seeded supplier line v.* reference exists in its VALUES alias', async () => {
    const sql = await readSeed();

    for (const table of ['supplier_quote_items', 'supplier_sale_items']) {
      const block = getInsertSelectBlock(sql, table);
      const referencedAliases = block.selectExpressions
        .map((expression) => expression.match(/^v\.([a-z_]+)$/)?.[1])
        .filter((column): column is string => Boolean(column));

      expect(
        referencedAliases.filter((column) => !block.aliasColumns.has(column)),
        `${table} SELECT references undeclared v.* aliases`,
      ).toEqual([]);
    }
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
