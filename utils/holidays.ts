/**
 * Italian Holiday Logic (Anonymous Algorithm for Easter)
 */
export const getEaster = (y: number): Date => {
  const f = Math.floor;
  const G = y % 19;
  const C = f(y / 100);
  const H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30;
  const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11));
  const J = (y + f(y / 4) + I + 2 - C + f(C / 4)) % 7;
  const L = I - J;
  const m = 3 + f((L + 40) / 44);
  const d = L + 28 - 31 * f(m / 4);
  return new Date(y, m - 1, d);
};

/**
 * Returns a translation key (e.g. `holidays.newYear`) for the Italian public
 * holiday that falls on `date`, or `null` if the date is not a holiday.
 *
 * Callers should resolve the key with `t(key)` (or `useTranslation('holidays')`)
 * so the displayed name follows the user's language preference.
 */
export const isItalianHoliday = (date: Date): string | null => {
  const d = date.getDate();
  const m = date.getMonth() + 1; // 1-based
  const y = date.getFullYear();

  const fixedHolidays: Record<string, string> = {
    '1-1': 'holidays.newYear',
    '1-6': 'holidays.epiphany',
    '4-25': 'holidays.liberationDay',
    '5-1': 'holidays.laborDay',
    '6-2': 'holidays.republicDay',
    '8-15': 'holidays.assumption',
    '11-1': 'holidays.allSaints',
    '12-8': 'holidays.immaculateConception',
    '12-25': 'holidays.christmas',
    '12-26': 'holidays.stStephen',
  };

  const key = `${m}-${d}`;
  if (fixedHolidays[key]) return fixedHolidays[key];

  const easter = getEaster(y);
  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  if (isSameDay(date, easter)) return 'holidays.easter';

  const easterMonday = new Date(easter);
  easterMonday.setDate(easter.getDate() + 1);
  if (isSameDay(date, easterMonday)) return 'holidays.easterMonday';

  return null;
};
