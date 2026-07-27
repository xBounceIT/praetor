import { describe, expect, test } from 'bun:test';
import {
  buildDuplicateTimeEntryDrafts,
  collectDuplicateConflictDates,
  countSelectedConflictDates,
} from '../../utils/timeEntryDuplicate';

describe('timeEntryDuplicate helpers', () => {
  const source = {
    clientId: 'c1',
    clientName: 'Client',
    projectId: 'p1',
    projectName: 'Project',
    task: 'Task',
    taskId: 't1',
    notes: 'n',
    duration: 2,
    location: 'remote' as const,
  };

  test('buildDuplicateTimeEntryDrafts copies fields onto each date as non-placeholders', () => {
    const drafts = buildDuplicateTimeEntryDrafts(source, ['2024-03-12', '2024-03-13']);
    expect(drafts).toEqual([
      {
        date: '2024-03-12',
        clientId: 'c1',
        clientName: 'Client',
        projectId: 'p1',
        projectName: 'Project',
        task: 'Task',
        taskId: 't1',
        notes: 'n',
        duration: 2,
        location: 'remote',
        isPlaceholder: false,
      },
      {
        date: '2024-03-13',
        clientId: 'c1',
        clientName: 'Client',
        projectId: 'p1',
        projectName: 'Project',
        task: 'Task',
        taskId: 't1',
        notes: 'n',
        duration: 2,
        location: 'remote',
        isPlaceholder: false,
      },
    ]);
  });

  test('collectDuplicateConflictDates lists other days with the same project+task', () => {
    expect(
      collectDuplicateConflictDates(
        [
          { id: 'te-1', date: '2024-03-11', projectId: 'p1', task: 'Task' },
          { id: 'te-2', date: '2024-03-12', projectId: 'p1', task: 'Task' },
          { id: 'te-3', date: '2024-03-13', projectId: 'p1', task: 'Other' },
        ],
        { id: 'te-1', date: '2024-03-11', projectId: 'p1', task: 'Task' },
      ),
    ).toEqual(['2024-03-12']);
  });

  test('countSelectedConflictDates counts intersection only', () => {
    expect(countSelectedConflictDates(['2024-03-12', '2024-03-14'], ['2024-03-12'])).toBe(1);
    expect(countSelectedConflictDates(['2024-03-14'], ['2024-03-12'])).toBe(0);
  });
});
