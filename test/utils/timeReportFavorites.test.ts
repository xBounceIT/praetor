import { describe, expect, test } from 'bun:test';
import type { TimeReportDefinition, TimeReportOptions } from '../../types';
import {
  finalizeTimeReportFavorite,
  sanitizeTimeReportFavorite,
} from '../../utils/timeReportFavorites';

const saved: TimeReportDefinition = {
  periodPreset: 'this_month',
  fromDate: '2026-06-01',
  toDate: '2026-06-30',
  userIds: ['user-1'],
  clientId: null,
  projectIds: [],
  task: null,
  noteContains: '',
  fields: ['client', 'duration'],
  groupBy: [],
  totalsOnly: false,
};

describe('finalizeTimeReportFavorite', () => {
  test('does not treat recalculated relative dates as sanitization', () => {
    expect(
      finalizeTimeReportFavorite(
        saved,
        { ...saved },
        {
          fromDate: '2026-07-01',
          toDate: '2026-07-31',
        },
      ),
    ).toEqual({
      definition: { ...saved, fromDate: '2026-07-01', toDate: '2026-07-31' },
      wasSanitized: false,
    });
  });

  test('reports permission-driven configuration changes', () => {
    const sanitized = { ...saved, fields: ['client'] as TimeReportDefinition['fields'] };

    expect(finalizeTimeReportFavorite(saved, sanitized, null)).toEqual({
      definition: sanitized,
      wasSanitized: true,
    });
  });
});

describe('sanitizeTimeReportFavorite', () => {
  test('removes selections that conflict with current visibility and dependencies', () => {
    const options: TimeReportOptions = {
      users: [{ id: 'user-1', name: 'Current user' }],
      clients: [
        { id: 'client-1', name: 'Client 1' },
        { id: 'client-2', name: 'Client 2' },
      ],
      projects: [
        { id: 'project-1', name: 'Project 1', clientId: 'client-1' },
        { id: 'project-2', name: 'Project 2', clientId: 'client-2' },
      ],
      tasks: [{ key: 'task-2', projectId: 'project-2', taskId: 'task-2', name: 'Task 2' }],
    };
    const incompatible: TimeReportDefinition = {
      ...saved,
      userIds: ['user-2'],
      clientId: 'client-1',
      projectIds: ['project-2'],
      task: { projectId: 'project-2', taskId: 'task-2', name: 'Task 2' },
      fields: ['duration', 'cost'],
    };

    expect(
      sanitizeTimeReportFavorite(incompatible, options, {
        canSelectUsers: true,
        canViewCost: false,
        currentUserId: 'user-1',
      }),
    ).toMatchObject({
      userIds: ['user-1'],
      projectIds: [],
      task: null,
      fields: ['duration'],
    });
  });

  test('keeps legacy tasks when only their name casing changed', () => {
    const legacySaved: TimeReportDefinition = {
      ...saved,
      projectIds: ['project-1'],
      task: { projectId: 'project-1', taskId: null, name: 'Code Review' },
    };
    const options: TimeReportOptions = {
      users: [{ id: 'user-1', name: 'Current user' }],
      clients: [],
      projects: [{ id: 'project-1', name: 'Project 1', clientId: 'client-1' }],
      tasks: [
        {
          key: 'legacy:project-1:code review',
          projectId: 'project-1',
          taskId: null,
          name: 'code review',
        },
      ],
    };

    const sanitized = sanitizeTimeReportFavorite(legacySaved, options, {
      canSelectUsers: false,
      canViewCost: false,
      currentUserId: 'user-1',
    });

    expect(sanitized.task).toEqual(legacySaved.task);
  });
});
