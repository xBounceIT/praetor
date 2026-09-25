import { afterAll, mock } from 'bun:test';

// Reset spies after this test file. Bun does not undo top-level `mock.module(...)`
// replacements here, so the frontend test script runs with `--isolate` to keep
// those replacements from leaking into other files.
export const clearSpyStateAfterAll = () => {
  afterAll(() => {
    mock.restore();
    mock.clearAllMocks();
  });
};
