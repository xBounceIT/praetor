import { describe, expect, test } from 'bun:test';
import { readMigrationFile, readSchemaFile } from '../helpers/schemaFiles.ts';

// Regression: #593. PR #590 capped duration / recurrenceDuration at 24h at the AJV +
// service layers, but the DB column had no CHECK and no backfill, so pre-#590 rows with
// huge values (the `1_000_000` case from #516) survived and recurring-task templates kept
// generating poisoned entries via `generateRecurringEntries`. Migration 0049 clamps the
// existing values and adds storage-layer CHECK constraints. We assert both pieces at the
// migration-SQL level and at the schema-definition level so a future schema edit that
// removes the check fails CI before a fresh migration ever generates without it.
//
// We read the migration text rather than connect to PG; the route-level tests already
// exercise the 400 path that the AJV cap produces at runtime.

const MIGRATION = readMigrationFile('0049_cap_existing_durations_at_24h.sql');

describe('migration 0049: 24h duration cap is enforced at the DB layer', () => {
  describe('backfill clamps pre-existing overflow rows', () => {
    test('time_entries.duration > 24 is clamped to 24', () => {
      expect(MIGRATION).toMatch(
        /UPDATE\s+"time_entries"\s+SET\s+"duration"\s*=\s*24\s+WHERE\s+"duration"\s*>\s*24/i,
      );
    });

    test('time_entries.duration < 0 is clamped to 0', () => {
      expect(MIGRATION).toMatch(
        /UPDATE\s+"time_entries"\s+SET\s+"duration"\s*=\s*0\s+WHERE\s+"duration"\s*<\s*0/i,
      );
    });

    test('tasks.recurrence_duration > 24 is clamped to 24', () => {
      expect(MIGRATION).toMatch(
        /UPDATE\s+"tasks"\s+SET\s+"recurrence_duration"\s*=\s*24\s+WHERE\s+"recurrence_duration"\s*>\s*24/i,
      );
    });

    test('tasks.recurrence_duration < 0 is clamped to 0', () => {
      expect(MIGRATION).toMatch(
        /UPDATE\s+"tasks"\s+SET\s+"recurrence_duration"\s*=\s*0\s+WHERE\s+"recurrence_duration"\s*<\s*0/i,
      );
    });

    // Check both pairs separately — a single global "any UPDATE before any ADD CONSTRAINT"
    // check would miss a regression that flips just one pair (e.g. tasks ADD CONSTRAINT
    // ending up before tasks UPDATE while the time_entries pair stays correct).
    test.each([
      [
        'time_entries',
        /UPDATE\s+"time_entries"/i,
        /ADD CONSTRAINT\s+"time_entries_duration_max_check"/i,
      ],
      ['tasks', /UPDATE\s+"tasks"/i, /ADD CONSTRAINT\s+"tasks_recurrence_duration_max_check"/i],
    ])('%s: clamp UPDATE runs before its ADD CONSTRAINT', (_label, updatePattern, constraintPattern) => {
      const updateIdx = MIGRATION.search(updatePattern);
      const constraintIdx = MIGRATION.search(constraintPattern);
      expect(updateIdx).toBeGreaterThanOrEqual(0);
      expect(constraintIdx).toBeGreaterThan(updateIdx);
    });
  });

  describe('CHECK constraint installation', () => {
    test('time_entries_duration_max_check enforces [0, 24]', () => {
      expect(MIGRATION).toMatch(
        /ADD CONSTRAINT\s+"time_entries_duration_max_check"\s+CHECK\s*\(\s*"time_entries"\."duration"\s*>=\s*0\s+AND\s+"time_entries"\."duration"\s*<=\s*24\s*\)/i,
      );
    });

    test('tasks_recurrence_duration_max_check enforces NULL OR [0, 24]', () => {
      expect(MIGRATION).toMatch(
        /ADD CONSTRAINT\s+"tasks_recurrence_duration_max_check"\s+CHECK\s*\(\s*"tasks"\."recurrence_duration"\s+IS\s+NULL\s+OR\s+\(\s*"tasks"\."recurrence_duration"\s*>=\s*0\s+AND\s+"tasks"\."recurrence_duration"\s*<=\s*24\s*\)\s*\)/i,
      );
    });

    test('both ADD CONSTRAINTs are wrapped in idempotent pg_constraint probes', () => {
      // Two DO blocks, one per constraint. Pattern: SELECT 1 FROM pg_constraint with the
      // canonical name, then ADD CONSTRAINT only if it does not already exist.
      const probeMatches = MIGRATION.match(/IF NOT EXISTS \(\s*SELECT 1\s+FROM pg_constraint/gi);
      expect(probeMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('schema sources still declare the CHECK constraints (guards against accidental removal)', () => {
  test('schema/timeEntries.ts declares time_entries_duration_max_check', () => {
    const src = readSchemaFile('timeEntries.ts');
    // Anchor the bound assertion to the constraint name so it can't be satisfied by a
    // `>= 0` clause on an unrelated column (e.g. `hourlyCost`) plus a stray `<= 24`.
    expect(src).toMatch(/time_entries_duration_max_check[\s\S]{0,200}>=\s*0[\s\S]{0,80}<=\s*24/);
  });

  test('schema/tasks.ts declares tasks_recurrence_duration_max_check', () => {
    const src = readSchemaFile('tasks.ts');
    expect(src).toMatch(
      /tasks_recurrence_duration_max_check[\s\S]{0,300}recurrenceDuration[\s\S]{0,120}<=\s*24/,
    );
  });
});
