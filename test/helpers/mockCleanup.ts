import { afterAll, mock } from 'bun:test';

// Reset spies after this test file. Bun does not undo top-level `mock.module(...)`
// replacements here. Frontend tests with overlapping module mocks run in a
// separate Bun process so their replacements cannot leak into the shared suite.
export const clearSpyStateAfterAll = () => {
  afterAll(() => {
    mock.restore();
    mock.clearAllMocks();
  });
};
