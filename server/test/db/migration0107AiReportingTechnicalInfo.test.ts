import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0107_add_ai_reporting_technical_info.sql');
const readJournal = async () =>
  Bun.file(new URL('../../db/migrations/meta/_journal.json', import.meta.url)).json();

describe('migration 0107: adds AI Reporting technical metadata', () => {
  test('adds nullable metadata columns without rewriting historical messages', () => {
    expect(MIGRATION).toContain('ADD COLUMN "ai_provider" varchar(20)');
    expect(MIGRATION).toContain('ADD COLUMN "ai_model_id" varchar(255)');
    expect(MIGRATION).toContain('ADD COLUMN "context_tokens_used" integer');
    expect(MIGRATION).toContain('ADD COLUMN "context_window_tokens" integer');
    expect(MIGRATION).not.toContain('NOT NULL');
    expect(MIGRATION).not.toContain('UPDATE "report_chat_messages"');
  });

  test('is registered immediately after the OpenAI provider migration', async () => {
    const journal = (await readJournal()) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const index = journal.entries.findIndex(
      (entry) => entry.tag === '0107_add_ai_reporting_technical_info',
    );

    expect(journal.entries[index - 1]).toEqual(
      expect.objectContaining({ idx: 106, tag: '0106_add_openai_ai_provider' }),
    );
    expect(journal.entries[index]).toEqual(
      expect.objectContaining({ idx: 107, tag: '0107_add_ai_reporting_technical_info' }),
    );
  });
});
