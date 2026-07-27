import { describe, expect, test } from 'bun:test';
import { buildDuplicateTimeEntryDrafts } from '../../utils/timeEntryDuplicate';

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
});
