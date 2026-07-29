import type {
  ProjectRuleEvaluationMode,
  ProjectRuleSchedule,
  ProjectRuleScheduleFrequency,
} from '../db/schema/projectRules.ts';

export const PROJECT_RULE_EVALUATION_MODES = ['continuous', 'periodic'] as const;
export const PROJECT_RULE_SCHEDULE_FREQUENCIES = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
] as const;

export const DEFAULT_PROJECT_RULE_SCHEDULE: ProjectRuleSchedule = {
  frequency: 'monthly',
  timeZone: 'UTC',
  userIds: [],
  taskIds: [],
};

export type ProjectRulePeriodWindow = {
  key: string;
  startDate: string;
  endDate: string;
};

const uniqueStrings = (values: unknown): string[] =>
  Array.isArray(values)
    ? Array.from(
        values.reduce<Set<string>>((result, value) => {
          if (typeof value === 'string') {
            const normalized = value.trim();
            if (normalized) result.add(normalized);
          }
          return result;
        }, new Set<string>()),
      ).sort()
    : [];

export const isProjectRuleEvaluationMode = (value: unknown): value is ProjectRuleEvaluationMode =>
  PROJECT_RULE_EVALUATION_MODES.includes(value as ProjectRuleEvaluationMode);

export const isProjectRuleScheduleFrequency = (
  value: unknown,
): value is ProjectRuleScheduleFrequency =>
  PROJECT_RULE_SCHEDULE_FREQUENCIES.includes(value as ProjectRuleScheduleFrequency);

export const isValidTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

export const normalizeProjectRuleSchedule = (value: unknown): ProjectRuleSchedule => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const timeZone =
    typeof raw.timeZone === 'string' && isValidTimeZone(raw.timeZone.trim())
      ? raw.timeZone.trim()
      : DEFAULT_PROJECT_RULE_SCHEDULE.timeZone;
  return {
    frequency: isProjectRuleScheduleFrequency(raw.frequency)
      ? raw.frequency
      : DEFAULT_PROJECT_RULE_SCHEDULE.frequency,
    timeZone,
    userIds: uniqueStrings(raw.userIds),
    taskIds: uniqueStrings(raw.taskIds),
  };
};

const datePartsInTimeZone = (now: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
};

const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const utcDate = (year: number, monthIndex: number, day: number) =>
  new Date(Date.UTC(year, monthIndex, day));
const isIsoDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === value;
};
const periodWindow = (
  schedule: ProjectRuleSchedule,
  startDate: string,
  endDate: string,
): ProjectRulePeriodWindow => ({
  key: `${schedule.frequency}:${schedule.timeZone}:${startDate}:${endDate}`,
  startDate,
  endDate,
});

const parsePeriodKey = (
  value: string,
): (ProjectRulePeriodWindow & { frequency: string; timeZone: string }) | null => {
  const match = /^([^:]+):(.+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!match) return null;
  const [, frequency, timeZone, startDate, endDate] = match;
  if (
    !frequency ||
    !timeZone ||
    !startDate ||
    !endDate ||
    !isIsoDate(startDate) ||
    !isIsoDate(endDate) ||
    startDate >= endDate
  ) {
    return null;
  }
  return {
    frequency,
    timeZone,
    key: value,
    startDate,
    endDate,
  };
};

const addSchedulePeriod = (date: string, frequency: ProjectRuleScheduleFrequency): string => {
  const parsed = utcDate(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  switch (frequency) {
    case 'daily':
      parsed.setUTCDate(parsed.getUTCDate() + 1);
      break;
    case 'weekly':
      parsed.setUTCDate(parsed.getUTCDate() + 7);
      break;
    case 'quarterly':
      parsed.setUTCMonth(parsed.getUTCMonth() + 3);
      break;
    case 'yearly':
      parsed.setUTCFullYear(parsed.getUTCFullYear() + 1);
      break;
    default:
      parsed.setUTCMonth(parsed.getUTCMonth() + 1);
      break;
  }
  return isoDate(parsed);
};

const isScheduleBoundary = (date: string, frequency: ProjectRuleScheduleFrequency): boolean => {
  const parsed = utcDate(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  switch (frequency) {
    case 'weekly':
      return parsed.getUTCDay() === 1;
    case 'monthly':
      return parsed.getUTCDate() === 1;
    case 'quarterly':
      return parsed.getUTCDate() === 1 && parsed.getUTCMonth() % 3 === 0;
    case 'yearly':
      return parsed.getUTCDate() === 1 && parsed.getUTCMonth() === 0;
    default:
      return true;
  }
};

export const getPreviousProjectRulePeriod = (
  now: Date,
  schedule: ProjectRuleSchedule,
): ProjectRulePeriodWindow => {
  const { year, month, day } = datePartsInTimeZone(now, schedule.timeZone);
  const today = utcDate(year, month - 1, day);
  let start: Date;
  let end: Date;

  switch (schedule.frequency) {
    case 'daily':
      end = today;
      start = utcDate(year, month - 1, day - 1);
      break;
    case 'weekly': {
      const mondayOffset = (today.getUTCDay() + 6) % 7;
      end = utcDate(year, month - 1, day - mondayOffset);
      start = utcDate(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 7);
      break;
    }
    case 'quarterly': {
      const currentQuarterStartMonth = Math.floor((month - 1) / 3) * 3;
      end = utcDate(year, currentQuarterStartMonth, 1);
      start = utcDate(year, currentQuarterStartMonth - 3, 1);
      break;
    }
    case 'yearly':
      end = utcDate(year, 0, 1);
      start = utcDate(year - 1, 0, 1);
      break;
    default:
      end = utcDate(year, month - 1, 1);
      start = utcDate(year, month - 2, 1);
      break;
  }

  const startDate = isoDate(start);
  const endDate = isoDate(end);
  return periodWindow(schedule, startDate, endDate);
};

export const getProjectRulePeriodForEvaluation = (
  now: Date,
  schedule: ProjectRuleSchedule,
  lastEvaluatedPeriod: string | null,
): ProjectRulePeriodWindow => {
  const latestCompleted = getPreviousProjectRulePeriod(now, schedule);
  if (!lastEvaluatedPeriod) return latestCompleted;

  const previous = parsePeriodKey(lastEvaluatedPeriod);
  if (
    !previous ||
    previous.frequency !== schedule.frequency ||
    previous.timeZone !== schedule.timeZone ||
    !isScheduleBoundary(previous.startDate, schedule.frequency) ||
    !isScheduleBoundary(previous.endDate, schedule.frequency) ||
    addSchedulePeriod(previous.startDate, schedule.frequency) !== previous.endDate ||
    previous.endDate >= latestCompleted.endDate
  ) {
    return latestCompleted;
  }

  const nextEndDate = addSchedulePeriod(previous.endDate, schedule.frequency);
  if (nextEndDate > latestCompleted.endDate) return latestCompleted;
  return periodWindow(schedule, previous.endDate, nextEndDate);
};
