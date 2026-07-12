import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(
    new URL('../../db/migrations/0100_add_quote_communication_channel_icons.sql', import.meta.url),
  ).text();

const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

describe('migration 0100 add quote communication channel icons', () => {
  test('adds icon metadata and protects the three seeded defaults', async () => {
    const sql = await readMigration();

    expect(sql).toContain(`ADD COLUMN "icon" varchar(50) DEFAULT 'comments' NOT NULL`);
    expect(sql).toContain(`ADD COLUMN "is_default" boolean DEFAULT false NOT NULL`);
    expect(sql).toContain(`WHEN 'qcc_email' THEN 'envelope'`);
    expect(sql).toContain(`WHEN 'qcc_telefono' THEN 'phone'`);
    expect(sql).toContain(`WHEN 'qcc_whatsapp' THEN 'whatsapp'`);
    expect(sql).toContain(`"is_default" = true`);
    expect(sql).toContain(`("id", "name") IN (`);
    expect(sql).toContain(`('qcc_email', 'Email')`);
    expect(sql).toContain(`('qcc_telefono', 'Telefono')`);
    expect(sql).toContain(`('qcc_whatsapp', 'WhatsApp')`);
    expect(sql).not.toContain(`WHERE "id" IN ('qcc_email', 'qcc_telefono', 'qcc_whatsapp')`);
  });

  test('is registered after migration 0099', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    expect(journal.entries.at(-1)).toEqual(
      expect.objectContaining({ idx: 100, tag: '0100_add_quote_communication_channel_icons' }),
    );
  });
});
