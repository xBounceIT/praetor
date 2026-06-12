import { describe, expect, test } from 'bun:test';
import type { Project, TimeEntry } from '../../types';
import {
  applyRilDraftToRows,
  calculateRilTotals,
  calculateRilWorkedHoursFromTimes,
  DEFAULT_RIL_NOTE_OPTIONS,
  DEFAULT_RIL_TRANSFER_OPTIONS,
  extractRilDraftRows,
  formatRilLunchWindow,
  generateRilRows,
  getRilMonthBounds,
  isRilAbsenceRow,
  makeRilDownloadFilename,
  normalizeRilNoteOptions,
  normalizeRilTransferOptions,
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

  test('uses configured note and transfer options for generated rows', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      locale: 'en',
      noteOptions: [{ value: 'FEST', label: 'Holiday' }],
      transferOptions: ['Configured office', 'Configured remote'],
      entries: [
        entry({ id: 'remote', date: '2026-05-04', duration: 8, location: 'remote' }),
        entry({ id: 'office', date: '2026-05-05', duration: 8, location: 'office' }),
      ],
    });

    expect(rows.find((row) => row.day === 1)?.notes).toBe('FEST');
    expect(rows.find((row) => row.day === 4)?.transfer).toBe('Configured remote');
    expect(rows.find((row) => row.day === 5)?.transfer).toBe('Configured office');
  });

  test('normalizes RIL option lists with safe defaults', () => {
    expect(normalizeRilNoteOptions([{ value: ' P ', label: ' Paid leave ' }])).toEqual([
      { value: 'P', label: 'Paid leave' },
    ]);
    expect(normalizeRilNoteOptions(null)).toEqual([...DEFAULT_RIL_NOTE_OPTIONS]);
    expect(normalizeRilTransferOptions([' Office ', 'Office', ' Remote '])).toEqual([
      'Office',
      'Remote',
    ]);
    expect(normalizeRilTransferOptions(undefined)).toEqual([...DEFAULT_RIL_TRANSFER_OPTIONS]);
  });

  test('uses configured start/end values on every valid weekday and derives hours/PICAP from them', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      defaultStartTime: '08:30',
      defaultExitTime: '17:30',
      lunchBreakMinutes: 60,
      entries: [],
    });
    const row = rows.find((candidate) => candidate.day === 4);

    expect(row?.entrance).toBe('08:30');
    expect(row?.exit).toBe('17:30');
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

  test('uses tracker totals only for generated overtime days', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      entries: [
        entry({ date: '2026-05-02', duration: 4, location: 'remote' }),
        entry({ date: '2026-05-04', duration: 4, location: 'remote' }),
        entry({ date: '2026-05-05', duration: 9, location: 'office' }),
      ],
    });

    expect(rows.find((row) => row.day === 2)).toMatchObject({
      entrance: '09:00',
      exit: '13:00',
      hours: '4:00',
      hoursDecimal: 4,
      transfer: 'Remote working',
      worked: true,
    });
    expect(rows.find((row) => row.day === 4)).toMatchObject({
      entrance: '09:00',
      exit: '18:00',
      hours: '8:00',
      hoursDecimal: 8,
      transfer: 'Remote working',
      worked: true,
    });
    expect(rows.find((row) => row.day === 5)).toMatchObject({
      entrance: '09:00',
      exit: '19:00',
      hours: '9:00',
      hoursDecimal: 9,
      transfer: 'In office',
      worked: true,
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
    expect(formatRilLunchWindow(90)).toBe('13:00-14:30');
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
      workdays: 20,
      holidayWeekdays: 1,
    });
    expect(getRilMonthBounds('2026-05').toDate).toBe('2026-05-31');
    expect(makeRilDownloadFilename(2026, 5, 'User Name')).toBe('RIL_2026_05_User_Name.xlsx');
  });

  test('excludes absence-note workdays from worked totals', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      entries: [],
    }).map((row) => (row.day === 4 ? { ...row, notes: 'P' } : row));

    const absenceRow = rows.find((row) => row.day === 4);

    expect(absenceRow).toBeDefined();
    expect(absenceRow ? isRilAbsenceRow(absenceRow) : false).toBe(true);
    expect(calculateRilTotals(rows)).toMatchObject({
      totalHours: 152,
      totalPicap: 152,
      workedDays: 19,
      workdays: 20,
    });
  });

  test('ignores non-month placeholder rows in totals', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 2,
      entries: [],
    }).map((row) =>
      row.day === 30
        ? {
            ...row,
            entrance: '09:00',
            exit: '18:00',
            hours: '8:00',
            hoursDecimal: 8,
            picap: 8,
            transfer: 'Remote working',
            worked: true,
          }
        : row,
    );

    expect(calculateRilTotals(rows)).toMatchObject({
      totalHours: 160,
      totalPicap: 160,
      workedDays: 20,
      workdays: 20,
    });
  });
});

