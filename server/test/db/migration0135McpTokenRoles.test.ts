import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const migration = readMigrationFile('0135_bind_mcp_tokens_to_roles.sql');

describe('migration 0135: bind MCP tokens to roles', () => {
  test('backfills legacy tokens before enforcing the role constraint', () => {
    const addColumnAt = migration.indexOf('ADD COLUMN IF NOT EXISTS "role_id"');
    const membershipBackfillAt = migration.indexOf('INSERT INTO "user_roles"');
    const backfillAt = migration.indexOf('SET "role_id" = "user"."role"');
    const notNullAt = migration.indexOf('ALTER COLUMN "role_id" SET NOT NULL');
    const foreignKeyAt = migration.indexOf('mcp_tokens_role_id_roles_id_fk');

    expect(addColumnAt).toBeGreaterThanOrEqual(0);
    expect(membershipBackfillAt).toBeGreaterThan(addColumnAt);
    expect(backfillAt).toBeGreaterThan(membershipBackfillAt);
    expect(notNullAt).toBeGreaterThan(backfillAt);
    expect(foreignKeyAt).toBeGreaterThan(notNullAt);
    expect(migration).toContain('AND "token"."role_id" IS NULL');
    expect(migration).toContain('ON DELETE CASCADE');
    expect(migration).toContain('ON CONFLICT ("user_id", "role_id") DO NOTHING');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "set_legacy_mcp_token_role"');
    expect(migration).toContain('NEW."role_id" IS NULL');
    expect(migration).toContain('BEFORE INSERT ON "mcp_tokens"');
  });
});
