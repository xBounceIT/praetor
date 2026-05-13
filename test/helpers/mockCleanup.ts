import { afterAll, mock } from 'bun:test';

// Registers an `afterAll` hook that resets the spy state of every `mock()` and
// `spyOn(...)` instance created during the test file. **This does not undo top-level
// `mock.module(...)` overrides** — per Bun's docs, `mock.restore()` and
// `mock.clearAllMocks()` only reset spies, not module replacements. The module override
// remains active after `afterAll`, so adjacent test files that later `import` the same
// path can still observe this file's mock.
//
// True file-to-file isolation for `mock.module` would require installing the mock
// inside `beforeAll` (so the real module can be captured first and restored in
// `afterAll`). The frontend tests in this repo install mocks at top level and
// top-await-import the SUT — that ordering is what makes the mock active during SUT
// evaluation, and moving both into `beforeAll` introduces module-cache races (Bun
// doesn't invalidate already-loaded module entries when `mock.module` is later called).
// Until Bun ships a primitive that does invalidate, the leak surface is real but
// has not produced an actual cross-file failure in this codebase — every file that
// shares a mocked path also installs its own factory, so the "last write wins"
// behavior is what each test relies on.
//
// What this helper still buys: spy call histories don't accumulate across files,
// which keeps `toHaveBeenCalledTimes` assertions accurate even when a leaked module
// mock is reused.
export const clearSpyStateAfterAll = () => {
  afterAll(() => {
    mock.restore();
    mock.clearAllMocks();
  });
};
