import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0059_add_ril_general_settings.sql');

describe('migration 0059: adds RIL defaults and grants RIL view access', () => {
  test('adds the three RIL general settings columns', () => {
    expect(MIGRATION).toContain('"ril_company_name" varchar(255) DEFAULT \'\'');
    expect(MIGRATION).toContain('"ril_default_start_time" varchar(5) DEFAULT \'09:00\'');
    expect(MIGRATION).toContain('"ril_lunch_break_minutes" integer DEFAULT 60');
  });

  test('adds server-side validation constraints for generated RIL values', () => {
    expect(MIGRATION).toContain('general_settings_ril_default_start_time_check');
    expect(MIGRATION).toContain('general_settings_ril_lunch_break_minutes_check');
  });

  test('grants timesheets.ril.view to roles that already had tracker view', () => {
    expect(MIGRATION).toMatch(/SELECT role_id,\s*'timesheets\.ril\.view'/i);
    expect(MIGRATION).toMatch(/WHERE permission = 'timesheets\.tracker\.view'/i);
  });

  test('keeps the permission grant idempotent', () => {
    expect(MIGRATION).toMatch(/ON CONFLICT DO NOTHING/i);
  });
});
