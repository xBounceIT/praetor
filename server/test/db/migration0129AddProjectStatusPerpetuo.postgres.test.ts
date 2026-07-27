import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_PROJECT_STATUS_PERPETUO_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0129_add_project_status_perpetuo.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

describe.skipIf(SHOULD_SKIP)('migration 0129: widen projects_status_check for perpetuo', () => {
  test('preserves legacy statuses and accepts perpetuo after upgrade', async () => {
    const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TEMP TABLE "projects" (
          "id" varchar(50) PRIMARY KEY,
          "status" varchar(20) NOT NULL DEFAULT 'da_fare',
          CONSTRAINT "projects_status_check"
            CHECK ("status" IN ('da_fare', 'in_corso', 'in_pausa', 'terminato'))
        ) ON COMMIT DROP;

        INSERT INTO "projects" ("id", "status")
        VALUES
          ('p-da-fare', 'da_fare'),
          ('p-in-corso', 'in_corso'),
          ('p-in-pausa', 'in_pausa'),
          ('p-terminato', 'terminato');
      `);

      for (const statement of STATEMENTS) await client.query(statement);

      const statuses = await client.query<{ id: string; status: string }>(`
        SELECT "id", "status"
        FROM "projects"
        ORDER BY "id"
      `);
      expect(statuses.rows).toEqual([
        { id: 'p-da-fare', status: 'da_fare' },
        { id: 'p-in-corso', status: 'in_corso' },
        { id: 'p-in-pausa', status: 'in_pausa' },
        { id: 'p-terminato', status: 'terminato' },
      ]);

      await client.query(`
        INSERT INTO "projects" ("id", "status")
        VALUES ('p-perpetuo', 'perpetuo')
      `);

      let invalidErrorCode: string | undefined;
      try {
        await client.query(`
          INSERT INTO "projects" ("id", "status")
          VALUES ('p-invalid', 'unknown')
        `);
      } catch (error) {
        invalidErrorCode = (error as { code?: string }).code;
      }
      expect(invalidErrorCode).toBe('23514');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
