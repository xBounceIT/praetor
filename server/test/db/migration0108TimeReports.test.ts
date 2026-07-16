import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0108_add_time_reports.sql');
const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

describe('migration 0108: time reports', () => {
  test('preserves saved views while expanding the kind and adding a retry-safe favorite index', () => {
    expect(MIGRATION).toContain('DROP CONSTRAINT IF EXISTS "saved_views_kind_check"');
    expect(MIGRATION).toContain("'table', 'dashboard', 'report'");
    expect(MIGRATION).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_saved_views_report_owner_scope_name_unique"',
    );
    expect(MIGRATION).toContain('lower("name")');
    expect(MIGRATION).not.toMatch(/DELETE\s+FROM\s+"saved_views"/i);
    expect(MIGRATION).not.toMatch(/UPDATE\s+"saved_views"/i);
  });

  test('backfills only the exact built-in non-admin grants and is idempotent', () => {
    const expected = [
      "('user', 'reports.time_report.view')",
      "('manager', 'reports.time_report.view')",
      "('manager', 'reports.time_report_all.view')",
      "('top_manager', 'reports.time_report.view')",
      "('top_manager', 'reports.time_report_all.view')",
    ];
    for (const grant of expected) expect(MIGRATION).toContain(grant);
    expect(MIGRATION).toContain('COALESCE(r.is_system, false) = true');
    expect(MIGRATION).toContain('ON CONFLICT ("role_id", "permission") DO NOTHING');
    expect(MIGRATION).not.toContain("('admin', 'reports.time_report");
    expect(MIGRATION).not.toMatch(/UPDATE\s+"roles"/i);
  });

  test('is registered after the upstream AI Reporting migration', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const index = journal.entries.findIndex((entry) => entry.tag === '0108_add_time_reports');

    expect(journal.entries[index - 1]).toEqual(
      expect.objectContaining({ idx: 107, tag: '0107_add_ai_reporting_technical_info' }),
    );
    expect(journal.entries[index]).toEqual(
      expect.objectContaining({ idx: 108, tag: '0108_add_time_reports' }),
    );
  });
});
