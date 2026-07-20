import { describe, expect, test } from 'bun:test';

const migrationSql = await Bun.file(
  new URL('../../db/migrations/0116_add_document_descriptions.sql', import.meta.url),
).text();

describe('migration 0116: commercial document descriptions', () => {
  test('adds a nullable free-text description to client and supplier documents', () => {
    for (const table of ['quotes', 'customer_offers', 'sales', 'supplier_quotes']) {
      expect(migrationSql).toContain(`ALTER TABLE "${table}" ADD COLUMN "description" text`);
    }
  });
});
