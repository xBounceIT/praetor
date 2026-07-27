import { describe, expect, test } from 'bun:test';

import {
  isProjectEndDateRequired,
  isProjectExpiredForTimeEntries,
  isProjectStartDateRequired,
  isProjectStatus,
  isProjectStatusBlockingTimeEntries,
  isProjectStatusExemptFromExpiry,
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

  test('exempts perpetuo from expiry even with a past endDate', () => {
    expect(isProjectStatusExemptFromExpiry('perpetuo')).toBe(true);
    expect(isProjectStatusExemptFromExpiry('in_corso')).toBe(false);
    expect(isProjectExpiredForTimeEntries({ endDate: '2000-01-01', status: 'perpetuo' })).toBe(
      false,
    );
    expect(isProjectExpiredForTimeEntries({ endDate: '2000-01-01', status: 'in_corso' })).toBe(
      true,
    );
  });

  test('requires endDate for commercial non-perpetuo projects only', () => {
    expect(isProjectEndDateRequired({ tipo: 'attivo', status: 'in_corso' })).toBe(true);
    expect(isProjectEndDateRequired({ tipo: 'attivo', status: 'perpetuo' })).toBe(false);
    expect(isProjectEndDateRequired({ tipo: 'interno', status: 'in_corso' })).toBe(false);
    expect(isProjectStartDateRequired({ tipo: 'attivo' })).toBe(true);
    expect(isProjectStartDateRequired({ tipo: 'interno' })).toBe(false);
  });
});
