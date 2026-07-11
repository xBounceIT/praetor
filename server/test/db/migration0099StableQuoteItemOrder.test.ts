import { describe, expect, test } from 'bun:test';

const migrationSql = await Bun.file(
  new URL('../../db/migrations/0099_stable_client_quote_item_order.sql', import.meta.url),
).text();
const normalizedSql = migrationSql.replace(/\s+/g, ' ');

describe('migration 0099 stable client quote item order', () => {
  test('adds a non-null position column with a legacy-safe default', () => {
    expect(normalizedSql).toContain(
      'ALTER TABLE "quote_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL',
    );
  });

  test('backfills a deterministic zero-based position within each quote', () => {
    expect(normalizedSql).toMatch(
      /ROW_NUMBER\(\) OVER \( PARTITION BY "quote_id" ORDER BY "created_at" ASC NULLS LAST, "id" ASC \) - 1 AS "position"/,
    );
    expect(normalizedSql).toContain(
      'UPDATE "quote_items" AS qi SET "position" = ranked_items."position" FROM ranked_items WHERE qi."id" = ranked_items."id"',
    );
  });

  test('indexes the persisted per-quote order', () => {
    expect(normalizedSql).toContain(
      'CREATE INDEX "idx_quote_items_quote_position" ON "quote_items" USING btree ("quote_id","position")',
    );
  });
});
