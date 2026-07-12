import { describe, expect, test } from 'bun:test';
import { getTimesheetLoadRequirements } from '../../utils/timesheetLoadRequirements';

describe('getTimesheetLoadRequirements', () => {
  test('does not block RIL on tracker-only catalogs or the global entry stream', () => {
    expect(getTimesheetLoadRequirements('timesheets/ril')).toEqual({
      entries: false,
      clients: false,
      projects: false,
      tasks: false,
      users: true,
    });
  });

  test('keeps the complete tracker preload', () => {
    expect(getTimesheetLoadRequirements('timesheets/tracker')).toEqual({
      entries: true,
      clients: true,
      projects: true,
      tasks: true,
      users: true,
    });
  });

  test('loads only the catalogs used by recurring entries', () => {
    expect(getTimesheetLoadRequirements('timesheets/recurring')).toEqual({
      entries: false,
      clients: true,
      projects: true,
      tasks: true,
      users: false,
    });
  });
});
