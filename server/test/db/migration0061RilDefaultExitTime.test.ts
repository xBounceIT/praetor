import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0061_add_ril_default_exit_time.sql');

describe('migration 0061: adds RIL default exit time', () => {
  test('adds the RIL default exit time column with default value', () => {
    expect(MIGRATION).toContain('"ril_default_exit_time" varchar(5) DEFAULT \'18:00\'');
  });

  test('adds server-side HH:mm validation for the exit time', () => {
    expect(MIGRATION).toContain('general_settings_ril_default_exit_time_check');
    expect(MIGRATION).toContain('"ril_default_exit_time" ~');
  });
});
