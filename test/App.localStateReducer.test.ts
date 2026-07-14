import { describe, expect, test } from 'bun:test';

const appSource = await Bun.file(new URL('../App.tsx', import.meta.url)).text();

const reducerStart = appSource.indexOf('const appLocalStateReducer =');
const reducerEnd = appSource.indexOf('\n};', reducerStart);
const reducerSource = appSource.slice(reducerStart, reducerEnd);

describe('App.tsx appLocalStateReducer', () => {
  test('checks the action discriminator before reading keyed set fields', () => {
    expect(reducerStart).toBeGreaterThan(-1);
    expect(reducerEnd).toBeGreaterThan(reducerStart);

    const discriminatorIndex = reducerSource.indexOf(
      "const actionType: AppLocalStateAction['type'] = action.type;",
    );
    const switchIndex = reducerSource.indexOf('switch (actionType)');
    const setCaseIndex = reducerSource.indexOf("case 'set':");
    const keyReadIndex = reducerSource.indexOf('state[action.key]');

    expect(discriminatorIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(discriminatorIndex);
    expect(setCaseIndex).toBeGreaterThan(switchIndex);
    expect(keyReadIndex).toBeGreaterThan(setCaseIndex);
  });

  test('rejects unhandled runtime action types with a compile-time exhaustive branch', () => {
    expect(reducerSource).toContain('const unhandledActionType: never = actionType;');
    expect(reducerSource).toContain('Unsupported app local state action');
  });
});
