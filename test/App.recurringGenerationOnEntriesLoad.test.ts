import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-text contract test for issue #620: recurring generation must still run after
// the timesheet entries dataset either resolves or fails. It no longer needs a separate
// entriesLoaded state flag because generation is server-side and idempotent.
describe('App.tsx recurring generation after entries load (#620)', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');

  const caseStart = source.indexOf("case 'timesheets': {");
  const caseEnd = source.indexOf("case 'hr': {", caseStart);

  test('locates the timesheets case in the module-loading effect', () => {
    expect(caseStart).toBeGreaterThan(-1);
    expect(caseEnd).toBeGreaterThan(caseStart);
  });

  const caseBody = source.slice(caseStart, caseEnd);

  test('runs recurring generation when the entries dataset fails', () => {
    expect(caseBody).toMatch(
      /if\s*\(\s*failedDatasets\.includes\(\s*['"]entries['"]\s*\)\s*\)\s*\{\s*void\s+generateRecurringEntries\(\);\s*\}/,
    );
  });

  test('runs recurring generation on the success-path apply', () => {
    expect(caseBody).toContain('void generateRecurringEntries();');
    const occurrences = caseBody.match(/void\s+generateRecurringEntries\(\)/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});
