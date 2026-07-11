import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(new URL('../../db/migrations/0098_add_supplier_contacts.sql', import.meta.url)).text();

const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

describe('migration 0098 add supplier contacts', () => {
  test('adds the JSONB contacts array and backfills named legacy contacts', async () => {
    const sql = await readMigration();

    expect(sql).toContain(`ADD COLUMN "contacts" jsonb DEFAULT '[]'::jsonb`);
    expect(sql).toContain(`'fullName', BTRIM("contact_name")`);
    expect(sql).toContain(`'email', NULLIF(BTRIM("email"), '')`);
    expect(sql).toContain(`'phone', NULLIF(BTRIM("phone"), '')`);
    expect(sql).toContain(`NULLIF(BTRIM("contact_name"), '') IS NOT NULL`);
    expect(sql).not.toContain(`'fullName', BTRIM("name")`);
  });

  test('is registered after migration 0097', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    const migrationIndex = journal.entries.findIndex(
      ({ tag }) => tag === '0098_add_supplier_contacts',
    );

    expect(journal.entries[migrationIndex - 1]).toEqual(expect.objectContaining({ idx: 97 }));
    expect(journal.entries[migrationIndex]).toEqual(
      expect.objectContaining({ idx: 98, tag: '0098_add_supplier_contacts' }),
    );
  });
});
