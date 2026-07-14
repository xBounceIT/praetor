import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0106_add_openai_ai_provider.sql');
const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

describe('migration 0106: adds OpenAI AI reporting provider', () => {
  test('adds nullable OpenAI credentials without rewriting existing settings rows', () => {
    expect(MIGRATION).toContain('ADD COLUMN "openai_api_key" varchar(255)');
    expect(MIGRATION).toContain('ADD COLUMN "openai_model_id" varchar(255)');
    expect(MIGRATION).not.toMatch(/openai_(api_key|model_id)"[^;]*NOT NULL/i);
    expect(MIGRATION).not.toContain('UPDATE "general_settings"');
    expect(MIGRATION).not.toContain('DELETE FROM "general_settings"');
  });

  test('expands the provider constraint while preserving existing provider values', () => {
    expect(MIGRATION).toContain('DROP CONSTRAINT "general_settings_ai_provider_check"');
    expect(MIGRATION).toContain(
      "\"ai_provider\" IN ('gemini', 'openrouter', 'anthropic', 'openai')",
    );
  });

  test('is registered immediately after the Anthropic provider migration', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const index = journal.entries.findIndex((entry) => entry.tag === '0106_add_openai_ai_provider');

    expect(journal.entries[index - 1]).toEqual(
      expect.objectContaining({ idx: 105, tag: '0105_add_anthropic_ai_provider' }),
    );
    expect(journal.entries[index]).toEqual(
      expect.objectContaining({ idx: 106, tag: '0106_add_openai_ai_provider' }),
    );
  });
});
