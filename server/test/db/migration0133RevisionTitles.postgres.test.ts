import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_REVISION_TITLES_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0133_add_revision_titles.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

describe.skipIf(SHOULD_SKIP)('migration 0133: add revision titles to legacy rows', () => {
  test('adds nullable bounded titles while preserving every snapshot', async () => {
    const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TEMP TABLE "offer_revisions" (
          "id" varchar(50) PRIMARY KEY,
          "snapshot" jsonb NOT NULL
        ) ON COMMIT DROP;
        CREATE TEMP TABLE "quote_revisions" (
          "id" varchar(50) PRIMARY KEY,
          "snapshot" jsonb NOT NULL
        ) ON COMMIT DROP;
        CREATE TEMP TABLE "supplier_quote_revisions" (
          "id" varchar(50) PRIMARY KEY,
          "snapshot" jsonb NOT NULL
        ) ON COMMIT DROP;

        INSERT INTO "offer_revisions" ("id", "snapshot")
        VALUES ('legacy-offer', '{"marker":"offer"}');
        INSERT INTO "quote_revisions" ("id", "snapshot")
        VALUES ('legacy-quote', '{"marker":"quote"}');
        INSERT INTO "supplier_quote_revisions" ("id", "snapshot")
        VALUES ('legacy-supplier-quote', '{"marker":"supplier-quote"}');
      `);

      for (const statement of STATEMENTS) await client.query(statement);

      const columns = await client.query<{
        tableName: string;
        dataType: string;
        maximumLength: number;
        isNullable: string;
      }>(`
        SELECT
          "table_name" AS "tableName",
          "data_type" AS "dataType",
          "character_maximum_length" AS "maximumLength",
          "is_nullable" AS "isNullable"
        FROM "information_schema"."columns"
        WHERE "table_schema" LIKE 'pg_temp_%'
          AND "table_name" IN (
            'offer_revisions',
            'quote_revisions',
            'supplier_quote_revisions'
          )
          AND "column_name" = 'title'
        ORDER BY "table_name"
      `);
      expect(columns.rows).toEqual([
        {
          tableName: 'offer_revisions',
          dataType: 'character varying',
          maximumLength: 200,
          isNullable: 'YES',
        },
        {
          tableName: 'quote_revisions',
          dataType: 'character varying',
          maximumLength: 200,
          isNullable: 'YES',
        },
        {
          tableName: 'supplier_quote_revisions',
          dataType: 'character varying',
          maximumLength: 200,
          isNullable: 'YES',
        },
      ]);

      const legacyRows = await client.query<{
        tableName: string;
        id: string;
        marker: string;
        title: string | null;
      }>(`
        SELECT 'offer_revisions' AS "tableName", "id", "snapshot" ->> 'marker' AS "marker", "title"
        FROM "offer_revisions"
        UNION ALL
        SELECT 'quote_revisions', "id", "snapshot" ->> 'marker', "title"
        FROM "quote_revisions"
        UNION ALL
        SELECT 'supplier_quote_revisions', "id", "snapshot" ->> 'marker', "title"
        FROM "supplier_quote_revisions"
        ORDER BY "tableName"
      `);
      expect(legacyRows.rows).toEqual([
        {
          tableName: 'offer_revisions',
          id: 'legacy-offer',
          marker: 'offer',
          title: null,
        },
        {
          tableName: 'quote_revisions',
          id: 'legacy-quote',
          marker: 'quote',
          title: null,
        },
        {
          tableName: 'supplier_quote_revisions',
          id: 'legacy-supplier-quote',
          marker: 'supplier-quote',
          title: null,
        },
      ]);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
