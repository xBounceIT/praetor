import { beforeEach, describe, expect, test } from 'bun:test';
import * as generalSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const baseRow = {
  currency: '€',
  dailyLimit: '8.50',
  startOfWeek: 'monday',
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

describe('get', () => {
  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await generalSettingsRepo.get(exec);
    expect(result).toBeNull();
  });

  test('parses dailyLimit string from pg numeric to a JS number', async () => {
    exec.enqueue({ rows: [baseRow] });
    const result = await generalSettingsRepo.get(exec);
    expect(result?.dailyLimit).toBe(8.5);
  });

  test('preserves non-numeric fields verbatim', async () => {
    exec.enqueue({
      rows: [{ ...baseRow, currency: 'USD', enableAiReporting: true, defaultLocation: 'office' }],
    });
    const result = await generalSettingsRepo.get(exec);
    expect(result?.currency).toBe('USD');
    expect(result?.enableAiReporting).toBe(true);
    expect(result?.defaultLocation).toBe('office');
  });
});

describe('update', () => {
  test('throws the seed-missing guard when UPDATE returns 0 rows', async () => {
    exec.enqueue({ rows: [] });
    await expect(generalSettingsRepo.update({}, exec)).rejects.toThrow(
      /general_settings row \(id=1\) not found/,
    );
  });

  test('passes patch values in declared column order', async () => {
    exec.enqueue({ rows: [baseRow] });
    await generalSettingsRepo.update(
      {
        currency: 'USD',
        dailyLimit: 9,
        startOfWeek: 'sunday',
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
      exec,
    );
    expect(exec.calls[0].params).toEqual([
      'USD',
      9,
      'sunday',
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

  test('passes undefined for omitted patch fields', async () => {
    exec.enqueue({ rows: [baseRow] });
    await generalSettingsRepo.update({ currency: 'USD' }, exec);
    const params = exec.calls[0].params;
    expect(params).toHaveLength(12);
    expect(params[0]).toBe('USD');
    expect(params[1]).toBeUndefined();
    expect(params[11]).toBeUndefined();
  });

  test('parses dailyLimit on the row returned from RETURNING', async () => {
    exec.enqueue({ rows: [{ ...baseRow, dailyLimit: '12.00' }] });
    const result = await generalSettingsRepo.update({}, exec);
    expect(result.dailyLimit).toBe(12);
  });
});
