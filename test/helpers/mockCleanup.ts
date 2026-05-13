import { afterAll, mock } from 'bun:test';

// Registers an afterAll hook that runs Bun's spy/mock cleanup after the calling test
// file's tests finish. Use this when a test file installs top-level `mock.module(...)`
// or top-level spies — Bun's docs note that `mock.restore()` does not undo
// `mock.module()` overrides, but combined with `mock.clearAllMocks()` it resets spy
// state and call history so adjacent test files start with a clean slate.
//
// Why a helper instead of inlining the two lines: the pattern is repeated across ~27
// frontend test files. Centralizing makes the intent searchable and means future Bun
// API changes (e.g. a real module-restore primitive) need updating in only one place.
export const registerMockCleanup = () => {
  afterAll(() => {
    mock.restore();
    mock.clearAllMocks();
  });
};
