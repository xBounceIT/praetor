import { describe, expect, mock, test } from 'bun:test';
import { waitFor } from '@testing-library/react';
import type { Client, Project, ProjectTask, TimeEntry } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const WeeklyView = (await import('../../../components/timesheet/WeeklyView')).default;

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

const sharedProps = {
  viewingUserId: 'user-a',
  selectedDate: todayDateOnly(),
  onSelectedDateChange: mock(() => {}),
  startOfWeek: 'Monday' as const,
  treatSaturdayAsHoliday: false,
  allowWeekendSelection: true,
  dailyGoal: 8,
};

describe('<WeeklyView /> RBAC catalog scoping', () => {
  test('drops an entry whose client/project/task is out of the scoped catalogs', async () => {
    // The viewing user has an entry referencing alpha catalog items, but only
    // the beta catalog is currently in scope. The alpha entry must NOT render
    // as a row — silently relabelling it to the beta catalog would mask a
    // real RBAC mismatch.
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

    render(<WeeklyView entries={entries} {...betaCatalog} {...sharedProps} />);

    await waitFor(() => {
      expect(document.body).not.toHaveTextContent('Alpha Client');
      expect(document.body).not.toHaveTextContent('Alpha Project');
      expect(document.body).not.toHaveTextContent('Alpha Task');
    });
  });

  test('renders entries from the viewing user as labelled rows', async () => {
    const entries: TimeEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-a',
        date: todayDateOnly(),
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

    render(<WeeklyView entries={entries} {...alphaCatalog} {...sharedProps} />);

    // The grid is read-only; the entry's 3.5h appears as a formatted cell value
    // and the row label combines client · project · task.
    await waitFor(() => {
      expect(document.body).toHaveTextContent('Alpha Client');
      expect(document.body).toHaveTextContent('Alpha Project');
      expect(document.body).toHaveTextContent('Alpha Task');
      expect(document.body).toHaveTextContent('3.50');
    });
  });
});
