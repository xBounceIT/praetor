import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(
    new URL('../../db/migrations/0129_add_project_status_perpetuo.sql', import.meta.url),
  ).text();

describe('migration 0129 add project status perpetuo', () => {
  test('widens projects_status_check to include perpetuo', async () => {
    const sql = await readMigration();

    expect(sql).toContain('DROP CONSTRAINT "projects_status_check"');
    expect(sql).toContain('ADD CONSTRAINT "projects_status_check"');
    expect(sql).toContain("'perpetuo'");
    expect(sql).toContain("'da_fare'");
    expect(sql).toContain("'in_corso'");
    expect(sql).toContain("'in_pausa'");
    expect(sql).toContain("'terminato'");
  });
});
