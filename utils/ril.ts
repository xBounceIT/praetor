import type { Project, RilNoteOption, TimeEntry } from '../types';
import { dateOnlyStringToLocalDate, getLocalDateString } from './date';
import { isItalianHoliday } from './holidays';

export type RilLocale = 'en' | 'it';

// Lowercase English weekday names, keyed by JS `Date.getDay()` (0=Sun..6=Sat). Used to look up
// the per-weekday default "Trasferta" preference when generating rows.
const RIL_WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

// The five user-editable RIL fields persisted in a draft (computed fields are re-derived).
export type RilDraftRowFields = Pick<RilRow, 'entrance' | 'exit' | 'notes' | 'transfer' | 'code'>;
// Draft rows keyed by day-of-month (stringified 1..31); sparse.
export type RilDraftRowsMap = Record<string, RilDraftRowFields>;

export interface RilGenerationOptions {
  year: number;
  month: number;
  entries: TimeEntry[];
  projects?: Project[];
  defaultStartTime?: string;
  defaultExitTime?: string;
  lunchBreakMinutes?: number;
  locale?: RilLocale;
  noteOptions?: readonly RilNoteOption[];
  transferOptions?: readonly string[];
  // Per-weekday default "Trasferta" value (keys: 'monday'..'friday'). When set for a weekday it
  // pre-fills that day's transfer, taking precedence over the entry-location-derived default.
  weekdayTransferDefaults?: Record<string, string>;
}

export interface RilMonthBounds {
  year: number;
  month: number;
  monthKey: string;
  fromDate: string;
  toDate: string;
  daysInMonth: number;
}

export interface RilRow {
  day: number;
  date: string;
  weekday: string;
  entrance: string;
  exit: string;
  hours: string;
  hoursDecimal: number;
  picap: number;
  phoneAvailability: string;
  notes: string;
  transfer: string;
  code: string;
  order: string;
  isHoliday: boolean;
  isWorkday: boolean;
  worked: boolean;
}

export interface RilTotals {
  totalHours: number;
  totalPicap: number;
  workedDays: number;
  workdays: number;
  holidayWeekdays: number;
}

export const RIL_VISIBLE_HEADERS = [
  'Giorno',
  'Entrata',
  'Uscita',
  'Ore',
  'PICAP',
  'Reperib. Telef.',
  'Note',
  'Trasferta',
  'Cod',
  'Commessa',
] as const;

const TIME_OF_DAY_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const RIL_LOCATION_LABELS: Record<RilLocale, { office: string; remote: string }> = {
  en: { office: 'In office', remote: 'Remote working' },
  it: { office: 'In sede', remote: 'Telelavoro' },
};

export const DEFAULT_RIL_NOTE_OPTIONS: readonly RilNoteOption[] = [
  { value: 'P', label: 'Ferie' },
  { value: 'P2', label: 'Permesso' },
  { value: 'M', label: 'Malattia' },
  { value: 'F', label: 'Festivita' },
] as const;

export const DEFAULT_RIL_TRANSFER_OPTIONS: readonly string[] = ['In sede', 'Telelavoro'] as const;

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });
export const DEFAULT_RIL_START_TIME = '09:00';
export const DEFAULT_RIL_EXIT_TIME = '18:00';
const DEFAULT_LUNCH_BREAK_MINUTES = 60;
export const RIL_LUNCH_BREAK_START_MINUTES = 13 * 60;

const isValidRilStartTime = (value: string | undefined | null): value is string =>
  typeof value === 'string' && TIME_OF_DAY_PATTERN.test(value);

export const getRilMonthBounds = (monthKey: string): RilMonthBounds => {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) throw new Error('monthKey must be in YYYY-MM format');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error('monthKey month must be between 01 and 12');
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    year,
    month,
    monthKey,
    fromDate: `${monthKey}-01`,
    toDate: `${monthKey}-${String(daysInMonth).padStart(2, '0')}`,
    daysInMonth,
  };
};

