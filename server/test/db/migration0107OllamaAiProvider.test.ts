import { describe, expect, test } from 'bun:test';

const migrationSql = await Bun.file(
  new URL('../../db/migrations/0107_add_ollama_ai_provider.sql', import.meta.url),
).text();
const readJson = <T>(path: string) => Bun.file(new URL(path, import.meta.url)).json() as Promise<T>;

describe('migration 0107 Ollama AI provider', () => {
  test('adds Ollama settings without rewriting or deleting legacy settings rows', () => {
    expect(migrationSql).toContain(
      `ADD COLUMN "ollama_base_url" varchar(2048) DEFAULT 'http://localhost:11434' NOT NULL`,
    );
    expect(migrationSql).toContain('ADD COLUMN "ollama_bearer_token" varchar(2048)');
    expect(migrationSql).toContain('ADD COLUMN "ollama_model_id" varchar(255)');
    expect(migrationSql).not.toMatch(/\b(?:UPDATE|DELETE FROM|DROP COLUMN)\b/i);
  });

  test('widens the provider constraint while retaining all existing providers', () => {
    expect(migrationSql).toContain('DROP CONSTRAINT "general_settings_ai_provider_check"');
    expect(migrationSql).toContain(
      `CHECK ("general_settings"."ai_provider" IN ('gemini', 'openrouter', 'anthropic', 'openai', 'ollama'))`,
    );
  });

  test('snapshot contains all Ollama columns and the widened constraint', async () => {
    const snapshot = await readJson<{
      tables: Record<
        string,
        {
          columns: Record<string, { default?: string; notNull?: boolean }>;
          checkConstraints: Record<string, { value: string }>;
        }
      >;
    }>('../../db/migrations/meta/0107_snapshot.json');
    const table = snapshot.tables['public.general_settings'];

    expect(table.columns.ollama_base_url).toEqual(
      expect.objectContaining({ default: "'http://localhost:11434'", notNull: true }),
    );
    expect(table.columns).toHaveProperty('ollama_bearer_token');
    expect(table.columns).toHaveProperty('ollama_model_id');
    expect(table.checkConstraints.general_settings_ai_provider_check.value).toContain("'ollama'");
  });

  test('is registered immediately after the OpenAI provider migration', async () => {
    const journal = await readJson<{ entries: Array<{ idx: number; tag: string }> }>(
      '../../db/migrations/meta/_journal.json',
    );
    const index = journal.entries.findIndex((entry) => entry.tag === '0107_add_ollama_ai_provider');

    expect(journal.entries[index - 1]).toEqual(
      expect.objectContaining({ idx: 106, tag: '0106_add_openai_ai_provider' }),
    );
    expect(journal.entries[index]).toEqual(
      expect.objectContaining({ idx: 107, tag: '0107_add_ollama_ai_provider' }),
    );
  });
});
