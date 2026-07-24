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
  }));

/** Dates that already have the same project+task key as the source entry. */
export const collectDuplicateConflictDates = (
  entries: Array<Pick<TimeEntry, 'id' | 'date' | 'projectId' | 'task'>>,
  source: Pick<TimeEntry, 'id' | 'date' | 'projectId' | 'task'>,
): string[] => {
  const dates = new Set<string>([source.date]);
  for (const entry of entries) {
    if (entry.id === source.id) continue;
    if (entry.projectId === source.projectId && entry.task === source.task) {
      dates.add(entry.date);
    }
  }
  return [...dates].sort();
};

/** Drop target dates that are blocked (source day / known conflicts). */
export const filterDuplicateTargetDates = (
  selectedDates: string[],
  disabledDates: Iterable<string>,
): string[] => {
  const blocked = new Set(disabledDates);
  return selectedDates.filter((date) => !blocked.has(date));
};
