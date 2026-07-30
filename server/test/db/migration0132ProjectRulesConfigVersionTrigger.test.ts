import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const migration = readMigrationFile('0132_project_rules_config_version_trigger.sql');

describe('migration 0132: version project-rule configuration changes', () => {
  test('versions configuration writes and resets stale evaluation state', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "bump_project_rules_config_version"');
    expect(migration).toContain('NEW."config_version" := OLD."config_version" + 1');
    expect(migration).toContain('BEFORE UPDATE OF');
    for (const column of [
      'name',
      'field',
      'operator',
      'value',
      'condition_logic',
      'conditions',
      'action_type',
      'action_config',
      'evaluation_mode',
      'schedule_config',
      'is_enabled',
    ]) {
      expect(migration).toContain(`"${column}"`);
    }
    const triggerColumnsStart = migration.indexOf('BEFORE UPDATE OF');
    const triggerColumns = migration.slice(
      triggerColumnsStart,
      migration.indexOf('ON "project_rules"', triggerColumnsStart),
    );
    expect(triggerColumns).not.toContain('"condition_met"');
    expect(triggerColumns).not.toContain('"last_triggered_at"');
    expect(triggerColumns).not.toContain('"last_evaluated_period"');
    expect(migration).toContain('NEW."condition_met" := false');
    expect(migration).toContain('NEW."last_triggered_at" := NULL');
    expect(migration).toContain('NEW."last_evaluated_period" := NULL');
    expect(migration).toContain('OLD."is_enabled" = false AND NEW."is_enabled" = true');
  });
});