export const getCurrentRilMonthKey = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const parseRilTimeToMinutes = (value: string): number => {
  if (!isValidRilStartTime(value)) return 0;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const normalizeLunchBreakMinutes = (value: number | undefined): number => {
  const parsed = Number(value ?? DEFAULT_LUNCH_BREAK_MINUTES);
  if (!Number.isFinite(parsed)) return DEFAULT_LUNCH_BREAK_MINUTES;
  return Math.min(240, Math.max(0, Math.round(parsed)));
};

export const normalizeRilNoteOptions = (
  value: unknown,
  fallback: readonly RilNoteOption[] = DEFAULT_RIL_NOTE_OPTIONS,
): RilNoteOption[] => {
  const source = Array.isArray(value) ? value : [];
  const options: RilNoteOption[] = [];
  const seen = new Set<string>();

  for (const entry of source) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const candidate = entry as Partial<RilNoteOption>;
    const optionValue = typeof candidate.value === 'string' ? candidate.value.trim() : '';
    if (!optionValue || seen.has(optionValue)) continue;
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    options.push({ value: optionValue, label: label || optionValue });
    seen.add(optionValue);
  }

  return options.length > 0 ? options : fallback.map((option) => ({ ...option }));
};

export const normalizeRilTransferOptions = (
  value: unknown,
  fallback: readonly string[] = DEFAULT_RIL_TRANSFER_OPTIONS,
): string[] => {
  const source = Array.isArray(value) ? value : [];
  const options: string[] = [];
  const seen = new Set<string>();

  for (const entry of source) {
    const optionValue =
      typeof entry === 'string'
        ? entry.trim()
        : entry && typeof entry === 'object' && !Array.isArray(entry)
          ? String((entry as { value?: unknown }).value ?? '').trim()
          : '';
    if (!optionValue || seen.has(optionValue)) continue;
    options.push(optionValue);
    seen.add(optionValue);
  }

  return options.length > 0 ? options : [...fallback];
};

const calculateRilLunchOverlapMinutes = (
  startMinutes: number,
  exitMinutes: number,
  lunchBreakMinutes: number | undefined,
): number => {
  const lunchMinutes = normalizeLunchBreakMinutes(lunchBreakMinutes);
  if (lunchMinutes <= 0) return 0;

  const lunchStartMinutes = RIL_LUNCH_BREAK_START_MINUTES;
  const lunchEndMinutes = lunchStartMinutes + lunchMinutes;
  return Math.max(
    0,
    Math.min(exitMinutes, lunchEndMinutes) - Math.max(startMinutes, lunchStartMinutes),
  );
};

export const calculateRilWorkedHoursFromTimes = (
  entrance: string,
  exit: string,
  lunchBreakMinutes = DEFAULT_LUNCH_BREAK_MINUTES,
): number => {
  if (!isValidRilStartTime(entrance) || !isValidRilStartTime(exit)) return 0;

  const startMinutes = parseRilTimeToMinutes(entrance);
  const exitMinutes = parseRilTimeToMinutes(exit);
  if (exitMinutes <= startMinutes) return 0;

  const elapsedMinutes = exitMinutes - startMinutes;
  const lunchMinutes = calculateRilLunchOverlapMinutes(
    startMinutes,
    exitMinutes,
    lunchBreakMinutes,
  );
  return Math.max(0, (elapsedMinutes - lunchMinutes) / 60);
};

