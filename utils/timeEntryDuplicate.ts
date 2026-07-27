import type { TimeEntry } from '../types';

export type TimeEntryDuplicateDraft = Omit<
  TimeEntry,
  'id' | 'createdAt' | 'version' | 'userId' | 'hourlyCost' | 'cost'
> & {
  /** When true, POST /entries overwrites an existing same-key entry instead of 409. */
  overwriteExisting?: boolean;
};

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
    | 'notes'
    | 'duration'
    | 'location'
  >,
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
    notes: entry.notes,
    duration: entry.duration,
    location: entry.location,
    isPlaceholder: false,
    overwriteExisting: true,
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
