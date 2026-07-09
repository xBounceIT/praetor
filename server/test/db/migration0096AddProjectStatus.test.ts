import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(new URL('../../db/migrations/0096_add_project_status.sql', import.meta.url)).text();

describe('migration 0096 add project status', () => {
  test('adds project status with required backfill/default and migrates legacy rules', async () => {
    const sql = await readMigration();

    expect(sql).toContain('ADD COLUMN "status" varchar(20)');
    expect(sql).toContain('SET "status" = \'in_corso\'');
    expect(sql).toContain("SET DEFAULT 'da_fare'");
    expect(sql).toContain('projects_status_check');
    expect(sql).toContain("WHEN 'active' THEN 'in_corso'");
    expect(sql).toContain("WHEN 'disabled' THEN 'in_pausa'");
    expect(sql).toContain('jsonb_array_elements("project_rules"."conditions") WITH ORDINALITY');
  });
});
