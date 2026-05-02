import { beforeEach, describe, expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.ts';
import { generalSettings } from '../../db/schema/generalSettings.ts';
import * as generalSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// drizzle-orm/node-postgres uses rowMode: 'array' for select queries; rows are positional
// in the projection-declaration order from `GENERAL_SETTINGS_PROJECTION` in
// generalSettingsRepo.ts. Tests use `buildRow` (below) to construct fixtures by field name
// rather than by index, so a column reorder in the repo is caught either at TS compile time
// (unknown key) or at test time (wrong-shaped row). PROJECTION_KEYS MUST stay in sync with
// `GENERAL_SETTINGS_PROJECTION`.
const PROJECTION_KEYS = [
  'currency',
  'dailyLimit',
  'startOfWeek',
  'treatSaturdayAsHoliday',
  'enableAiReporting',
  'geminiApiKey',
  'aiProvider',
  'openrouterApiKey',
  'geminiModelId',
  'openrouterModelId',
  'allowWeekendSelection',
  'defaultLocation',
] as const;
type ProjectionKey = (typeof PROJECTION_KEYS)[number];
type RowFields = Record<ProjectionKey, unknown>;

// pg's `numeric` type comes back from the driver as a string (so dailyLimit is '8.50' here,
// not 8.5). The repo's `mapRow` parses it to a JS number.
const baseFields: RowFields = {
  currency: '€',
  dailyLimit: '8.50',
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: false,
  enableAiReporting: null,
  geminiApiKey: null,
  aiProvider: null,
  openrouterApiKey: null,
  geminiModelId: null,
  openrouterModelId: null,
  allowWeekendSelection: null,
  defaultLocation: null,
};

const buildRow = (overrides: Partial<RowFields> = {}): unknown[] => {
  const merged: RowFields = { ...baseFields, ...overrides };
  return PROJECTION_KEYS.map((k) => merged[k]);
};

describe('get', () => {
  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await generalSettingsRepo.get(testDb);
    expect(result).toBeNull();
  });

  test('parses dailyLimit string from pg numeric to a JS number', async () => {
    exec.enqueue({ rows: [buildRow()] });
    const result = await generalSettingsRepo.get(testDb);
    expect(result?.dailyLimit).toBe(8.5);
  });

  test('preserves non-numeric fields verbatim', async () => {
    exec.enqueue({
      rows: [buildRow({ currency: 'USD', enableAiReporting: true, defaultLocation: 'office' })],
    });
    const result = await generalSettingsRepo.get(testDb);
    expect(result?.currency).toBe('USD');
    expect(result?.enableAiReporting).toBe(true);
    expect(result?.defaultLocation).toBe('office');
  });

  test('targets the singleton row via WHERE id = 1', async () => {
    exec.enqueue({ rows: [] });
    await generalSettingsRepo.get(testDb);
    expect(exec.calls[0].sql).toMatch(/"id"\s*=\s*\$\d+/);
    expect(exec.calls[0].params).toContain(1);
  });
});

describe('update', () => {
  test('throws the seed-missing guard when UPDATE returns 0 rows', async () => {
    exec.enqueue({ rows: [] });
    await expect(generalSettingsRepo.update({}, testDb)).rejects.toThrow(
      /general_settings row \(id=1\) not found/,
    );
  });

  test('returns the RETURNING row mapped to the GeneralSettings shape', async () => {
    exec.enqueue({
      rows: [buildRow({ currency: 'USD', dailyLimit: '9.00', startOfWeek: 'Sunday' })],
    });
    const result = await generalSettingsRepo.update(
      { currency: 'USD', dailyLimit: 9, startOfWeek: 'Sunday' },
      testDb,
    );
    expect(result.currency).toBe('USD');
    expect(result.dailyLimit).toBe(9);
    expect(result.startOfWeek).toBe('Sunday');
  });

  test('parses dailyLimit on the row returned from RETURNING', async () => {
    exec.enqueue({ rows: [buildRow({ dailyLimit: '12.00' })] });
    const result = await generalSettingsRepo.update({}, testDb);
    expect(result.dailyLimit).toBe(12);
  });

  test('passes scalar patch values as bound parameters', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await generalSettingsRepo.update(
      {
        currency: 'USD',
        dailyLimit: 9,
        startOfWeek: 'Sunday',
        treatSaturdayAsHoliday: true,
        enableAiReporting: false,
        geminiApiKey: 'g-key',
        aiProvider: 'gemini',
        openrouterApiKey: 'or-key',
        geminiModelId: 'gemini-2.0',
        openrouterModelId: 'or/model',
        allowWeekendSelection: true,
        defaultLocation: 'home',
      },
      testDb,
    );
    const params = exec.calls[0].params;
    expect(params).toContain('USD');
    expect(params).toContain(9);
    expect(params).toContain('Sunday');
    expect(params).toContain(true);
    expect(params).toContain(false);
    expect(params).toContain('g-key');
    expect(params).toContain('gemini');
    expect(params).toContain('or-key');
    expect(params).toContain('gemini-2.0');
    expect(params).toContain('or/model');
    expect(params).toContain('home');
    // Tighter check on top of the .toContain() pattern from the canonical ldap/email tests:
    // since the SET clause emits its 12 COALESCE pairs in projection-declaration order and
    // each pair binds exactly one patch-value param (the column ref renders as a SQL
    // identifier, not a parameter), the first 12 params must match PROJECTION_KEYS order.
    // Catches column→param wiring bugs where two same-typed booleans (e.g.,
    // treatSaturdayAsHoliday vs allowWeekendSelection) get swapped.
    expect(params.slice(0, 12)).toEqual([
      'USD',
      9,
      'Sunday',
      true,
      false,
      'g-key',
      'gemini',
      'or-key',
      'gemini-2.0',
      'or/model',
      true,
      'home',
    ]);
  });

  test('binds NULL for omitted patch fields (COALESCE preserves existing column)', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await generalSettingsRepo.update({ currency: 'USD' }, testDb);
    // The SET clause always emits 12 COALESCE pairs (one per patchable column); 11 of those
    // patch-value params are null when only `currency` is provided. The UPDATE also binds the
    // singleton WHERE param (1), so we expect ≥11 nulls in the param list.
    const nullCount = exec.calls[0].params.filter((p) => p === null).length;
    expect(nullCount).toBeGreaterThanOrEqual(11);
  });

  test('targets the singleton row via WHERE id = 1', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await generalSettingsRepo.update({ currency: 'USD' }, testDb);
    expect(exec.calls[0].sql).toMatch(/"id"\s*=\s*\$\d+/);
    expect(exec.calls[0].params).toContain(1);
  });
});

describe('schema invariants', () => {
  // Direct enforcement of the invariant called out in the comment above PROJECTION_KEYS:
  // a column reorder in `db/schema/generalSettings.ts` (or one added without updating the
  // projection) would silently desync `rowMode: 'array'` decoding from the projection map.
  // The other tests would surface this as a wrong-shaped row, but failing here gives a
  // direct signal — "schema column order changed" — instead of cascading expectation
  // mismatches.
  test('PROJECTION_KEYS match the schema column order (excluding id and updatedAt)', () => {
    const schemaColumnNames = Object.keys(getTableColumns(generalSettings));
    const expectedKeys = schemaColumnNames.filter((k) => k !== 'id' && k !== 'updatedAt');
    expect([...PROJECTION_KEYS]).toEqual(expectedKeys);
  });
});
