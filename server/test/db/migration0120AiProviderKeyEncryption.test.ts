import { describe, expect, test } from 'bun:test';

const readMigration = async () =>
  Bun.file(
    new URL('../../db/migrations/0120_widen_ai_provider_keys_for_encryption.sql', import.meta.url),
  )
    .text()
    .then((sql) => sql.replace(/\r\n/g, '\n'));

const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

describe('migration 0120 AI provider key encryption', () => {
  test('widens every legacy provider-key column without rewriting or discarding values', async () => {
    const sql = await readMigration();

    for (const column of [
      'gemini_api_key',
      'openrouter_api_key',
      'anthropic_api_key',
      'openai_api_key',
      'local_api_key',
    ]) {
      expect(sql).toContain(`ALTER COLUMN "${column}" SET DATA TYPE text`);
    }
    expect(sql).not.toContain('UPDATE "general_settings"');
    expect(sql).not.toContain('DROP COLUMN');
  });

  test('is registered immediately after the current main migration', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const migrationIndex = journal.entries.findIndex(
      ({ tag }) => tag === '0120_widen_ai_provider_keys_for_encryption',
    );

    expect(journal.entries[migrationIndex - 1]).toEqual(
      expect.objectContaining({ idx: 119, tag: '0119_preserve_historical_pricing_semantics' }),
    );
    expect(journal.entries[migrationIndex]).toEqual(
      expect.objectContaining({ idx: 120, tag: '0120_widen_ai_provider_keys_for_encryption' }),
    );
  });
});
