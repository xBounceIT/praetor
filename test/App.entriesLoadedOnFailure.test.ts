import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-text contract test for issue #620 — locks both the success-path and
// failure-path setEntriesLoaded(true) flips inside the timesheets module-load
// case closure. Same style as App.streamRemainingEntries.test.ts and
// App.moduleLoadCancellation.test.ts.
describe('App.tsx entriesLoaded recovery on entries fetch failure (#620)', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');

  // Scope to the timesheets case body in the module-loading effect.
  const caseStart = source.indexOf("case 'timesheets': {");
  const caseEnd = source.indexOf("case 'hr': {", caseStart);

  test('locates the timesheets case in the module-loading effect', () => {
    expect(caseStart).toBeGreaterThan(-1);
    expect(caseEnd).toBeGreaterThan(caseStart);
  });

  const caseBody = source.slice(caseStart, caseEnd);

  test('flips entriesLoaded=true when the entries dataset is in the failure list', () => {
    expect(caseBody).toMatch(
      /if\s*\(\s*failedDatasets\.includes\(\s*['"]entries['"]\s*\)\s*\)\s*\{\s*setEntriesLoaded\(true\);\s*\}/,
    );
  });

  test('still flips entriesLoaded=true on the success-path apply (existing contract)', () => {
    expect(caseBody).toContain('setEntriesLoaded(true);');
    // Both branches present: at minimum two occurrences inside this case body.
    const occurrences = caseBody.match(/setEntriesLoaded\(true\)/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});
