import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

// Migration 0056 grants `reports.cost.view` to the shipped `manager` and
// `top_manager` roles — the dedicated permission that gates every monetary
// cost figure (project cost-vs-revenue chart, Total Cost / Budget KPIs, cost
// columns on entries and reports) on both client and server. This pins the
// migration's shape so a replay against an up-to-date DB stays a true no-op.

describe('migration 0056: grants reports.cost.view to manager + top_manager defaults', () => {
  const MIGRATION = readMigrationFile('0056_grant_reports_cost_to_managers.sql');

  test('grants reports.cost.view to both default roles', () => {
    expect(MIGRATION).toMatch(/\('manager',\s*'reports\.cost\.view'\)/);
    expect(MIGRATION).toMatch(/\('top_manager',\s*'reports\.cost\.view'\)/);
  });

  test('is idempotent — ON CONFLICT DO NOTHING absorbs re-runs and prior manual grants', () => {
    expect(MIGRATION).toMatch(/ON CONFLICT DO NOTHING/i);
  });

  test('uses INSERT...SELECT JOIN roles so missing roles are skipped (no FK violation)', () => {
    // The Drizzle-only fresh-DB path doesn't seed the system roles, so a literal
    // VALUES INSERT would violate the role_id FK. JOINing `roles` skips absent
    // roles instead — mirroring migration 0055.
    expect(MIGRATION).toMatch(/INSERT INTO role_permissions \(role_id, permission\)/i);
    expect(MIGRATION).toMatch(/JOIN roles r ON r\.id = p\.role_id/i);
  });

  test('only touches the two cost grants — no unrelated permission writes', () => {
    const grants = MIGRATION.match(/'reports\.cost\.view'/g) ?? [];
    expect(grants).toHaveLength(2);
    // The only permission string written to a VALUES tuple is reports.cost.view —
    // guards against the migration accidentally widening to other permissions.
    const valuesPerms = MIGRATION.match(/\(\s*'(?:manager|top_manager)',\s*'([^']+)'\)/g) ?? [];
    expect(valuesPerms).toHaveLength(2);
    for (const tuple of valuesPerms) {
      expect(tuple).toContain("'reports.cost.view'");
    }
  });
});
