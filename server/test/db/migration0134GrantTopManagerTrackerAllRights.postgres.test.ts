import { describe, expect, test } from 'bun:test';
import pg, { type PoolClient } from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_TOP_MANAGER_TRACKER_PERMISSIONS_MIGRATION_TEST !== '1';
const STATEMENTS = readMigrationFile('0134_grant_top_manager_tracker_all_rights.sql')
  .split('--> statement-breakpoint')
  .filter((statement) => statement.trim().length > 0);

const EXPECTED_PERMISSIONS = [
  'timesheets.tracker_all.create',
  'timesheets.tracker_all.delete',
  'timesheets.tracker_all.update',
  'timesheets.tracker_all.view',
];

const applyMigration = async (client: PoolClient) => {
  for (const statement of STATEMENTS) await client.query(statement);
};

describe.skipIf(SHOULD_SKIP)(
  'migration 0134: grant global tracker rights on legacy PostgreSQL data',
  () => {
    test('upgrades a view-only top_manager without widening other roles and remains retry-safe', async () => {
      const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(`
          CREATE TEMP TABLE "roles" (
            "id" varchar(50) PRIMARY KEY
          ) ON COMMIT DROP;
          CREATE TEMP TABLE "role_permissions" (
            "role_id" varchar(50) NOT NULL REFERENCES "roles"("id"),
            "permission" varchar(100) NOT NULL,
            PRIMARY KEY ("role_id", "permission")
          ) ON COMMIT DROP;

          INSERT INTO "roles" ("id")
          VALUES ('top_manager'), ('manager'), ('custom_role');
          INSERT INTO "role_permissions" ("role_id", "permission")
          VALUES
            ('top_manager', 'timesheets.tracker_all.view'),
            ('manager', 'timesheets.tracker_all.view'),
            ('custom_role', 'timesheets.tracker_all.create');
        `);

        await applyMigration(client);
        await applyMigration(client);

        const topManagerPermissions = await client.query<{ permission: string }>(`
          SELECT "permission"
          FROM "role_permissions"
          WHERE "role_id" = 'top_manager'
          ORDER BY "permission"
        `);
        expect(topManagerPermissions.rows.map(({ permission }) => permission)).toEqual(
          EXPECTED_PERMISSIONS,
        );

        const otherRolePermissions = await client.query<{
          roleId: string;
          permission: string;
        }>(`
          SELECT "role_id" AS "roleId", "permission"
          FROM "role_permissions"
          WHERE "role_id" <> 'top_manager'
          ORDER BY "role_id", "permission"
        `);
        expect(otherRolePermissions.rows).toEqual([
          {
            roleId: 'custom_role',
            permission: 'timesheets.tracker_all.create',
          },
          {
            roleId: 'manager',
            permission: 'timesheets.tracker_all.view',
          },
        ]);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        await pool.end();
      }
    });
  },
);
