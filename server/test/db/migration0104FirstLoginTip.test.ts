import { describe, expect, test } from 'bun:test';

const migrationSql = await Bun.file(
  new URL('../../db/migrations/0104_add_first_login_tip.sql', import.meta.url),
).text();
const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

describe('migration 0104 first-login tip', () => {
  test('marks legacy users without an unbounded table update', () => {
    const addColumn = migrationSql.indexOf(
      'ADD COLUMN "first_login_at" timestamp DEFAULT TIMESTAMP \'1970-01-01 00:00:00\'',
    );
    const dropDefault = migrationSql.indexOf('ALTER COLUMN "first_login_at" DROP DEFAULT');

    expect(addColumn).toBeGreaterThan(-1);
    expect(dropDefault).toBeGreaterThan(addColumn);
    expect(migrationSql).not.toContain('UPDATE "users"');
    expect(migrationSql).not.toContain('"first_login_at" timestamp NOT NULL');
  });

  test('removes the legacy default so future users remain unclaimed', () => {
    expect(migrationSql).toContain('ALTER COLUMN "first_login_at" DROP DEFAULT');
  });

  test('is registered immediately after migration 0103', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const index = journal.entries.findIndex((entry) => entry.tag === '0104_add_first_login_tip');

    expect(journal.entries[index - 1]).toEqual(
      expect.objectContaining({ idx: 103, tag: '0103_quote_candidates' }),
    );
    expect(journal.entries[index]).toEqual(
      expect.objectContaining({ idx: 104, tag: '0104_add_first_login_tip' }),
    );
  });
});
