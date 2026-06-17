import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import type {
  OvertimeNotificationSource,
  OvertimeReason,
} from '../db/schema/overtimeNotificationEvents.ts';
import * as entriesRepo from '../repositories/entriesRepo.ts';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as overtimeEventsRepo from '../repositories/overtimeNotificationEventsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import * as workUnitsRepo from '../repositories/workUnitsRepo.ts';
import { formatLocalDateOnly, parseLocalDateOnly } from '../utils/date.ts';
import { isItalianHoliday } from '../utils/holidays.ts';

export const OVERTIME_NOTIFICATION_TYPE = 'overtime_recorded';
export const STANDARD_DAILY_HOURS = 8;

const TIME_OF_DAY_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DEFAULT_RIL_LUNCH_BREAK_MINUTES = 60;
const RIL_LUNCH_BREAK_START_MINUTES = 13 * 60;

type OvertimeEvaluation = {
  isOvertime: boolean;
  reasons: OvertimeReason[];
};

export type NotifyOvertimeInput = {
  userId: string;
  date: string;
  hours: number;
  source: OvertimeNotificationSource;
  createdBy: string | null;
};

export type RilDraftOvertimeRow = {
  entrance: string;
  exit: string;
};

export type NotifyRilManualOvertimeInput = {
  userId: string;
  monthKey: string;
  rows: Record<string, RilDraftOvertimeRow>;
  changedDays: number[];
  createdBy: string | null;
  lunchBreakMinutes?: number;
};

const uniqueStrings = (values: string[]): string[] =>
  Array.from(
    values.reduce((set, value) => {
      const trimmed = value.trim();
      if (trimmed) set.add(trimmed);
      return set;
    }, new Set<string>()),
  );

const parseTimeToMinutes = (value: string): number | null => {
  if (!TIME_OF_DAY_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const normalizeLunchBreakMinutes = (value: number | undefined): number => {
  const parsed = Number(value ?? DEFAULT_RIL_LUNCH_BREAK_MINUTES);
  if (!Number.isFinite(parsed)) return DEFAULT_RIL_LUNCH_BREAK_MINUTES;
  return Math.min(240, Math.max(0, Math.round(parsed)));
};

export const calculateRilWorkedHoursFromTimes = (
  entrance: string,
  exit: string,
  lunchBreakMinutes = DEFAULT_RIL_LUNCH_BREAK_MINUTES,
): number => {
  const startMinutes = parseTimeToMinutes(entrance);
  const exitMinutes = parseTimeToMinutes(exit);
  if (startMinutes === null || exitMinutes === null || exitMinutes <= startMinutes) return 0;

  const lunchMinutes = normalizeLunchBreakMinutes(lunchBreakMinutes);
  const lunchStart = RIL_LUNCH_BREAK_START_MINUTES;
  const lunchEnd = lunchStart + lunchMinutes;
  const lunchOverlap =
    lunchMinutes <= 0
      ? 0
      : Math.max(0, Math.min(exitMinutes, lunchEnd) - Math.max(startMinutes, lunchStart));
  return Math.max(0, (exitMinutes - startMinutes - lunchOverlap) / 60);
};

export const evaluateOvertime = (date: string, hours: number): OvertimeEvaluation => {
  const safeHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  const dateObj = parseLocalDateOnly(date);
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
  const isHoliday = isItalianHoliday(dateObj) !== null;
  const reasons: OvertimeReason[] = [];
  if (safeHours > STANDARD_DAILY_HOURS) reasons.push('daily_limit');
  if (safeHours > 0 && (isWeekend || isHoliday)) reasons.push('weekend_or_holiday');
  return { isOvertime: reasons.length > 0, reasons };
};

const buildNotification = (input: NotifyOvertimeInput, reasons: OvertimeReason[]) => {
  const formattedHours = input.hours.toFixed(input.hours % 1 === 0 ? 0 : 2);
  return {
    type: OVERTIME_NOTIFICATION_TYPE,
    title: 'Overtime recorded',
    message: `${formattedHours}h recorded on ${input.date}`,
    data: {
      userId: input.userId,
      date: input.date,
      hours: input.hours,
      source: input.source,
      reasons,
    },
  };
};

export const resolveOvertimeRecipientUserIds = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<string[]> => {
  const [managerIds, topManagerIds] = await Promise.all([
    workUnitsRepo.listManagerIdsForUser(userId, exec),
    usersRepo.listTopManagerIds(exec),
  ]);
  return uniqueStrings([...managerIds, ...topManagerIds]);
};

export const notifyOvertimeIfNeeded = async (
  input: NotifyOvertimeInput,
  exec: DbExecutor = db,
): Promise<{ notified: number; created: boolean }> => {
  const evaluation = evaluateOvertime(input.date, input.hours);
  if (!evaluation.isOvertime) return { notified: 0, created: false };

  return runAtomically(exec, async (tx) => {
    const created = await overtimeEventsRepo.createIfAbsent(
      {
        userId: input.userId,
        eventDate: input.date,
        source: input.source,
        hours: input.hours,
        reasons: evaluation.reasons,
        createdBy: input.createdBy,
      },
      tx,
    );
    if (!created) return { notified: 0, created: false };

    const recipients = await resolveOvertimeRecipientUserIds(input.userId, tx);
    const notified = await notificationsRepo.createForUsers(
      recipients,
      buildNotification(input, evaluation.reasons),
      tx,
    );
    return { notified, created: true };
  });
};

export const notifyTrackerOvertimeForDate = async (
  userId: string,
  date: string,
  createdBy: string | null,
  exec: DbExecutor = db,
): Promise<{ notified: number; created: boolean }> => {
  const hours = await entriesRepo.sumDurationForUserDate(userId, date, exec);
  return notifyOvertimeIfNeeded({ userId, date, hours, source: 'tracker', createdBy }, exec);
};

const dateForMonthDay = (monthKey: string, day: number): string | null => {
  const date = parseLocalDateOnly(`${monthKey}-${String(day).padStart(2, '0')}`);
  if (date.getMonth() + 1 !== Number(monthKey.slice(5, 7))) return null;
  return formatLocalDateOnly(date);
};

export const notifyRilManualOvertimeForRows = async (
  input: NotifyRilManualOvertimeInput,
  exec: DbExecutor = db,
): Promise<{ checked: number; created: number; notified: number }> => {
  const uniqueChangedDays = Array.from(new Set(input.changedDays)).filter((day) =>
    Number.isInteger(day),
  );
  const checks = uniqueChangedDays.flatMap((day) => {
    const date = dateForMonthDay(input.monthKey, day);
    const row = input.rows[String(day)];
    if (!date || !row) return [];
    const hours = calculateRilWorkedHoursFromTimes(row.entrance, row.exit, input.lunchBreakMinutes);
    return [{ date, hours }];
  });

  const results = await Promise.all(
    checks.map(({ date, hours }) =>
      notifyOvertimeIfNeeded(
        {
          userId: input.userId,
          date,
          hours,
          source: 'ril_manual',
          createdBy: input.createdBy,
        },
        exec,
      ),
    ),
  );
  const created = results.filter((result) => result.created).length;
  const notified = results.reduce((total, result) => total + result.notified, 0);

  return { checked: checks.length, created, notified };
};
