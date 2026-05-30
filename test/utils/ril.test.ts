import { describe, expect, test } from 'bun:test';
import type { Project, TimeEntry } from '../../types';
import {
  calculateRilTotals,
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

  test('uses fixed start/end values while deriving hours and PICAP from duration', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      defaultStartTime: '08:30',
      lunchBreakMinutes: 60,
      entries: [entry({ date: '2026-05-04', duration: 7.62 })],
    });
    const row = rows.find((candidate) => candidate.day === 4);

    expect(row?.entrance).toBe('09:00');
    expect(row?.exit).toBe('18:00');
    expect(row?.hours).toBe('7:37');
    expect(row?.picap).toBe(7.5);
  });

  test('keeps fixed exit time when duration is 6 hours or less', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      defaultStartTime: '09:00',
      lunchBreakMinutes: 60,
      entries: [entry({ date: '2026-05-05', duration: 6 })],
    });

    expect(rows.find((row) => row.day === 5)?.exit).toBe('18:00');
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
      totalHours: 12,
      totalPicap: 12,
      workedDays: 2,
      workdays: 21,
      holidayWeekdays: 1,
    });
    expect(getRilMonthBounds('2026-05').toDate).toBe('2026-05-31');
    expect(makeRilDownloadFilename(2026, 5, 'User Name')).toBe('RIL_2026_05_User_Name.xlsx');
  });
});
