import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0069_add_ril_drafts_and_weekday_transfer.sql');

describe('migration 0069: adds RIL drafts table and weekday transfer defaults', () => {
  test('creates the ril_drafts table with its core columns', () => {
    expect(MIGRATION).toContain('CREATE TABLE "ril_drafts"');
    expect(MIGRATION).toContain('"user_id" varchar(50)');
    expect(MIGRATION).toContain('"month_key" varchar(7)');
    expect(MIGRATION).toContain('"rows" jsonb');
  });

  test('constrains the ril_drafts table with unique, checks, and FK', () => {
    expect(MIGRATION).toContain('ril_drafts_user_month_unique');
    expect(MIGRATION).toContain('ril_drafts_month_key_check');
    expect(MIGRATION).toContain('ril_drafts_rows_object_check');
    expect(MIGRATION).toContain('jsonb_typeof("ril_drafts"."rows")');
    expect(MIGRATION).toContain('REFERENCES "public"."users"');
  });

  test('adds the RIL weekday transfer defaults column to settings', () => {
    expect(MIGRATION).toContain(
      'ALTER TABLE "settings" ADD COLUMN "ril_weekday_transfer_defaults" jsonb',
    );
    expect(MIGRATION).toContain('settings_ril_weekday_transfer_defaults_object_check');
  });
});
