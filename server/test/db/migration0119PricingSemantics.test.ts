import { describe, expect, test } from 'bun:test';

const migrationSql = await Bun.file(
  new URL('../../db/migrations/0119_preserve_historical_pricing_semantics.sql', import.meta.url),
).text();
const journal = (await Bun.file(
  new URL('../../db/migrations/meta/_journal.json', import.meta.url),
).json()) as { entries: Array<{ idx: number; tag: string }> };

const itemTables = [
  'customer_offer_items',
  'invoice_items',
  'quote_items',
  'sale_items',
  'supplier_invoice_items',
  'supplier_quote_items',
  'supplier_sale_items',
];

describe('migration 0119 historical pricing semantics', () => {
  test('marks existing lines and previous-version writers with legacy semantics', () => {
    for (const table of itemTables) expect(migrationSql).toContain(`'${table}'`);
    expect(migrationSql).toContain(
      'ADD COLUMN IF NOT EXISTS pricing_semantics_version integer DEFAULT 1 NOT NULL',
    );
    expect(migrationSql).not.toContain('ALTER COLUMN pricing_semantics_version SET DEFAULT 2');
  });

  test('does not rewrite canonical durations or historical prices', () => {
    expect(migrationSql).not.toMatch(/UPDATE\s+(quote_items|sale_items|invoice_items)/i);
    expect(migrationSql).not.toContain('duration_months =');
    expect(migrationSql).not.toContain('product_cost =');
    expect(migrationSql).not.toContain('unit_price =');
  });

  test('is retry-safe and constrains the marker to supported versions', () => {
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS');
    expect(migrationSql).toContain('IF NOT EXISTS (');
    expect(migrationSql).toContain("conrelid = to_regclass(format('public.%I', target_table))");
    expect(migrationSql).toContain('pricing_semantics_version IN (1, 2)');
    expect(migrationSql).toContain('NOT VALID');
    expect(migrationSql).not.toContain('VALIDATE CONSTRAINT');
  });

  test('is registered after migration 0118', () => {
    const migrationIndex = journal.entries.findIndex(
      ({ tag }) => tag === '0119_preserve_historical_pricing_semantics',
    );
    expect(journal.entries[migrationIndex - 1]).toEqual(expect.objectContaining({ idx: 118 }));
    expect(journal.entries[migrationIndex]).toEqual(
      expect.objectContaining({ idx: 119, tag: '0119_preserve_historical_pricing_semantics' }),
    );
  });
});
