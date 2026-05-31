import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0060_add_ril_option_settings.sql');

describe('migration 0060: adds configurable RIL option settings', () => {
  test('adds RIL note and transfer option columns with defaults', () => {
    expect(MIGRATION).toContain('"ril_note_options" jsonb DEFAULT');
    expect(MIGRATION).toContain('"ril_transfer_options" jsonb DEFAULT');
    expect(MIGRATION).toContain('"value":"P"');
    expect(MIGRATION).toContain('"In sede"');
    expect(MIGRATION).toContain('"Telelavoro"');
  });

  test('constrains both option columns to JSON arrays', () => {
    expect(MIGRATION).toContain('general_settings_ril_note_options_array_check');
    expect(MIGRATION).toContain('general_settings_ril_transfer_options_array_check');
    expect(MIGRATION).toContain('jsonb_typeof("general_settings"."ril_note_options")');
    expect(MIGRATION).toContain('jsonb_typeof("general_settings"."ril_transfer_options")');
  });
});
