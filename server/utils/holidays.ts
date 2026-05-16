/**
 * Italian Holiday Logic (Anonymous Algorithm for Easter)
 *
 * Server-side mirror of the frontend `utils/holidays.ts`. The recurring-entry
 * generator skips fixed and dynamic Italian holidays the same way the timesheet
 * UI does, so the two implementations must stay in sync.
 */

const easterCache = new Map<number, { month: number; day: number }>();

export const getEaster = (year: number): Date => {
  let cached = easterCache.get(year);
  if (!cached) {
    const floor = Math.floor;
    const G = year % 19;
    const C = floor(year / 100);
    const H = (C - floor(C / 4) - floor((8 * C + 13) / 25) + 19 * G + 15) % 30;
    const I = H - floor(H / 28) * (1 - floor(29 / (H + 1)) * floor((21 - G) / 11));
    const J = (year + floor(year / 4) + I + 2 - C + floor(C / 4)) % 7;
    const L = I - J;
    const month = 3 + floor((L + 40) / 44);
    const day = L + 28 - 31 * floor(month / 4);
    cached = { month, day };
    easterCache.set(year, cached);
  }
  return new Date(year, cached.month - 1, cached.day);
};

const FIXED_HOLIDAYS: Record<string, string> = {
  '1-1': 'Capodanno',
  '1-6': 'Epifania',
  '4-25': 'Liberazione',
  '5-1': 'Lavoro',
  '6-2': 'Repubblica',
  '8-15': 'Ferragosto',
  '11-1': 'Ognissanti',
  '12-8': 'Immacolata',
  '12-25': 'Natale',
  '12-26': 'S. Stefano',
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const isItalianHoliday = (date: Date): string | null => {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();

  const fixedKey = `${m}-${d}`;
  if (FIXED_HOLIDAYS[fixedKey]) return FIXED_HOLIDAYS[fixedKey];

  const easter = getEaster(y);
  if (isSameDay(date, easter)) return 'Pasqua';

  const easterMonday = new Date(easter);
  easterMonday.setDate(easter.getDate() + 1);
  if (isSameDay(date, easterMonday)) return "Lunedì dell'Angelo";

  return null;
};
