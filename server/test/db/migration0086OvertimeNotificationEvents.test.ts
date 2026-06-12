import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0086_add_overtime_notification_events.sql');

describe('migration 0086: adds overtime notification event dedupe table', () => {
  test('creates the overtime notification events table with core columns', () => {
    expect(MIGRATION).toContain('CREATE TABLE "overtime_notification_events"');
    expect(MIGRATION).toContain('"user_id" varchar(50)');
    expect(MIGRATION).toContain('"event_date" date');
    expect(MIGRATION).toContain('"source" varchar(20)');
    expect(MIGRATION).toContain('"hours" numeric(10, 2)');
    expect(MIGRATION).toContain('"reasons" jsonb');
    expect(MIGRATION).toContain('"created_by" varchar(50)');
  });

  test('adds source, hours, reasons, and per-source dedupe constraints', () => {
    expect(MIGRATION).toContain('overtime_notification_events_source_check');
    expect(MIGRATION).toContain("'tracker', 'ril_manual'");
    expect(MIGRATION).toContain('overtime_notification_events_hours_check');
    expect(MIGRATION).toContain('overtime_notification_events_reasons_array_check');
    expect(MIGRATION).toContain('overtime_notification_events_user_date_source_unique');
    expect(MIGRATION).toContain('"user_id","event_date","source"');
  });

  test('links events to users and indexes date lookups', () => {
    expect(MIGRATION).toContain('FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")');
    expect(MIGRATION).toContain('FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")');
    expect(MIGRATION).toContain('idx_overtime_notification_events_user_date');
    expect(MIGRATION).toContain('"user_id","event_date"');
  });
});
