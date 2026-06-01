import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

describe('migration 0063: add project_rules', () => {
  const MIGRATION = readMigrationFile('0063_add_project_rules.sql');

  test('creates the project_rules table with core condition/action columns', () => {
    expect(MIGRATION).toContain('CREATE TABLE "project_rules"');
    for (const column of [
      '"project_id"',
      '"field"',
      '"operator"',
      '"value"',
      '"action_type"',
      '"action_config"',
      '"condition_met"',
      '"last_triggered_at"',
    ]) {
      expect(MIGRATION).toContain(column);
    }
  });

  test('uses non-null JSONB action config and project/user foreign keys', () => {
    expect(MIGRATION).toContain(
      `"action_config" jsonb DEFAULT '{"recipientUserIds":[],"recipientRoleIds":[]}'::jsonb NOT NULL`,
    );
    expect(MIGRATION).toContain('REFERENCES "public"."projects"("id") ON DELETE cascade');
    expect(MIGRATION).toContain('REFERENCES "public"."users"("id") ON DELETE set null');
  });
});
