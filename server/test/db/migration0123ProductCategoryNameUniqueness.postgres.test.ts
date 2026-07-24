import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_PRODUCT_CATEGORY_NAME_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0123_enforce_internal_category_name_uniqueness.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

describe.skipIf(SHOULD_SKIP)(
  'migration 0123: enforce case-insensitive internal category names',
  () => {
    test('preserves legacy rows, moves internal products, and rejects new collisions', async () => {
      const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(`
          CREATE TEMP TABLE "internal_product_categories" (
            "id" varchar(50) PRIMARY KEY,
            "name" varchar(100) NOT NULL,
            "type" varchar(20) NOT NULL,
            "created_at" timestamp,
            "updated_at" timestamp,
            CONSTRAINT "internal_product_categories_name_type_key" UNIQUE ("name", "type")
          ) ON COMMIT DROP;

          CREATE TEMP TABLE "products" (
            "id" varchar(50) PRIMARY KEY,
            "category" varchar(100),
            "type" varchar(20) NOT NULL,
            "supplier_id" varchar(50)
          ) ON COMMIT DROP;

          INSERT INTO "internal_product_categories" ("id", "name", "type", "created_at")
          VALUES
            ('ipc-oldest', 'Hardware', 'goods', '2026-01-01'),
            ('ipc-case-duplicate', 'hardware', 'goods', '2026-01-02'),
            ('ipc-suffix-collision', 'hardware (duplicate 2)', 'goods', '2026-01-03'),
            ('ipc-other-type', 'HARDWARE', 'service', '2026-01-04');

          INSERT INTO "products" ("id", "category", "type", "supplier_id")
          VALUES
            ('product-survivor', 'Hardware', 'goods', NULL),
            ('product-renamed', 'hardware', 'goods', NULL),
            ('supplier-product', 'hardware', 'goods', 'supplier-1');
        `);

        for (const statement of STATEMENTS) await client.query(statement);

        const categories = await client.query<{ id: string; name: string }>(`
          SELECT "id", "name"
          FROM "internal_product_categories"
          ORDER BY "id"
        `);
        expect(categories.rows).toHaveLength(4);
        expect(categories.rows).toContainEqual({
          id: 'ipc-oldest',
          name: 'Hardware',
        });
        expect(categories.rows).toContainEqual({
          id: 'ipc-case-duplicate',
          name: 'hardware (duplicate 3)',
        });

        const products = await client.query<{
          id: string;
          category: string;
          supplier_id: string | null;
        }>(`
          SELECT "id", "category", "supplier_id"
          FROM "products"
          ORDER BY "id"
        `);
        expect(products.rows).toContainEqual({
          id: 'product-renamed',
          category: 'hardware (duplicate 3)',
          supplier_id: null,
        });
        expect(products.rows).toContainEqual({
          id: 'supplier-product',
          category: 'hardware',
          supplier_id: 'supplier-1',
        });

        let duplicateErrorCode: string | undefined;
        try {
          await client.query(`
            INSERT INTO "internal_product_categories" ("id", "name", "type")
            VALUES ('ipc-rejected', 'HARDWARE', 'goods')
          `);
        } catch (error) {
          duplicateErrorCode = (error as { code?: string }).code;
        }
        expect(duplicateErrorCode).toBe('23505');
      } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.end();
      }
    });
  },
);
