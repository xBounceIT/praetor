import { beforeEach, describe, expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.ts';
import { generalSettings } from '../../db/schema/generalSettings.ts';
import * as generalSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import { decrypt, encrypt, isEncrypted } from '../../utils/crypto.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

process.env.ENCRYPTION_KEY ||= 'general-settings-repo-test-key';

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
  'enableTotp',
  'enforceTotp',
  'totpEnforcedRoleIds',
  'totpExemptRoleIds',
  'totpExemptUserIds',
  'sessionIdleTimeoutMinutes',
  'geminiApiKey',
  'aiProvider',
  'openrouterApiKey',
  'anthropicApiKey',
  'openaiApiKey',
  'localApiKey',
  'localBaseUrl',
  'geminiModelId',
  'openrouterModelId',
  'anthropicModelId',
  'openaiModelId',
  'localModelId',
  'allowWeekendSelection',
  'defaultLocation',
  'rilCompanyName',
  'rilDefaultStartTime',
  'rilDefaultExitTime',
  'rilLunchBreakMinutes',
  'rilNoteOptions',
  'rilTransferOptions',
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
  enableTotp: true,
  enforceTotp: false,
  totpEnforcedRoleIds: [],
  totpExemptRoleIds: [],
  totpExemptUserIds: [],
  sessionIdleTimeoutMinutes: 30,
  geminiApiKey: null,
  aiProvider: null,
  openrouterApiKey: null,
  anthropicApiKey: null,
  openaiApiKey: null,
  localApiKey: null,
  localBaseUrl: null,
  geminiModelId: null,
  openrouterModelId: null,
  anthropicModelId: null,
  openaiModelId: null,
  localModelId: null,
  allowWeekendSelection: null,
  defaultLocation: null,
  rilCompanyName: '',
  rilDefaultStartTime: '09:00',
  rilDefaultExitTime: '18:00',
  rilLunchBreakMinutes: 60,
  rilNoteOptions: [
    { value: 'P', label: 'Ferie' },
    { value: 'P2', label: 'Permesso' },
    { value: 'M', label: 'Malattia' },
    { value: 'F', label: 'Festivita' },
  ],
  rilTransferOptions: ['In sede', 'Telelavoro'],
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
      rows: [
        buildRow({
          currency: 'USD',
          enableAiReporting: true,
          defaultLocation: 'office',
          rilCompanyName: 'ACME',
          rilDefaultStartTime: '08:30',
          rilDefaultExitTime: '17:30',
          rilLunchBreakMinutes: 45,
          rilNoteOptions: [{ value: 'HOL', label: 'Holiday' }],
          rilTransferOptions: ['Office', 'Remote'],
        }),
      ],
    });
    const result = await generalSettingsRepo.get(testDb);
    expect(result?.currency).toBe('USD');
    expect(result?.enableAiReporting).toBe(true);
    expect(result?.defaultLocation).toBe('office');
    expect(result?.rilCompanyName).toBe('ACME');
    expect(result?.rilDefaultStartTime).toBe('08:30');
    expect(result?.rilDefaultExitTime).toBe('17:30');
    expect(result?.rilLunchBreakMinutes).toBe(45);
    expect(result?.rilNoteOptions).toEqual([{ value: 'HOL', label: 'Holiday' }]);
    expect(result?.rilTransferOptions).toEqual(['Office', 'Remote']);
  });

  test('targets the singleton row via WHERE id = 1', async () => {
    exec.enqueue({ rows: [] });
    await generalSettingsRepo.get(testDb);
    expect(exec.calls[0].sql).toMatch(/"id"\s*=\s*\$\d+/);
    expect(exec.calls[0].params).toContain(1);
  });

  test('decrypts encrypted provider keys for internal consumers', async () => {
    const encryptedKey = encrypt('secret-openai-key');
    exec.enqueue({ rows: [buildRow({ openaiApiKey: encryptedKey })] });

    const result = await generalSettingsRepo.getWithAiApiKeys(testDb);

    expect(result?.openaiApiKey).toBe('secret-openai-key');
    expect(exec.calls).toHaveLength(1);
  });

  test('ordinary settings reads do not decrypt corrupted AI credentials', async () => {
    const parts = encrypt('secret-openai-key').split(':');
    parts[4] = Buffer.from('tampered-ciphertext').toString('base64');
    const corruptedCiphertext = parts.join(':');
    exec.enqueue({ rows: [buildRow({ openaiApiKey: corruptedCiphertext })] });

    const result = await generalSettingsRepo.get(testDb);

    expect(result?.sessionIdleTimeoutMinutes).toBe(30);
    expect(result?.openaiApiKey).toBe(corruptedCiphertext);
  });

  test('lazily migrates legacy plaintext provider keys in one retry-safe update', async () => {
    exec.enqueue({
      rows: [
        buildRow({
          geminiApiKey: 'legacy-gemini',
          openaiApiKey: 'legacy-openai',
        }),
      ],
    });
    exec.enqueue({ rows: [] });

    const result = await generalSettingsRepo.get(testDb);

    expect(result?.geminiApiKey).toBe('legacy-gemini');
    expect(result?.openaiApiKey).toBe('legacy-openai');
    expect(exec.calls).toHaveLength(2);
    const migrationParams = exec.calls[1].params.filter(
      (value): value is string => typeof value === 'string' && isEncrypted(value),
    );
    expect(migrationParams.map(decrypt).toSorted()).toEqual(['legacy-gemini', 'legacy-openai']);
    expect(exec.calls[1].params).toContain('legacy-gemini');
    expect(exec.calls[1].params).toContain('legacy-openai');
    expect(exec.calls[1].sql).not.toContain('sha256');
    expect(exec.calls[1].sql).not.toContain('md5');
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
        enableTotp: true,
        enforceTotp: true,
        totpEnforcedRoleIds: ['admin'],
        totpExemptRoleIds: ['guest'],
        totpExemptUserIds: ['u1'],
        sessionIdleTimeoutMinutes: 45,
        geminiApiKey: 'g-key',
        aiProvider: 'anthropic',
        openrouterApiKey: 'or-key',
        anthropicApiKey: 'a-key',
        openaiApiKey: 'oa-key',
        localApiKey: 'local-key',
        localBaseUrl: 'http://inference:11434/v1',
        geminiModelId: 'gemini-2.0',
        openrouterModelId: 'or/model',
        anthropicModelId: 'claude-sonnet-4-5',
        openaiModelId: 'gpt-5',
        localModelId: 'llama3.2',
        allowWeekendSelection: true,
        defaultLocation: 'home',
        rilCompanyName: 'ACME',
        rilDefaultStartTime: '08:30',
        rilDefaultExitTime: '17:30',
        rilLunchBreakMinutes: 45,
        rilNoteOptions: [{ value: 'HOL', label: 'Holiday' }],
        rilTransferOptions: ['Office', 'Remote'],
      },
      testDb,
    );
    const params = exec.calls[0].params;
    expect(params).toContain('USD');
    expect(params).toContain(9);
    expect(params).toContain('Sunday');
    expect(params).toContain(true);
    expect(params).toContain(false);
    expect(params).toContain(45);
    expect(params).not.toContain('g-key');
    expect(params).toContain('anthropic');
    expect(params).not.toContain('or-key');
    expect(params).not.toContain('a-key');
    expect(params).not.toContain('oa-key');
    expect(params).not.toContain('local-key');
    expect(params).toContain('http://inference:11434/v1');
    expect(params).toContain('gemini-2.0');
    expect(params).toContain('or/model');
    expect(params).toContain('claude-sonnet-4-5');
    expect(params).toContain('gpt-5');
    expect(params).toContain('llama3.2');
    expect(params).toContain('home');
    expect(params).toContain('ACME');
    expect(params).toContain('08:30');
    expect(params).toContain('17:30');
    expect(params).toContain(45);
    const enforcedRolesJson = JSON.stringify(['admin']);
    const exemptRolesJson = JSON.stringify(['guest']);
    const exemptUsersJson = JSON.stringify(['u1']);
    const noteOptionsJson = JSON.stringify([{ value: 'HOL', label: 'Holiday' }]);
    const transferOptionsJson = JSON.stringify(['Office', 'Remote']);
    expect(params).toContain(enforcedRolesJson);
    expect(params).toContain(exemptRolesJson);
    expect(params).toContain(exemptUsersJson);
    expect(params).toContain(noteOptionsJson);
    expect(params).toContain(transferOptionsJson);
    // Tighter check on top of the .toContain() pattern from the canonical ldap/email tests:
    // since the SET clause emits its 31 COALESCE pairs in projection-declaration order and
    // each pair binds exactly one patch-value param (the column ref renders as a SQL
    // identifier, not a parameter), the first 31 params must match PROJECTION_KEYS order.
    // Catches column→param wiring bugs where two same-typed booleans (e.g.,
    // treatSaturdayAsHoliday vs allowWeekendSelection) get swapped.
    const encryptedProviderKeys = [params[11], params[13], params[14], params[15], params[16]];
    expect(
      encryptedProviderKeys.every((value) => typeof value === 'string' && isEncrypted(value)),
    ).toBe(true);
    expect(encryptedProviderKeys.map((value) => decrypt(value as string))).toEqual([
      'g-key',
      'or-key',
      'a-key',
      'oa-key',
      'local-key',
    ]);
    expect(params.slice(0, 31)).toEqual([
      'USD',
      9,
      'Sunday',
      true,
      false,
      true,
      true,
      enforcedRolesJson,
      exemptRolesJson,
      exemptUsersJson,
      45,
      params[11],
      'anthropic',
      params[13],
      params[14],
      params[15],
      params[16],
      'http://inference:11434/v1',
      'gemini-2.0',
      'or/model',
      'claude-sonnet-4-5',
      'gpt-5',
      'llama3.2',
      true,
      'home',
      'ACME',
      '08:30',
      '17:30',
      45,
      noteOptionsJson,
      transferOptionsJson,
    ]);
  });

  test('binds NULL for omitted patch fields (COALESCE preserves existing column)', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await generalSettingsRepo.update({ currency: 'USD' }, testDb);
    // The SET clause always emits 31 COALESCE pairs (one per patchable column); 30 of those
    // patch-value params are null when only `currency` is provided. The UPDATE also binds the
    // singleton WHERE param (1), so we expect >=30 nulls in the param list.
    const nullCount = exec.calls[0].params.filter((p) => p === null).length;
    expect(nullCount).toBeGreaterThanOrEqual(30);
  });

  test('binds an explicit empty API key so administrators can clear a credential', async () => {
    exec.enqueue({ rows: [buildRow()] });

    await generalSettingsRepo.update({ openaiApiKey: '' }, testDb);

    expect(exec.calls[0].params[15]).toBe('');
  });

  test('binds NULL for explicit null RIL arrays to preserve existing values', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await generalSettingsRepo.update({ rilNoteOptions: null, rilTransferOptions: null }, testDb);

    const params = exec.calls[0].params;
    expect(params[29]).toBeNull();
    expect(params[30]).toBeNull();
    expect(params).not.toContain('null');
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
  // direct signal - "schema column order changed" - instead of cascading expectation
  // mismatches.
  test('PROJECTION_KEYS match the schema column order (excluding id and updatedAt)', () => {
    const schemaColumnNames = Object.keys(getTableColumns(generalSettings));
    const expectedKeys = schemaColumnNames.filter((k) => k !== 'id' && k !== 'updatedAt');
    // Widen `[...PROJECTION_KEYS]` (a union-of-literals tuple from `as const`) to `string[]`
    // so it matches `expectedKeys`, which is `Object.keys(...)`'s plain `string[]`. Bun's
    // `toEqual` infers from the receiver and rejects the comparison without this widening.
    expect([...PROJECTION_KEYS] as string[]).toEqual(expectedKeys);
  });

  // The typed-non-nullable `GeneralSettings` fields can technically be null at the row
  // layer (the schema columns are nullable in TS), so `mapRow` falls back via a private
  // `DEFAULT_FALLBACKS` const. Those fallbacks duplicate the `.default(...)` values declared
  // on the Drizzle schema (and, by transit, the DEFAULTs in schema.sql:693-720). This test
  // builds a row where those columns are null and asserts mapRow's fallback values
  // match the schema column defaults - so any drift between schema.sql, the Drizzle schema,
  // and the repo's fallback const fails CI rather than silently shipping a wrong default.
  test('mapRow defaults match the schema column defaults (drift guard)', async () => {
    const cols = getTableColumns(generalSettings);
    exec.enqueue({
      rows: [
        buildRow({
          currency: null,
          dailyLimit: null,
          startOfWeek: null,
          treatSaturdayAsHoliday: null,
          sessionIdleTimeoutMinutes: null,
        }),
      ],
    });
    const result = await generalSettingsRepo.get(testDb);
    expect(result?.currency).toBe(cols.currency.default as string);
    expect(result?.dailyLimit).toBe(parseFloat(cols.dailyLimit.default as string));
    expect(result?.startOfWeek).toBe(cols.startOfWeek.default as string);
    expect(result?.treatSaturdayAsHoliday).toBe(cols.treatSaturdayAsHoliday.default as boolean);
    expect(result?.sessionIdleTimeoutMinutes).toBe(
      cols.sessionIdleTimeoutMinutes.default as number,
    );
  });
});
