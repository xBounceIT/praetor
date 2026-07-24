import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_RESALE_CATEGORY_NAME_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0122_enforce_resale_category_name_uniqueness.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

describe.skipIf(SHOULD_SKIP)(
  'migration 0122: enforce case-insensitive resale category names',
  () => {
    test('preserves legacy rows and rejects new case-only collisions', async () => {
      const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(`
          CREATE TEMP TABLE "resale_categories" (
            "id" varchar(50) PRIMARY KEY,
            "name" varchar(100) NOT NULL,
            "created_at" timestamp,
            "updated_at" timestamp
          ) ON COMMIT DROP;
          CREATE UNIQUE INDEX "idx_resale_categories_name_unique"
            ON "resale_categories" ("name");

          INSERT INTO "resale_categories" ("id", "name", "created_at")
          VALUES
            ('rvc-oldest', 'Hardware', '2026-01-01'),
            ('rvc-case-duplicate', 'hardware', '2026-01-02'),
            ('rvc-suffix-collision', 'hardware (duplicate 2)', '2026-01-03');
        `);

        for (const statement of STATEMENTS) await client.query(statement);

        const categories = await client.query<{ id: string; name: string }>(`
          SELECT "id", "name"
          FROM "resale_categories"
          ORDER BY "id"
        `);
        expect(categories.rows).toHaveLength(3);
        expect(categories.rows).toContainEqual({
          id: 'rvc-oldest',
          name: 'Hardware',
        });
        expect(categories.rows).toContainEqual({
          id: 'rvc-case-duplicate',
          name: 'hardware (duplicate 3)',
        });
        expect(categories.rows).toContainEqual({
          id: 'rvc-suffix-collision',
          name: 'hardware (duplicate 2)',
        });

        let duplicateErrorCode: string | undefined;
        try {
          await client.query(`
            INSERT INTO "resale_categories" ("id", "name")
            VALUES ('rvc-new', 'HARDWARE')
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
  },
);
