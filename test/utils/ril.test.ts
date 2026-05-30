import { describe, expect, test } from 'bun:test';
import type { Project, TimeEntry } from '../../types';
import {
  calculateRilTotals,
  calculateRilWorkedHoursFromTimes,
  generateRilRows,
  getRilMonthBounds,
  makeRilDownloadFilename,
} from '../../utils/ril';

const entry = (overrides: Partial<TimeEntry>): TimeEntry => ({
  id: overrides.id ?? `te-${overrides.date ?? 'x'}-${overrides.projectId ?? 'p1'}`,
  userId: overrides.userId ?? 'u1',
  date: overrides.date ?? '2026-05-04',
  clientId: overrides.clientId ?? 'c1',
  clientName: overrides.clientName ?? 'Client',
  projectId: overrides.projectId ?? 'p1',
  projectName: overrides.projectName ?? 'Project',
  task: overrides.task ?? 'Dev',
  duration: overrides.duration ?? 8,
  createdAt: overrides.createdAt ?? 1,
  version: overrides.version ?? 1,
  location: overrides.location ?? 'remote',
  ...overrides,
});

const project = (overrides: Partial<Project>): Project => ({
  id: overrides.id ?? 'p1',
  name: overrides.name ?? 'Project',
  clientId: overrides.clientId ?? 'c1',
  color: overrides.color ?? '#000000',
  ...overrides,
});

describe('RIL helpers', () => {
  test('tags weekday Italian holidays with F but leaves weekend holidays untagged', () => {
    const mayRows = generateRilRows({
      year: 2026,
      month: 5,
      entries: [],
      locale: 'it',
    });
    expect(mayRows.find((row) => row.day === 1)?.notes).toBe('F');

    const augustRows = generateRilRows({
      year: 2026,
      month: 8,
      entries: [],
      locale: 'it',
    });
    expect(augustRows.find((row) => row.day === 15)?.notes).toBe('');
  });

  test('uses office location text when any entry is not remote', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      locale: 'en',
      entries: [
        entry({ id: 'remote', date: '2026-05-04', duration: 4, location: 'remote' }),
        entry({ id: 'office', date: '2026-05-04', duration: 4, location: 'office' }),
      ],
    });

    expect(rows.find((row) => row.day === 4)?.transfer).toBe('In office');
  });

  test('uses fixed start/end values on every valid weekday and derives hours/PICAP from them', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      lunchBreakMinutes: 60,
      entries: [],
    });
    const row = rows.find((candidate) => candidate.day === 4);

    expect(row?.entrance).toBe('09:00');
    expect(row?.exit).toBe('18:00');
    expect(row?.hours).toBe('8:00');
    expect(row?.picap).toBe(8);
    expect(row?.worked).toBe(true);
  });

  test('leaves weekends and holidays without default times', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      entries: [],
    });

    expect(rows.find((row) => row.day === 1)).toMatchObject({
      entrance: '',
      exit: '',
      hours: '',
      picap: 0,
      notes: 'F',
      worked: false,
    });
    expect(rows.find((row) => row.day === 2)).toMatchObject({
      entrance: '',
      exit: '',
      hours: '',
      picap: 0,
      worked: false,
    });
  });

  test('calculates worked time from entrance and exit values minus lunch pause', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      lunchBreakMinutes: 30,
      entries: [],
    });

    expect(rows.find((row) => row.day === 4)).toMatchObject({
      hours: '8:30',
      hoursDecimal: 8.5,
      picap: 8.5,
    });
  });

  test('subtracts only the lunch-window overlap from edited entrance and exit values', () => {
    expect(calculateRilWorkedHoursFromTimes('09:00', '15:00', 60)).toBe(5);
    expect(calculateRilWorkedHoursFromTimes('09:00', '13:30', 60)).toBe(4);
    expect(calculateRilWorkedHoursFromTimes('09:00', '13:00', 60)).toBe(4);
    expect(calculateRilWorkedHoursFromTimes('14:00', '18:00', 60)).toBe(4);
  });

  test('defaults Commessa to unique order IDs with project-name fallback', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      projects: [
        project({ id: 'p1', name: 'Alpha', orderId: 'ORD-1' }),
        project({ id: 'p2', name: 'Beta' }),
      ],
      entries: [
        entry({ id: 'a', date: '2026-05-06', projectId: 'p1', projectName: 'Alpha' }),
        entry({ id: 'b', date: '2026-05-06', projectId: 'p1', projectName: 'Alpha' }),
        entry({ id: 'c', date: '2026-05-06', projectId: 'p2', projectName: 'Beta' }),
      ],
    });

    expect(rows.find((row) => row.day === 6)?.order).toBe('ORD-1; Beta');
  });

  test('calculates totals and filename', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      entries: [
        entry({ date: '2026-05-04', duration: 8 }),
        entry({ date: '2026-05-05', duration: 4 }),
      ],
    });

    expect(calculateRilTotals(rows)).toMatchObject({
      totalHours: 160,
      totalPicap: 160,
      workedDays: 20,
      workdays: 21,
      holidayWeekdays: 1,
    });
    expect(getRilMonthBounds('2026-05').toDate).toBe('2026-05-31');
    expect(makeRilDownloadFilename(2026, 5, 'User Name')).toBe('RIL_2026_05_User_Name.xlsx');
  });
});
