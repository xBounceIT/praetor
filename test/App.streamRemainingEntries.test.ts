import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pin the streamRemainingEntries contract introduced for issue #512:
//   - listPage calls go through the shared retryTransient helper
//     (which handles backoff + 4xx short-circuit + cancellation)
//   - persistent failures surface via appendFailure + toastError
//   - cancellation (stale token / stale module load) bails silently
//
// The function is locally scoped inside the timesheets case block, so this is
// a source-text contract test rather than a behavioral one.
describe('App.tsx streamRemainingEntries', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');
  const start = source.indexOf('const streamRemainingEntries = async');
  const end = source.indexOf('failedDatasets = await loadDatasets(', start);
  const body = source.slice(start, end);

  test('locates the streamRemainingEntries function', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  test('delegates retry/backoff to the shared retryTransient helper', () => {
    expect(body).toContain('retryTransient(');
    expect(body).toContain('isCancelled');
  });

  test('appends a module failure and toasts on persistent failure', () => {
    expect(body).toContain("appendFailure(module, 'additional entries');");
    expect(body).toMatch(/toastError\(\s*['"]Some time entries could not be loaded/);
  });

  test('still logs to console on persistent failure for diagnostics', () => {
    expect(body).toContain("console.error('Failed to stream remaining entries:'");
  });

  test('bails out silently on cancellation (retryTransient returns null)', () => {
    expect(body).toContain('if (result === null) return;');
  });
});
