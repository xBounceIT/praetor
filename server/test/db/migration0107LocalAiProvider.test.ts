import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0107_add_local_ai_provider.sql');
const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

describe('migration 0107: adds local AI reporting provider', () => {
  test('adds nullable local endpoint fields without rewriting existing settings', () => {
    expect(MIGRATION).toContain('ADD COLUMN "local_api_key" varchar(255)');
    expect(MIGRATION).toContain('ADD COLUMN "local_base_url" varchar(2048)');
    expect(MIGRATION).toContain('ADD COLUMN "local_model_id" varchar(255)');
    expect(MIGRATION).not.toMatch(/local_(api_key|base_url|model_id)"[^;]*NOT NULL/i);
    expect(MIGRATION).not.toContain('UPDATE "general_settings"');
    expect(MIGRATION).not.toContain('DELETE FROM "general_settings"');
  });

  test('expands the provider constraint without changing existing provider values', () => {
    expect(MIGRATION).toContain('DROP CONSTRAINT "general_settings_ai_provider_check"');
    expect(MIGRATION).toContain(
      "\"ai_provider\" IN ('gemini', 'openrouter', 'anthropic', 'openai', 'local')",
    );
  });

  test('is registered immediately after the OpenAI provider migration', async () => {
    const journal = (await readJournal()) as { entries: Array<{ idx: number; tag: string }> };
    const index = journal.entries.findIndex((entry) => entry.tag === '0107_add_local_ai_provider');
    expect(journal.entries[index - 1]).toEqual(
      expect.objectContaining({ idx: 106, tag: '0106_add_openai_ai_provider' }),
    );
    expect(journal.entries[index]).toEqual(
      expect.objectContaining({ idx: 107, tag: '0107_add_local_ai_provider' }),
    );
  });
});
