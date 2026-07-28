import type { TimeEntry } from '../types';

export type TimeEntryDuplicateDraft = Omit<
  TimeEntry,
  'id' | 'createdAt' | 'version' | 'userId' | 'hourlyCost' | 'cost'
>;

/** Build create payloads that copy catalog fields onto new dates (never placeholders). */
export const buildDuplicateTimeEntryDrafts = (
  entry: Pick<
    TimeEntry,
    | 'clientId'
    | 'clientName'
    | 'projectId'
    | 'projectName'
    | 'task'
    | 'taskId'
    | 'duration'
    | 'location'
  > & { notes?: string | null },
  dates: string[],
): TimeEntryDuplicateDraft[] =>
  dates.map((date) => ({
    date,
    clientId: entry.clientId,
    clientName: entry.clientName,
    projectId: entry.projectId,
    projectName: entry.projectName,
    task: entry.task,
    taskId: entry.taskId,
    ...(typeof entry.notes === 'string' ? { notes: entry.notes } : {}),
    duration: entry.duration,
    location: entry.location,
    isPlaceholder: false,
  }));

/** Dates that already have the same project+task key as the source entry (excluding source). */
export const collectDuplicateConflictDates = (
  entries: Array<Pick<TimeEntry, 'id' | 'date' | 'projectId' | 'task'>>,
  source: Pick<TimeEntry, 'id' | 'date' | 'projectId' | 'task'>,
): string[] => {
  const dates = new Set<string>();
  for (const entry of entries) {
    if (entry.id === source.id) continue;
    if (entry.date === source.date) continue;
    if (entry.projectId === source.projectId && entry.task === source.task) {
      dates.add(entry.date);
    }
  }
  return [...dates].sort();
};

/** How many selected dates already hold the same project+task (warning/toast only). */
export const countSelectedConflictDates = (
  selectedDates: string[],
  conflictDates: Iterable<string>,
): number => {
  const conflicts = new Set(conflictDates);
  return selectedDates.filter((date) => conflicts.has(date)).length;
};
