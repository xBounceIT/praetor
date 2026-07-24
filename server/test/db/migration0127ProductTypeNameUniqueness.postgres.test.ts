import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_PRODUCT_TYPE_NAME_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0127_enforce_product_type_name_uniqueness.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

describe.skipIf(SHOULD_SKIP)('migration 0127: enforce case-insensitive product type names', () => {
  test('preserves legacy rows, moves references, and rejects new collisions', async () => {
    const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`
          CREATE TEMP TABLE "product_types" (
            "id" varchar(50) PRIMARY KEY,
            "name" varchar(50) NOT NULL,
            "cost_unit" varchar(20) NOT NULL DEFAULT 'unit',
            "created_at" timestamp,
            "updated_at" timestamp,
            CONSTRAINT "product_types_name_unique" UNIQUE ("name")
          ) ON COMMIT DROP;

          CREATE TEMP TABLE "internal_product_categories" (
            "id" varchar(50) PRIMARY KEY,
            "name" varchar(100) NOT NULL,
            "type" varchar(20) NOT NULL,
            "created_at" timestamp,
            "updated_at" timestamp
          ) ON COMMIT DROP;

          CREATE TEMP TABLE "products" (
            "id" varchar(50) PRIMARY KEY,
            "type" varchar(20) NOT NULL DEFAULT 'item',
            "supplier_id" varchar(50)
          ) ON COMMIT DROP;

          INSERT INTO "product_types" ("id", "name", "created_at")
          VALUES
            ('pt-oldest', 'Service', '2026-01-01'),
            ('pt-case-duplicate', 'service', '2026-01-02'),
            ('pt-suffix-collision', 'service (duplicate 2)', '2026-01-03'),
            ('pt-other', 'Supply', '2026-01-04');

          INSERT INTO "internal_product_categories" ("id", "name", "type", "created_at")
          VALUES
            ('ipc-survivor', 'Consulting', 'Service', '2026-01-01'),
            ('ipc-renamed', 'Support', 'service', '2026-01-02');

          INSERT INTO "products" ("id", "type", "supplier_id")
          VALUES
            ('product-survivor', 'Service', NULL),
            ('product-renamed', 'service', NULL),
            ('supplier-product', 'service', 'supplier-1');
        `);

      for (const statement of STATEMENTS) await client.query(statement);

      const types = await client.query<{ id: string; name: string }>(`
          SELECT "id", "name"
          FROM "product_types"
          ORDER BY "id"
        `);
      expect(types.rows).toHaveLength(4);
      expect(types.rows).toContainEqual({
        id: 'pt-oldest',
        name: 'Service',
      });
      expect(types.rows).toContainEqual({
        id: 'pt-case-duplicate',
        name: 'service (duplicate 3)',
      });
      expect(types.rows).toContainEqual({
        id: 'pt-suffix-collision',
        name: 'service (duplicate 2)',
      });

      const categories = await client.query<{ id: string; type: string }>(`
          SELECT "id", "type"
          FROM "internal_product_categories"
          ORDER BY "id"
        `);
      expect(categories.rows).toContainEqual({
        id: 'ipc-survivor',
        type: 'Service',
      });
      expect(categories.rows).toContainEqual({
        id: 'ipc-renamed',
        type: 'service (duplicate 3)',
      });

      const products = await client.query<{
        id: string;
        type: string;
        supplier_id: string | null;
      }>(`
          SELECT "id", "type", "supplier_id"
          FROM "products"
          ORDER BY "id"
        `);
      expect(products.rows).toContainEqual({
        id: 'product-survivor',
        type: 'Service',
        supplier_id: null,
      });
      expect(products.rows).toContainEqual({
        id: 'product-renamed',
        type: 'service (duplicate 3)',
        supplier_id: null,
      });
      expect(products.rows).toContainEqual({
        id: 'supplier-product',
        type: 'service (duplicate 3)',
        supplier_id: 'supplier-1',
      });

      let duplicateErrorCode: string | undefined;
      try {
        await client.query(`
            INSERT INTO "product_types" ("id", "name")
            VALUES ('pt-rejected', 'SERVICE')
          `);
      } catch (error) {
        duplicateErrorCode = (error as { code?: string }).code;
      }
      expect(duplicateErrorCode).toBe('23505');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
