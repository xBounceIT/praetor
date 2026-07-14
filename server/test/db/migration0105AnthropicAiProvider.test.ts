import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0105_add_anthropic_ai_provider.sql');

describe('migration 0105: adds Anthropic AI reporting provider', () => {
  test('adds nullable Anthropic credentials without rewriting existing settings rows', () => {
    expect(MIGRATION).toContain('ADD COLUMN "anthropic_api_key" varchar(255)');
    expect(MIGRATION).toContain('ADD COLUMN "anthropic_model_id" varchar(255)');
    expect(MIGRATION).not.toMatch(/anthropic_(api_key|model_id)"[^;]*NOT NULL/i);
    expect(MIGRATION).not.toContain('UPDATE "general_settings"');
  });

  test('expands the provider constraint while preserving legacy provider values', () => {
    expect(MIGRATION).toContain('DROP CONSTRAINT "general_settings_ai_provider_check"');
    expect(MIGRATION).toContain("\"ai_provider\" IN ('gemini', 'openrouter', 'anthropic')");
  });
});
