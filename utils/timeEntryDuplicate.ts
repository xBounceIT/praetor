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
