import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_SUPPLIER_CODE_UNIQUENESS_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0125_enforce_supplier_code_uniqueness.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

describe.skipIf(SHOULD_SKIP)(
  'migration 0125: enforce case-insensitive supplier code uniqueness',
  () => {
    test('preserves legacy rows and rejects new case-only collisions', async () => {
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
            ('s-oldest', 'Oldest', 'Acme', '2026-01-01'),
            ('s-case-duplicate', 'Case Dup', 'acme', '2026-01-02'),
            ('s-suffix-collision', 'Suffix', 'acme (duplicate 2)', '2026-01-03'),
            ('s-null-a', 'Null A', NULL, '2026-01-04'),
            ('s-null-b', 'Null B', NULL, '2026-01-05');
        `);

        for (const statement of STATEMENTS) await client.query(statement);

        const suppliers = await client.query<{
          id: string;
          supplier_code: string | null;
        }>(`
          SELECT "id", "supplier_code"
          FROM "suppliers"
          ORDER BY "id"
        `);
        expect(suppliers.rows).toHaveLength(5);
        expect(suppliers.rows).toContainEqual({
          id: 's-oldest',
          supplier_code: 'Acme',
        });
        expect(suppliers.rows).toContainEqual({
          id: 's-case-duplicate',
          supplier_code: 'acme (duplicate 3)',
        });
        expect(suppliers.rows).toContainEqual({
          id: 's-suffix-collision',
          supplier_code: 'acme (duplicate 2)',
        });
        expect(suppliers.rows).toContainEqual({
          id: 's-null-a',
          supplier_code: null,
        });
        expect(suppliers.rows).toContainEqual({
          id: 's-null-b',
          supplier_code: null,
        });

        let duplicateErrorCode: string | undefined;
        try {
          await client.query(`
            INSERT INTO "suppliers" ("id", "name", "supplier_code")
            VALUES ('s-new', 'New', 'ACME')
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
