import { describe, expect, mock, test } from 'bun:test';
import { waitFor } from '@testing-library/react';
import type { Client, Project, ProjectTask, TimeEntry, User } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const WeeklyView = (await import('../../../components/timesheet/WeeklyView')).default;

const availableUsers: User[] = [
  {
    id: 'user-a',
    name: 'User A',
    role: 'user',
    avatarInitials: 'UA',
    username: 'user-a',
  },
];

const alphaCatalog = {
  clients: [{ id: 'client-alpha', name: 'Alpha Client' }] satisfies Client[],
  projects: [
    { id: 'project-alpha', name: 'Alpha Project', clientId: 'client-alpha', color: '#111111' },
  ] satisfies Project[],
  projectTasks: [
    { id: 'task-alpha', name: 'Alpha Task', projectId: 'project-alpha' },
  ] satisfies ProjectTask[],
};

const betaCatalog = {
  clients: [{ id: 'client-beta', name: 'Beta Client' }] satisfies Client[],
  projects: [
    { id: 'project-beta', name: 'Beta Project', clientId: 'client-beta', color: '#222222' },
  ] satisfies Project[],
  projectTasks: [
    { id: 'task-beta', name: 'Beta Task', projectId: 'project-beta' },
  ] satisfies ProjectTask[],
};

const todayDateOnly = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
};

describe('<WeeklyView /> RBAC catalog sync', () => {
  test('rerendering with another scoped catalog rebuilds row selections', async () => {
    const props = {
      entries: [],
      onAddBulkEntries: mock(async () => {}),
      onDeleteEntry: mock(() => {}),
      onUpdateEntry: mock(() => {}),
      viewingUserId: 'user-a',
      availableUsers,
      onViewUserChange: mock(() => {}),
      startOfWeek: 'Monday' as const,
      treatSaturdayAsHoliday: false,
      allowWeekendSelection: true,
    };

    const { rerender } = render(<WeeklyView {...props} {...alphaCatalog} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Alpha Client');
      expect(document.body).toHaveTextContent('Alpha Project');
      expect(document.body).toHaveTextContent('Alpha Task');
    });

    rerender(<WeeklyView {...props} {...betaCatalog} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Beta Client');
      expect(document.body).toHaveTextContent('Beta Project');
      expect(document.body).toHaveTextContent('Beta Task');
      expect(document.body).not.toHaveTextContent('Alpha Client');
      expect(document.body).not.toHaveTextContent('Alpha Project');
      expect(document.body).not.toHaveTextContent('Alpha Task');
    });
  });

  test('drops an out-of-scope entry from the recent-task rows', async () => {
    // The viewing user has an entry referencing alpha catalog items, but only
    // the beta catalog is currently in scope. The alpha entry must NOT become
    // a recent-task row — it would be silently relabelled to the wrong
    // catalog refs. The form row may still default to the first beta entry
    // because the form is the user's working scratchpad, not historical data.
    const entries: TimeEntry[] = [
      {
        id: 'entry-alpha',
        userId: 'user-a',
        date: todayDateOnly(),
        clientId: 'client-alpha',
        clientName: 'Alpha Client',
        projectId: 'project-alpha',
        projectName: 'Alpha Project',
        task: 'Alpha Task',
        duration: 2,
        hourlyCost: 0,
        createdAt: 1,
        location: 'remote',
      },
    ];

    render(
      <WeeklyView
        entries={entries}
        {...betaCatalog}
        onAddBulkEntries={mock(async () => {})}
        onDeleteEntry={mock(() => {})}
        onUpdateEntry={mock(() => {})}
        viewingUserId="user-a"
        availableUsers={availableUsers}
        onViewUserChange={mock(() => {})}
        startOfWeek="Monday"
        treatSaturdayAsHoliday={false}
        allowWeekendSelection
      />,
    );

    await waitFor(() => {
      expect(document.body).not.toHaveTextContent('Alpha Client');
      expect(document.body).not.toHaveTextContent('Alpha Project');
      expect(document.body).not.toHaveTextContent('Alpha Task');
    });
  });

  test('builds recent-task rows from the viewing user’s past entries', async () => {
    const today = todayDateOnly();
    const entries: TimeEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-a',
        date: today,
        clientId: 'client-alpha',
        clientName: 'Alpha Client',
        projectId: 'project-alpha',
        projectName: 'Alpha Project',
        task: 'Alpha Task',
        duration: 3.5,
        hourlyCost: 0,
        createdAt: 1700000000,
        location: 'remote',
      },
    ];

    render(
      <WeeklyView
        entries={entries}
        {...alphaCatalog}
        onAddBulkEntries={mock(async () => {})}
        onDeleteEntry={mock(() => {})}
        onUpdateEntry={mock(() => {})}
        viewingUserId="user-a"
        availableUsers={availableUsers}
        onViewUserChange={mock(() => {})}
        startOfWeek="Monday"
        treatSaturdayAsHoliday={false}
        allowWeekendSelection
      />,
    );

    // The form row auto-selects Alpha Task, so the entry's combination is
    // collapsed into the form row (deduplication). The pre-filled duration
    // (3.5h) for today still appears in the grid.
    await waitFor(() => {
      const inputs = document.body.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]');
      const has3point5 = Array.from(inputs).some((input) => input.value === '3.5');
      expect(has3point5 || document.body.textContent?.includes('3.5')).toBe(true);
    });
  });
});