const formatRilMinutesAsClock = (minutes: number): string => {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

export const formatRilLunchWindow = (lunchBreakMinutes = DEFAULT_LUNCH_BREAK_MINUTES): string => {
  const lunchMinutes = normalizeLunchBreakMinutes(lunchBreakMinutes);
  return `${formatRilMinutesAsClock(RIL_LUNCH_BREAK_START_MINUTES)}-${formatRilMinutesAsClock(
    RIL_LUNCH_BREAK_START_MINUTES + lunchMinutes,
  )}`;
};

export const formatRilHoursAsDuration = (hours: number): string => {
  if (hours <= 0) return '';
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
};

export const roundRilPicapHours = (hours: number): number => Math.round(hours * 4) / 4;

const getProjectCode = (entry: TimeEntry, projectById: Map<string, Project>): string => {
  const project = projectById.get(entry.projectId);
  const orderId = project?.orderId?.trim();
  return orderId || entry.projectName || project?.name || '';
};

export const createEmptyRilRow = (day: number): RilRow => ({
  day,
  date: '',
  weekday: '',
  entrance: '',
  exit: '',
  hours: '',
  hoursDecimal: 0,
  picap: 0,
  phoneAvailability: '',
  notes: '',
  transfer: '',
  code: '',
  order: '',
  isHoliday: false,
  isWorkday: false,
  worked: false,
});

export const generateRilRows = ({
  year,
  month,
  entries,
  projects = [],
  defaultStartTime = DEFAULT_RIL_START_TIME,
  defaultExitTime = DEFAULT_RIL_EXIT_TIME,
  lunchBreakMinutes = DEFAULT_LUNCH_BREAK_MINUTES,
  locale = 'en',
  noteOptions,
  transferOptions,
  weekdayTransferDefaults,
}: RilGenerationOptions): RilRow[] => {
  const daysInMonth = new Date(year, month, 0).getDate();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const entriesByDate = new Map<string, TimeEntry[]>();
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const normalizedNoteOptions = normalizeRilNoteOptions(noteOptions);
  const holidayNoteValue =
    normalizedNoteOptions.find((option) => option.value.toUpperCase() === 'F')?.value ??
    normalizedNoteOptions.find((option) => option.value.toUpperCase().startsWith('F'))?.value ??
    'F';
  const localizedTransferFallback = [
    RIL_LOCATION_LABELS[locale].office,
    RIL_LOCATION_LABELS[locale].remote,
  ];
  const normalizedTransferOptions = normalizeRilTransferOptions(
    transferOptions,
    localizedTransferFallback,
  );
  const officeTransferValue = normalizedTransferOptions[0] ?? RIL_LOCATION_LABELS[locale].office;
  const remoteTransferValue =
    normalizedTransferOptions[1] ??
    normalizedTransferOptions[0] ??
    RIL_LOCATION_LABELS[locale].remote;
  const entranceValue = isValidRilStartTime(defaultStartTime)
    ? defaultStartTime
    : DEFAULT_RIL_START_TIME;
  const exitValue = isValidRilStartTime(defaultExitTime) ? defaultExitTime : DEFAULT_RIL_EXIT_TIME;

  for (const entry of entries) {
    if (!entry.date.startsWith(monthPrefix)) continue;
    const grouped = entriesByDate.get(entry.date);
    if (grouped) grouped.push(entry);
    else entriesByDate.set(entry.date, [entry]);
  }

  return Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    if (day > daysInMonth) return createEmptyRilRow(day);

    const date = getLocalDateString(new Date(year, month - 1, day));
    const dateObj = dateOnlyStringToLocalDate(date);
    const dayOfWeek = dateObj.getDay();
    const isWorkday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isHoliday = isWorkday && isItalianHoliday(dateObj) !== null;
    const isValidWorkday = isWorkday && !isHoliday;
    const dayEntries = entriesByDate.get(date) ?? [];
    const hoursDecimal = isValidWorkday
      ? calculateRilWorkedHoursFromTimes(entranceValue, exitValue, lunchBreakMinutes)
      : 0;
    const worked = hoursDecimal > 0;
    const uniqueProjects = new Set<string>();
    for (const entry of dayEntries) {
      const code = getProjectCode(entry, projectById);
      if (code) uniqueProjects.add(code);
    }
    const allRemote =
      dayEntries.length > 0 &&
      dayEntries.every((entry) => (entry.location ?? 'remote') === 'remote');
    // The user's per-weekday default takes precedence on fillable days; otherwise fall back to the
    // location derived from that day's entries (unchanged legacy behavior).
    const weekdayDefaultTransfer = isValidWorkday
      ? (weekdayTransferDefaults?.[RIL_WEEKDAY_NAMES[dayOfWeek]] ?? '').trim()
      : '';
    const derivedTransfer =
      dayEntries.length > 0 ? (allRemote ? remoteTransferValue : officeTransferValue) : '';

    return {
      day,
      date,
      weekday: WEEKDAY_FORMATTER.format(dateObj),
      entrance: isValidWorkday ? entranceValue : '',
      exit: isValidWorkday ? exitValue : '',
      hours: formatRilHoursAsDuration(hoursDecimal),
      hoursDecimal,
      picap: worked ? roundRilPicapHours(hoursDecimal) : 0,
      phoneAvailability: '',
      notes: isHoliday ? holidayNoteValue : '',
      transfer: weekdayDefaultTransfer || derivedTransfer,
      code: '',
      order: Array.from(uniqueProjects).join('; '),
      isHoliday,
      isWorkday,
      worked,
    };
  });
};

