import { describe, expect, test } from 'bun:test';
import {
  buildDuplicateTimeEntryDrafts,
  collectDuplicateConflictDates,
  filterDuplicateTargetDates,
} from '../../utils/timeEntryDuplicate';

describe('timeEntryDuplicate helpers', () => {
  const source = {
    id: 'te-1',
    date: '2024-03-11',
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

  test('collectDuplicateConflictDates includes source day and matching project+task days', () => {
    const dates = collectDuplicateConflictDates(
      [
        source,
        { id: 'te-2', date: '2024-03-12', projectId: 'p1', task: 'Task' },
        { id: 'te-3', date: '2024-03-13', projectId: 'p1', task: 'Other' },
        { id: 'te-4', date: '2024-03-14', projectId: 'p2', task: 'Task' },
      ],
      source,
    );
    expect(dates).toEqual(['2024-03-11', '2024-03-12']);
  });

  test('filterDuplicateTargetDates drops blocked dates', () => {
    expect(
      filterDuplicateTargetDates(
        ['2024-03-12', '2024-03-13', '2024-03-11'],
        ['2024-03-11', '2024-03-13'],
      ),
    ).toEqual(['2024-03-12']);
  });
});
