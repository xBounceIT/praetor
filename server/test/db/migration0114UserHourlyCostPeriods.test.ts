import { describe, expect, test } from 'bun:test';

const migrationSql = await Bun.file(
  new URL('../../db/migrations/0114_add_user_hourly_cost_periods.sql', import.meta.url),
).text();
const schemaSource = await Bun.file(
  new URL('../../db/schema/userHourlyCostPeriods.ts', import.meta.url),
).text();
const seedSql = await Bun.file(new URL('../../db/seed.sql', import.meta.url)).text();
const repositorySource = await Bun.file(
  new URL('../../repositories/userHourlyCostPeriodsRepo.ts', import.meta.url),
).text();

describe('migration 0114 user hourly cost periods', () => {
  test('creates effective-dated rates with one baseline and non-negative costs', () => {
    expect(migrationSql).toContain('CREATE TABLE "user_hourly_cost_periods"');
    expect(migrationSql).toContain('"effective_from" date');
    expect(migrationSql).toContain('user_hourly_cost_periods_cost_non_negative');
    expect(migrationSql).toContain('idx_user_hourly_cost_periods_user_from_unique');
    expect(migrationSql).toContain('idx_user_hourly_cost_periods_baseline_unique');
    expect(migrationSql).toContain('WHERE "user_hourly_cost_periods"."effective_from" IS NULL');
    expect(schemaSource).toContain("onDelete: 'cascade'");
  });

  test('backfills every legacy user without rewriting timesheet history', () => {
    expect(migrationSql).toContain('UPDATE "users"');
    expect(migrationSql).toContain('SET "cost_per_hour" = 0');
    expect(migrationSql).toContain('WHERE "cost_per_hour" IS NULL OR "cost_per_hour" < 0');
    expect(migrationSql).toContain('SELECT "id", NULL, COALESCE("cost_per_hour", 0)');
    expect(migrationSql).toContain('FROM "users"');
    expect(migrationSql).not.toContain('UPDATE time_entries');
  });

  test('keeps legacy inserts and scalar cost writes compatible', () => {
    expect(migrationSql).toContain('sync_user_hourly_cost_periods_from_legacy');
    expect(migrationSql).toContain('AFTER INSERT OR UPDATE OF cost_per_hour ON users');
    expect(migrationSql).toContain('DELETE FROM user_hourly_cost_periods WHERE user_id = NEW.id');
    expect(migrationSql).toContain('VALUES (NEW.id, NULL, COALESCE(NEW.cost_per_hour, 0))');
  });

  test('recalculates only changed entries with a set-based versioned update', () => {
    expect(repositorySource).toContain('WITH resolved_costs AS');
    expect(repositorySource).toContain('JOIN LATERAL');
    expect(repositorySource).toContain('version = te.version + 1');
    expect(repositorySource).toContain(
      'te.hourly_cost IS DISTINCT FROM resolved_costs.cost_per_hour',
    );
  });

  test('fresh demo seeds also create the required baseline period', () => {
    expect(seedSql).toContain('INSERT INTO user_hourly_cost_periods');
    expect(seedSql).toContain('effective_from, cost_per_hour');
  });
});
