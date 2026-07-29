import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_PROJECT_RULE_PERIODIC_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0131_extend_project_rules_periodic.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);
const TRIGGER_STATEMENTS = readMigrationFile('0132_project_rules_config_version_trigger.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

describe.skipIf(SHOULD_SKIP)(
  'migration 0131: extend legacy project rules with periodic evaluation',
  () => {
    test('preserves legacy rows, widens text values, and applies safe defaults', async () => {
      const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(`
          CREATE TEMP TABLE "project_rules" (
            "id" varchar(50) PRIMARY KEY,
            "name" varchar(255) NOT NULL,
            "field" varchar(50) NOT NULL,
            "operator" varchar(30) NOT NULL,
            "value" varchar(255) NOT NULL,
            "condition_logic" varchar(10) NOT NULL DEFAULT 'and',
            "conditions" jsonb NOT NULL DEFAULT '[]'::jsonb,
            "action_type" varchar(30) NOT NULL DEFAULT 'notify',
            "action_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
            "is_enabled" boolean NOT NULL DEFAULT true,
            "condition_met" boolean NOT NULL DEFAULT false,
            "last_triggered_at" timestamp
          ) ON COMMIT DROP;

          INSERT INTO "project_rules" ("id", "name", "field", "operator", "value")
          VALUES ('legacy-rule', 'Legacy rule', 'revenue', 'gte', repeat('x', 255));
        `);

        for (const statement of STATEMENTS) await client.query(statement);
        for (const statement of TRIGGER_STATEMENTS) await client.query(statement);

        const upgraded = await client.query<{
          id: string;
          valueLength: number;
          valueType: string;
          evaluationMode: string;
          schedule: {
            frequency: string;
            timeZone: string;
            userIds: string[];
            taskIds: string[];
          };
          lastEvaluatedPeriod: string | null;
          configVersion: number;
        }>(`
          SELECT
            "id",
            length("value")::int AS "valueLength",
            pg_typeof("value")::text AS "valueType",
            "evaluation_mode" AS "evaluationMode",
            "schedule_config" AS "schedule",
            "last_evaluated_period" AS "lastEvaluatedPeriod",
            "config_version" AS "configVersion"
          FROM "project_rules"
          WHERE "id" = 'legacy-rule'
        `);
        expect(upgraded.rows[0]).toEqual({
          id: 'legacy-rule',
          valueLength: 255,
          valueType: 'text',
          evaluationMode: 'continuous',
          schedule: {
            frequency: 'monthly',
            timeZone: 'UTC',
            userIds: [],
            taskIds: [],
          },
          lastEvaluatedPeriod: null,
          configVersion: 0,
        });

        await client.query(
          `UPDATE "project_rules" SET "value" = repeat('y', 10000) WHERE "id" = 'legacy-rule'`,
        );
        const widened = await client.query<{ valueLength: number }>(`
          SELECT length("value")::int AS "valueLength"
          FROM "project_rules"
          WHERE "id" = 'legacy-rule'
        `);
        expect(widened.rows[0]?.valueLength).toBe(10_000);

        await client.query(`
          UPDATE "project_rules"
          SET "condition_met" = true, "last_triggered_at" = CURRENT_TIMESTAMP
          WHERE "id" = 'legacy-rule'
        `);
        const afterEvaluatorWrite = await client.query<{ configVersion: number }>(`
          SELECT "config_version" AS "configVersion"
          FROM "project_rules"
          WHERE "id" = 'legacy-rule'
        `);
        expect(afterEvaluatorWrite.rows[0]?.configVersion).toBe(1);

        await client.query(`
          UPDATE "project_rules"
          SET "name" = 'Updated by previous release'
          WHERE "id" = 'legacy-rule'
        `);
        const afterLegacyWriter = await client.query<{ configVersion: number }>(`
          SELECT "config_version" AS "configVersion"
          FROM "project_rules"
          WHERE "id" = 'legacy-rule'
        `);
        expect(afterLegacyWriter.rows[0]?.configVersion).toBe(2);

        await client.query(`
          UPDATE "project_rules"
          SET
            "condition_met" = true,
            "last_triggered_at" = CURRENT_TIMESTAMP,
            "last_evaluated_period" = 'monthly:UTC:2026-05-01:2026-06-01'
          WHERE "id" = 'legacy-rule'
        `);
        await client.query(`
          UPDATE "project_rules"
          SET "operator" = 'lte'
          WHERE "id" = 'legacy-rule'
        `);
        const afterConditionChange = await client.query<{
          configVersion: number;
          conditionMet: boolean;
          lastTriggeredAt: Date | null;
          lastEvaluatedPeriod: string | null;
        }>(`
          SELECT
            "config_version" AS "configVersion",
            "condition_met" AS "conditionMet",
            "last_triggered_at" AS "lastTriggeredAt",
            "last_evaluated_period" AS "lastEvaluatedPeriod"
          FROM "project_rules"
          WHERE "id" = 'legacy-rule'
        `);
        expect(afterConditionChange.rows[0]).toEqual({
          configVersion: 3,
          conditionMet: false,
          lastTriggeredAt: null,
          lastEvaluatedPeriod: null,
        });

        await client.query(`
          UPDATE "project_rules" SET "is_enabled" = false WHERE "id" = 'legacy-rule';
          UPDATE "project_rules"
          SET
            "condition_met" = true,
            "last_triggered_at" = CURRENT_TIMESTAMP,
            "last_evaluated_period" = 'monthly:UTC:2026-06-01:2026-07-01'
          WHERE "id" = 'legacy-rule';
          UPDATE "project_rules" SET "is_enabled" = true WHERE "id" = 'legacy-rule';
        `);
        const afterReEnable = await client.query<{
          configVersion: number;
          conditionMet: boolean;
          lastTriggeredAt: Date | null;
          lastEvaluatedPeriod: string | null;
        }>(`
          SELECT
            "config_version" AS "configVersion",
            "condition_met" AS "conditionMet",
            "last_triggered_at" AS "lastTriggeredAt",
            "last_evaluated_period" AS "lastEvaluatedPeriod"
          FROM "project_rules"
          WHERE "id" = 'legacy-rule'
        `);
        expect(afterReEnable.rows[0]).toEqual({
          configVersion: 5,
          conditionMet: false,
          lastTriggeredAt: null,
          lastEvaluatedPeriod: null,
        });

        const indexes = await client.query<{ count: number }>(`
          SELECT COUNT(*)::int AS "count"
          FROM "pg_indexes"
          WHERE "schemaname" LIKE 'pg_temp_%'
            AND "indexname" = 'idx_project_rules_evaluation_mode'
        `);
        expect(indexes.rows[0]?.count).toBe(1);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        await pool.end();
      }
    });
  },
);
