import { describe, expect, test } from 'bun:test';

const migration = await Bun.file(
  new URL('../../db/migrations/0131_extend_project_rules_periodic.sql', import.meta.url),
).text();

describe('migration 0131: extend project rules with periodic evaluation', () => {
  test('adds retry-safe defaults for existing continuous rules', () => {
    expect(migration).toContain(`ALTER COLUMN "value" SET DATA TYPE text`);
    expect(migration).toContain(`"evaluation_mode" varchar(20) DEFAULT 'continuous' NOT NULL`);
    expect(migration).toContain(`"schedule_config" jsonb DEFAULT`);
    expect(migration).toContain(`"last_evaluated_period" varchar(160)`);
    expect(migration).toContain(`"config_version" integer DEFAULT 0 NOT NULL`);
    expect(migration).toContain(`"frequency":"monthly"`);
    expect(migration).toContain(`"timeZone":"UTC"`);
  });
});
