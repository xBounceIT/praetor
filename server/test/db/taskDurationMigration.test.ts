import { describe, expect, test } from 'bun:test';

const readTaskDurationMigration = () =>
  Bun.file(new URL('../../db/migrations/0088_add_task_duration.sql', import.meta.url)).text();

describe('task duration migration', () => {
  test('preserves legacy total effort when monthly effort already exists', async () => {
    const sql = await readTaskDurationMigration();

    expect(sql).toContain('SET "duration" = ROUND("expected_effort" / "monthly_effort", 2)');
    expect(sql).toContain('AND COALESCE("monthly_effort", 0) > 0');
  });

  test('falls back to expected effort as monthly effort when monthly effort is missing', async () => {
    const sql = await readTaskDurationMigration();

    expect(sql).toContain('SET "monthly_effort" = "expected_effort"');
    expect(sql).toContain('("monthly_effort" IS NULL OR "monthly_effort" = 0)');
  });
});
