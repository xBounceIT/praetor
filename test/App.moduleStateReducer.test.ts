import { describe, expect, test } from 'bun:test';

const source = await Bun.file(new URL('../App.tsx', import.meta.url)).text();

describe('App module state reducer', () => {
  test('preserves state for unknown runtime actions (issue #914)', () => {
    const reducerStart = source.indexOf('const appModuleStateReducer = (');
    expect(reducerStart).toBeGreaterThan(-1);

    const reducerEnd = source.indexOf('\n};', reducerStart);
    expect(reducerEnd).toBeGreaterThan(reducerStart);

    const reducerSource = source.slice(reducerStart, reducerEnd);
    expect(reducerSource).toMatch(/default:\s+return state;/);
  });
});
