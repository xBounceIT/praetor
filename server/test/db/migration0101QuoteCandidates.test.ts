import { describe, expect, test } from 'bun:test';

const migrationSql = await Bun.file(
  new URL('../../db/migrations/0101_quote_candidates.sql', import.meta.url),
).text();

describe('migration 0101 quote candidates', () => {
  test('backfills one candidate per existing quote without changing the document code', () => {
    expect(migrationSql).toContain("'Variante A'");
    expect(migrationSql).toContain("THEN 'selected' ELSE 'active' END");
  });

  test('reattaches existing items and offers before enforcing foreign keys', () => {
    const itemBackfill = migrationSql.indexOf(
      'UPDATE "quote_items" SET "candidate_id" = "quote_id"',
    );
    const itemNotNull = migrationSql.indexOf(
      'ALTER TABLE "quote_items" ALTER COLUMN "candidate_id" SET NOT NULL',
    );
    expect(itemBackfill).toBeGreaterThan(-1);
    expect(itemNotNull).toBeGreaterThan(itemBackfill);
    expect(migrationSql).toContain(
      'UPDATE "customer_offers" SET "linked_quote_candidate_id" = "linked_quote_id"',
    );
  });

  test('enforces unique names and one selected candidate per quote', () => {
    expect(migrationSql).toContain('CREATE UNIQUE INDEX "idx_quote_candidates_quote_name_unique"');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX "idx_quote_candidates_one_selected"');
  });
});