export const isRequiredRilWorkday = (row: RilRow): boolean =>
  Boolean(row.date && row.isWorkday && !row.isHoliday);

export const isRilAbsenceRow = (row: RilRow): boolean =>
  isRequiredRilWorkday(row) && row.notes.trim().length > 0;

// Only dated, non-holiday rows are editable (mirrors RilView's canEditRilRow); holiday/weekend
// placeholder rows are read-only and never carry a draft.
const isDraftableRilRow = (row: RilRow): boolean => Boolean(row.date && !row.isHoliday);

// Re-derive hours/PICAP/worked (and clear time fields for absence rows) after applying stored
// editable fields. Mirrors the per-field logic in RilView's updateRow so a hydrated draft matches
// what live editing would have produced.
const recomputeRilRow = (row: RilRow, lunchBreakMinutes: number): RilRow => {
  if (isRilAbsenceRow(row)) {
    return {
      ...row,
      entrance: '',
      exit: '',
      hours: '',
      hoursDecimal: 0,
      picap: 0,
      transfer: '',
      worked: false,
    };
  }
  const hoursDecimal = calculateRilWorkedHoursFromTimes(row.entrance, row.exit, lunchBreakMinutes);
  return {
    ...row,
    hours: formatRilHoursAsDuration(hoursDecimal),
    hoursDecimal,
    picap: hoursDecimal > 0 ? roundRilPicapHours(hoursDecimal) : 0,
    worked: hoursDecimal > 0,
  };
};

// Merge a saved draft onto freshly-generated rows: apply the five editable fields for each
// editable day, then re-derive computed fields. Non-editable rows and days absent from the draft
// are left untouched.
export const applyRilDraftToRows = (
  rows: RilRow[],
  draftRows: RilDraftRowsMap | null | undefined,
  lunchBreakMinutes: number = DEFAULT_LUNCH_BREAK_MINUTES,
): RilRow[] => {
  if (!draftRows || Object.keys(draftRows).length === 0) return rows;
  return rows.map((row) => {
    if (!isDraftableRilRow(row)) return row;
    const saved = draftRows[String(row.day)];
    if (!saved) return row;
    const merged: RilRow = {
      ...row,
      entrance: saved.entrance ?? row.entrance,
      exit: saved.exit ?? row.exit,
      notes: saved.notes ?? row.notes,
      transfer: saved.transfer ?? row.transfer,
      code: saved.code ?? row.code,
    };
    return recomputeRilRow(merged, lunchBreakMinutes);
  });
};

// Snapshot the editable fields of every editable row for persistence. Stores the full month so a
// reload reproduces exactly what the user saw; non-editable rows are skipped.
export const extractRilDraftRows = (rows: RilRow[]): RilDraftRowsMap => {
  const out: RilDraftRowsMap = {};
  for (const row of rows) {
    if (!isDraftableRilRow(row)) continue;
    out[String(row.day)] = {
      entrance: row.entrance,
      exit: row.exit,
      notes: row.notes,
      transfer: row.transfer,
      code: row.code,
    };
  }
  return out;
};

export const calculateRilTotals = (rows: RilRow[]): RilTotals => {
  const datedRows = rows.filter((row) => row.date);
  const attendanceRows = datedRows.filter((row) => !isRilAbsenceRow(row));
  return {
    totalHours: attendanceRows.reduce((sum, row) => sum + (Number(row.hoursDecimal) || 0), 0),
    totalPicap: attendanceRows.reduce((sum, row) => sum + (Number(row.picap) || 0), 0),
    workedDays: attendanceRows.filter((row) => row.worked && isRequiredRilWorkday(row)).length,
    workdays: datedRows.filter(isRequiredRilWorkday).length,
    holidayWeekdays: datedRows.filter((row) => row.isHoliday).length,
  };
};

export const makeRilDownloadFilename = (year: number, month: number, userName: string): string => {
  const safeUserName = (userName || 'User')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return `RIL_${year}_${String(month).padStart(2, '0')}_${safeUserName || 'User'}.xlsx`;
};
