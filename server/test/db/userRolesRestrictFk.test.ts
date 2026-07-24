import { describe, expect, test } from 'bun:test';
import { readMigrationFile, readSchemaFile } from '../helpers/schemaFiles.ts';

// Regression: user_roles.role_id must be ON DELETE RESTRICT (not CASCADE) so deleting a role
// cannot silently destroy secondary assignments that raced in after an in-use precheck.
// Asserted at schema + migration levels (same pattern as migration 0033 / invoicesSchema.test.ts).

const MIGRATION = readMigrationFile('0124_restrict_user_roles_role_id_fk.sql');
const SCHEMA = readSchemaFile('userRoles.ts');

describe('migration 0124: user_roles.role_id uses ON DELETE RESTRICT', () => {
  test('migration installs RESTRICT on user_roles.role_id → roles(id)', () => {
    expect(MIGRATION).toContain('user_roles_role_id_roles_id_fk');
    expect(MIGRATION).toMatch(
      /ADD CONSTRAINT "user_roles_role_id_roles_id_fk"[\s\S]*?FOREIGN KEY \("role_id"\)[\s\S]*?ON DELETE RESTRICT/i,
    );
    expect(MIGRATION).toContain(
      'ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_id_roles_id_fk"',
    );
  });
});

describe('schema definition matches the migration intent', () => {
  test("userRoles.ts declares roleId FK with onDelete: 'restrict'", () => {
    expect(SCHEMA).toMatch(
      /roleId:[\s\S]*?\.references\(\(\) => roles\.id,\s*\{\s*onDelete:\s*'restrict'\s*\}\)/,
    );
    expect(SCHEMA).not.toMatch(
      /roleId:[\s\S]*?\.references\(\(\) => roles\.id,\s*\{\s*onDelete:\s*'cascade'/,
    );
  });
});
