import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_SUPPLIER_CODE_UNIQUENESS_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0125_enforce_supplier_code_uniqueness.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

describe.skipIf(SHOULD_SKIP)('migration 0125: enforce case-insensitive supplier codes', () => {
  test('renames legacy duplicates and rejects new collisions', async () => {
    const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`
          CREATE TEMP TABLE "suppliers" (
            "id" varchar(50) PRIMARY KEY,
            "name" varchar(255) NOT NULL,
            "supplier_code" varchar(50),
            "created_at" timestamp
          ) ON COMMIT DROP;

          INSERT INTO "suppliers" ("id", "name", "supplier_code", "created_at")
          VALUES
            ('s-oldest', 'Oldest', 'ACM', '2026-01-01'),
            ('s-case-duplicate', 'Case Dup', 'acm', '2026-01-02'),
            ('s-exact-duplicate', 'Exact Dup', 'ACM', '2026-01-03'),
            ('s-other', 'Other', 'ZZZ', '2026-01-04'),
            ('s-null', 'No Code', NULL, '2026-01-05');
        `);

      for (const statement of STATEMENTS) {
        await client.query(statement);
      }

      const { rows } = await client.query<{
        id: string;
        supplier_code: string | null;
      }>('SELECT "id", "supplier_code" FROM "suppliers" ORDER BY "id"');

      const byId = Object.fromEntries(rows.map((row) => [row.id, row.supplier_code]));
      expect(byId['s-oldest']).toBe('ACM');
      expect(byId['s-case-duplicate']).toBe('acm (duplicate 2)');
      expect(byId['s-exact-duplicate']).toBe('ACM (duplicate 3)');
      expect(byId['s-other']).toBe('ZZZ');
      expect(byId['s-null']).toBeNull();

      await expect(
        client.query(
          `INSERT INTO "suppliers" ("id", "name", "supplier_code") VALUES ('s-new', 'New', 'acm')`,
        ),
      ).rejects.toMatchObject({ code: '23505' });

      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  });
});
