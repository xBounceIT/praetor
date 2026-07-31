import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_MCP_TOKEN_ROLE_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0135_bind_mcp_tokens_to_roles.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

describe.skipIf(SHOULD_SKIP)('migration 0135: bind MCP tokens to legacy roles', () => {
  test('backfills the primary role, enforces integrity, and is retry-safe', async () => {
    const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TEMP TABLE "roles" (
          "id" varchar(50) PRIMARY KEY
        ) ON COMMIT DROP;
        CREATE TEMP TABLE "users" (
          "id" varchar(50) PRIMARY KEY,
          "role" varchar(50) NOT NULL
        ) ON COMMIT DROP;
        CREATE TEMP TABLE "mcp_tokens" (
          "id" varchar(50) PRIMARY KEY,
          "user_id" varchar(50) NOT NULL
        ) ON COMMIT DROP;
        CREATE TEMP TABLE "user_roles" (
          "user_id" varchar(50) NOT NULL,
          "role_id" varchar(50) NOT NULL,
          PRIMARY KEY ("user_id", "role_id")
        ) ON COMMIT DROP;

        INSERT INTO "roles" ("id") VALUES ('user'), ('top_manager');
        INSERT INTO "users" ("id", "role") VALUES ('legacy-user', 'user');
        INSERT INTO "mcp_tokens" ("id", "user_id") VALUES ('legacy-token', 'legacy-user');
      `);

      for (const statement of STATEMENTS) await client.query(statement);
      for (const statement of STATEMENTS) await client.query(statement);

      const upgraded = await client.query<{ id: string; roleId: string }>(`
        SELECT "id", "role_id" AS "roleId"
        FROM "mcp_tokens"
        WHERE "id" = 'legacy-token'
      `);
      expect(upgraded.rows).toEqual([{ id: 'legacy-token', roleId: 'user' }]);
      const restoredMembership = await client.query<{ roleId: string; userId: string }>(`
        SELECT "user_id" AS "userId", "role_id" AS "roleId"
        FROM "user_roles"
        WHERE "user_id" = 'legacy-user'
      `);
      expect(restoredMembership.rows).toEqual([{ userId: 'legacy-user', roleId: 'user' }]);

      await client.query(
        `INSERT INTO "mcp_tokens" ("id", "user_id") VALUES ('old-writer-token', 'legacy-user')`,
      );
      const oldWriterToken = await client.query<{ roleId: string }>(`
        SELECT "role_id" AS "roleId"
        FROM "mcp_tokens"
        WHERE "id" = 'old-writer-token'
      `);
      expect(oldWriterToken.rows).toEqual([{ roleId: 'user' }]);

      await client.query('SAVEPOINT before_invalid_role');
      await expect(
        client.query(
          `INSERT INTO "mcp_tokens" ("id", "user_id", "role_id") VALUES ('bad-role', 'legacy-user', 'missing')`,
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT before_invalid_role');

      await client.query(`DELETE FROM "roles" WHERE "id" = 'user'`);
      const remaining = await client.query<{ count: number }>(`
        SELECT COUNT(*)::int AS "count"
        FROM "mcp_tokens"
        WHERE "id" IN ('legacy-token', 'old-writer-token')
      `);
      expect(remaining.rows[0]?.count).toBe(0);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
