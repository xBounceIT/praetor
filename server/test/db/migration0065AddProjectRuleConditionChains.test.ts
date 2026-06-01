import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

describe('migration 0065: add project rule condition chains', () => {
  const MIGRATION = readMigrationFile('0065_add_project_rule_condition_chains.sql');

  test('adds condition logic and condition list columns', () => {
    expect(MIGRATION).toContain('"condition_logic" varchar(10) DEFAULT \'and\' NOT NULL');
    expect(MIGRATION).toContain('"conditions" jsonb DEFAULT \'[]\'::jsonb NOT NULL');
  });
});
