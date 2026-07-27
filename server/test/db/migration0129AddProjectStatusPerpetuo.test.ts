import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(
    new URL('../../db/migrations/0129_add_project_status_perpetuo.sql', import.meta.url),
  ).text();

describe('migration 0129 add project status perpetuo', () => {
  test('widens projects_status_check to include perpetuo without a blocking validate lock', async () => {
    const sql = await readMigration();

    expect(sql).toContain('ADD CONSTRAINT "projects_status_check_v2"');
    expect(sql).toContain('NOT VALID');
    expect(sql).toContain('VALIDATE CONSTRAINT "projects_status_check_v2"');
    expect(sql).toContain('DROP CONSTRAINT "projects_status_check"');
    expect(sql).toContain(
      'RENAME CONSTRAINT "projects_status_check_v2" TO "projects_status_check"',
    );
    expect(sql).toContain("'perpetuo'");
    expect(sql).toContain("'da_fare'");
    expect(sql).toContain("'in_corso'");
    expect(sql).toContain("'in_pausa'");
    expect(sql).toContain("'terminato'");
    expect(sql).not.toMatch(
      /DROP CONSTRAINT "projects_status_check";[\s\S]*ADD CONSTRAINT "projects_status_check"/,
    );
  });
});
