import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_QUOTE_COMMUNICATION_CHANNEL_NAME_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0127_enforce_quote_communication_channel_name_uniqueness.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

describe.skipIf(SHOULD_SKIP)(
  'migration 0127: enforce case-insensitive quote communication channel names',
  () => {
    test('preserves legacy rows and rejects new case-only collisions', async () => {
      const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(`
          CREATE TEMP TABLE "quote_communication_channels" (
            "id" varchar(50) PRIMARY KEY,
            "name" varchar(100) NOT NULL,
            "icon" varchar(50) NOT NULL DEFAULT 'comments',
            "is_default" boolean NOT NULL DEFAULT false,
            "created_at" timestamp,
            "updated_at" timestamp,
            CONSTRAINT "quote_communication_channels_name_unique" UNIQUE("name")
          ) ON COMMIT DROP;

          INSERT INTO "quote_communication_channels" ("id", "name", "created_at")
          VALUES
            ('qcc-oldest', 'Slack', '2026-01-01'),
            ('qcc-case-duplicate', 'slack', '2026-01-02'),
            ('qcc-suffix-collision', 'slack (duplicate 2)', '2026-01-03');
        `);

        for (const statement of STATEMENTS) await client.query(statement);

        const channels = await client.query<{ id: string; name: string }>(`
          SELECT "id", "name"
          FROM "quote_communication_channels"
          ORDER BY "id"
        `);
        expect(channels.rows).toHaveLength(3);
        expect(channels.rows).toContainEqual({
          id: 'qcc-oldest',
          name: 'Slack',
        });
        expect(channels.rows).toContainEqual({
          id: 'qcc-case-duplicate',
          name: 'slack (duplicate 3)',
        });
        expect(channels.rows).toContainEqual({
          id: 'qcc-suffix-collision',
          name: 'slack (duplicate 2)',
        });

        let duplicateErrorCode: string | undefined;
        try {
          await client.query(`
            INSERT INTO "quote_communication_channels" ("id", "name")
            VALUES ('qcc-new', 'SLACK')
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