describe('generateRilRows weekdayTransferDefaults', () => {
  // May 2026: 4=Mon, 5=Tue, 6=Wed, 7=Thu, 8=Fri; 1=Fri holiday; 2=Sat, 3=Sun weekends.
  test('applies the per-weekday default on matching valid weekdays', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      locale: 'en',
      entries: [],
      weekdayTransferDefaults: { monday: 'WFH' },
    });

    // Both Mondays in May 2026 (4 and 11) get the configured value.
    expect(rows.find((row) => row.day === 4)?.transfer).toBe('WFH');
    expect(rows.find((row) => row.day === 11)?.transfer).toBe('WFH');
  });

  test('takes precedence over the entry-location-derived value on the configured weekday', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      locale: 'en',
      weekdayTransferDefaults: { monday: 'WFH' },
      entries: [
        // Monday with an in-office entry would otherwise derive "In office".
        entry({ id: 'office', date: '2026-05-04', duration: 8, location: 'office' }),
      ],
    });

    expect(rows.find((row) => row.day === 4)?.transfer).toBe('WFH');
  });

  test('does not apply the default on weekends or holidays', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      locale: 'en',
      entries: [],
      // Configure every weekday name including ones that fall on the holiday/weekend.
      weekdayTransferDefaults: {
        friday: 'WFH-FRI',
        saturday: 'WFH-SAT',
        sunday: 'WFH-SUN',
      },
    });

    // May 1 is a Friday holiday: the friday default must not leak onto it.
    expect(rows.find((row) => row.day === 1)?.isHoliday).toBe(true);
    expect(rows.find((row) => row.day === 1)?.transfer).toBe('');
    // May 2 (Sat) and May 3 (Sun) are weekends: never get a transfer default.
    expect(rows.find((row) => row.day === 2)?.transfer).toBe('');
    expect(rows.find((row) => row.day === 3)?.transfer).toBe('');
    // A non-holiday Friday (May 8) still receives the configured friday default.
    expect(rows.find((row) => row.day === 8)?.transfer).toBe('WFH-FRI');
  });

  test('falls back to entry-derived logic on weekdays without a configured default', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      locale: 'en',
      // Only Monday is configured; Tuesday/Wednesday must use the legacy derived value.
      weekdayTransferDefaults: { monday: 'WFH' },
      entries: [
        entry({ id: 'tue-office', date: '2026-05-05', duration: 8, location: 'office' }),
        entry({ id: 'wed-remote', date: '2026-05-06', duration: 8, location: 'remote' }),
      ],
    });

    expect(rows.find((row) => row.day === 4)?.transfer).toBe('WFH');
    expect(rows.find((row) => row.day === 5)?.transfer).toBe('In office');
    expect(rows.find((row) => row.day === 6)?.transfer).toBe('Remote working');
    // A weekday with no entries and no default stays blank.
    expect(rows.find((row) => row.day === 7)?.transfer).toBe('');
  });
});

