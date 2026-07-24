import { describe, expect, test } from 'bun:test';

import {
  isProjectStatus,
  isProjectStatusBlockingTimeEntries,
  PROJECT_STATUSES,
} from '../../utils/projectStatus.ts';

describe('projectStatus', () => {
  test('includes perpetuo among known statuses', () => {
    expect(PROJECT_STATUSES).toContain('perpetuo');
    expect(isProjectStatus('perpetuo')).toBe(true);
  });

  test('does not block time entries for perpetuo', () => {
    expect(isProjectStatusBlockingTimeEntries('perpetuo')).toBe(false);
    expect(isProjectStatusBlockingTimeEntries('in_corso')).toBe(false);
    expect(isProjectStatusBlockingTimeEntries('in_pausa')).toBe(true);
    expect(isProjectStatusBlockingTimeEntries('terminato')).toBe(true);
  });
});
