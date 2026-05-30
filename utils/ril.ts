import type { Project, TimeEntry } from '../types';
import { dateOnlyStringToLocalDate, getLocalDateString } from './date';
import { isItalianHoliday } from './holidays';

export type RilLocale = 'en' | 'it';

export interface RilGenerationOptions {
  year: number;
  month: number;
  entries: TimeEntry[];
  projects?: Project[];
  defaultStartTime?: string;
  lunchBreakMinutes?: number;
  locale?: RilLocale;
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

export const getRilLocationLabels = (locale: RilLocale) => RIL_LOCATION_LABELS[locale];

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });
const RIL_FIXED_ENTRANCE = '09:00';
const RIL_FIXED_EXIT = '18:00';
const DEFAULT_LUNCH_BREAK_MINUTES = 60;
export const RIL_LUNCH_BREAK_START_MINUTES = 13 * 60;

export const isValidRilStartTime = (value: string | undefined | null): value is string =>
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

export const parseRilTimeToMinutes = (value: string): number => {
  if (!isValidRilStartTime(value)) return 0;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const normalizeLunchBreakMinutes = (value: number | undefined): number => {
  const parsed = Number(value ?? DEFAULT_LUNCH_BREAK_MINUTES);
  if (!Number.isFinite(parsed)) return DEFAULT_LUNCH_BREAK_MINUTES;
  return Math.min(240, Math.max(0, Math.round(parsed)));
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

export const formatRilMinutesAsClock = (minutes: number): string => {
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
  lunchBreakMinutes = DEFAULT_LUNCH_BREAK_MINUTES,
  locale = 'en',
}: RilGenerationOptions): RilRow[] => {
  const daysInMonth = new Date(year, month, 0).getDate();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const entriesByDate = new Map<string, TimeEntry[]>();
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

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
      ? calculateRilWorkedHoursFromTimes(RIL_FIXED_ENTRANCE, RIL_FIXED_EXIT, lunchBreakMinutes)
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

    return {
      day,
      date,
      weekday: WEEKDAY_FORMATTER.format(dateObj),
      entrance: isValidWorkday ? RIL_FIXED_ENTRANCE : '',
      exit: isValidWorkday ? RIL_FIXED_EXIT : '',
      hours: formatRilHoursAsDuration(hoursDecimal),
      hoursDecimal,
      picap: worked ? roundRilPicapHours(hoursDecimal) : 0,
      phoneAvailability: '',
      notes: isHoliday ? 'F' : '',
      transfer:
        dayEntries.length > 0
          ? allRemote
            ? RIL_LOCATION_LABELS[locale].remote
            : RIL_LOCATION_LABELS[locale].office
          : '',
      code: '',
      order: Array.from(uniqueProjects).join('; '),
      isHoliday,
      isWorkday,
      worked,
    };
  });
};

export const calculateRilTotals = (rows: RilRow[]): RilTotals => ({
  totalHours: rows.reduce((sum, row) => sum + (Number(row.hoursDecimal) || 0), 0),
  totalPicap: rows.reduce((sum, row) => sum + (Number(row.picap) || 0), 0),
  workedDays: rows.filter((row) => row.worked && row.isWorkday).length,
  workdays: rows.filter((row) => row.date && row.isWorkday).length,
  holidayWeekdays: rows.filter((row) => row.isHoliday).length,
});

export const makeRilDownloadFilename = (year: number, month: number, userName: string): string => {
  const safeUserName = (userName || 'User')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return `RIL_${year}_${String(month).padStart(2, '0')}_${safeUserName || 'User'}.xlsx`;
};