describe('applyRilDraftToRows / extractRilDraftRows', () => {
  const baseRows = () =>
    generateRilRows({
      year: 2026,
      month: 5,
      locale: 'en',
      entries: [],
      lunchBreakMinutes: 60,
    });

  test('applies saved fields onto matching editable rows and recomputes worked hours', () => {
    const rows = baseRows();
    const draft = {
      // May 4 is a Monday workday.
      '4': {
        entrance: '08:00',
        exit: '13:00',
        notes: '',
        transfer: 'Remote working',
        code: 'X1',
      },
    };

    const applied = applyRilDraftToRows(rows, draft, 60);
    const day4 = applied.find((row) => row.day === 4);

    expect(day4).toMatchObject({
      entrance: '08:00',
      exit: '13:00',
      transfer: 'Remote working',
      code: 'X1',
      // 08:00-13:00 = 5h, lunch window 13:00-14:00 has no overlap -> 5h worked.
      hours: '5:00',
      hoursDecimal: 5,
      picap: 5,
      worked: true,
    });
  });

  test('clears time/hours/transfer and unsets worked for an absence draft', () => {
    const rows = baseRows();
    const draft = {
      // Absence note on a valid Monday workday.
      '4': {
        entrance: '09:00',
        exit: '18:00',
        notes: 'P',
        transfer: 'Remote working',
        code: '',
      },
    };

    const applied = applyRilDraftToRows(rows, draft, 60);
    const day4 = applied.find((row) => row.day === 4);

    expect(day4).toMatchObject({
      notes: 'P',
      entrance: '',
      exit: '',
      hours: '',
      hoursDecimal: 0,
      picap: 0,
      transfer: '',
      worked: false,
    });
    expect(day4 ? isRilAbsenceRow(day4) : false).toBe(true);
  });

  test('leaves rows whose day is absent from the draft untouched', () => {
    const rows = baseRows();
    const day5Before = rows.find((row) => row.day === 5);
    const draft = {
      '4': { entrance: '08:00', exit: '13:00', notes: '', transfer: 'Remote working', code: '' },
    };

    const applied = applyRilDraftToRows(rows, draft, 60);
    const day5After = applied.find((row) => row.day === 5);

    expect(day5After).toEqual(day5Before);
  });

  test('applies saved fields to dated holiday rows', () => {
    const rows = baseRows();
    const draft = {
      '1': { entrance: '08:00', exit: '17:00', notes: '', transfer: 'Remote working', code: 'Z' },
    };

    const applied = applyRilDraftToRows(rows, draft, 60);

    expect(applied.find((row) => row.day === 1)).toMatchObject({
      isHoliday: true,
      entrance: '08:00',
      exit: '17:00',
      hours: '8:00',
      hoursDecimal: 8,
      picap: 8,
      notes: '',
      transfer: 'Remote working',
      code: 'Z',
      worked: true,
    });
  });

  test('keeps worked holiday rows with the prefilled holiday note in attendance totals', () => {
    const rows = baseRows();
    const draft = {
      '1': { entrance: '08:00', exit: '17:00', notes: 'F', transfer: 'Remote working', code: 'Z' },
    };

    const applied = applyRilDraftToRows(rows, draft, 60);
    const day1 = applied.find((row) => row.day === 1);

    expect(day1).toMatchObject({
      isHoliday: true,
      entrance: '08:00',
      exit: '17:00',
      hours: '8:00',
      hoursDecimal: 8,
      picap: 8,
      notes: 'F',
      transfer: 'Remote working',
      code: 'Z',
      worked: true,
    });
    expect(day1 ? isRilAbsenceRow(day1) : true).toBe(false);
    expect(calculateRilTotals(applied)).toMatchObject({
      totalHours: 168,
      totalPicap: 168,
      workedDays: 21,
      workdays: 21,
      holidayWeekdays: 1,
    });
  });

  test('returns rows unchanged when the draft is null or empty', () => {
    const rows = baseRows();

    expect(applyRilDraftToRows(rows, null, 60)).toBe(rows);
    expect(applyRilDraftToRows(rows, undefined, 60)).toBe(rows);
    expect(applyRilDraftToRows(rows, {}, 60)).toBe(rows);
  });

  test('extractRilDraftRows keys editable rows by day with only the five editable fields', () => {
    const rows = baseRows();
    const draft = extractRilDraftRows(rows);

    // Dated holidays are editable/draftable; non-month placeholder rows are excluded.
    expect(draft['1']).toEqual({
      entrance: '',
      exit: '',
      notes: 'F',
      transfer: '',
      code: '',
    });
    expect(draft['4']).toEqual({
      entrance: rows.find((row) => row.day === 4)?.entrance ?? '',
      exit: rows.find((row) => row.day === 4)?.exit ?? '',
      notes: '',
      transfer: '',
      code: '',
    });
    const februaryDraft = extractRilDraftRows(
      generateRilRows({ year: 2026, month: 2, locale: 'en', entries: [] }),
    );
    expect(februaryDraft['30']).toBeUndefined();
    // Each captured entry exposes exactly the five editable fields, nothing else.
    for (const fields of Object.values(draft)) {
      expect(Object.keys(fields).sort()).toEqual(['code', 'entrance', 'exit', 'notes', 'transfer']);
    }
  });

  test('extractRilDraftRows round-trips through applyRilDraftToRows for edited rows', () => {
    const rows = baseRows().map((row) =>
      row.day === 4
        ? { ...row, entrance: '08:00', exit: '13:00', transfer: 'Remote working', code: 'RT1' }
        : row,
    );

    const draft = extractRilDraftRows(rows);
    const applied = applyRilDraftToRows(baseRows(), draft, 60);
    const day4 = applied.find((row) => row.day === 4);

    expect(day4).toMatchObject({
      entrance: '08:00',
      exit: '13:00',
      transfer: 'Remote working',
      code: 'RT1',
      hoursDecimal: 5,
    });
  });
});
