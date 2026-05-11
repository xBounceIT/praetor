import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Client, Project, ProjectTask } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const DailyView = (await import('../../../components/timesheet/DailyView')).default;

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

describe('<DailyView /> RBAC catalog sync', () => {
  test('rerendering with another scoped catalog replaces stale selections', async () => {
    const props = {
      onAdd: mock(() => {}),
      selectedDate: '2026-05-11',
      permissions: [],
      dailyGoal: 8,
      currentDayTotal: 0,
    };

    const { rerender } = render(<DailyView {...props} {...alphaCatalog} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Alpha Client');
      expect(document.body).toHaveTextContent('Alpha Project');
      expect(document.body).toHaveTextContent('Alpha Task');
    });

    rerender(<DailyView {...props} {...betaCatalog} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Beta Client');
      expect(document.body).toHaveTextContent('Beta Project');
      expect(document.body).toHaveTextContent('Beta Task');
      expect(document.body).not.toHaveTextContent('Alpha Client');
      expect(document.body).not.toHaveTextContent('Alpha Project');
      expect(document.body).not.toHaveTextContent('Alpha Task');
    });
  });

  test('rerendering with empty scoped catalogs clears stale selections', async () => {
    const props = {
      onAdd: mock(() => {}),
      selectedDate: '2026-05-11',
      permissions: [],
      dailyGoal: 8,
      currentDayTotal: 0,
    };

    const { rerender } = render(<DailyView {...props} {...alphaCatalog} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Alpha Client');
    });

    rerender(<DailyView {...props} clients={[]} projects={[]} projectTasks={[]} />);

    await waitFor(() => {
      expect(document.body).not.toHaveTextContent('Alpha Client');
      expect(document.body).not.toHaveTextContent('Alpha Project');
      expect(document.body).not.toHaveTextContent('Alpha Task');
    });
  });

  test('clears a custom task input when the scoped project disappears', async () => {
    const props = {
      onAdd: mock(() => {}),
      selectedDate: '2026-05-11',
      permissions: ['projects.tasks.create'],
      dailyGoal: 8,
      currentDayTotal: 0,
    };

    const { rerender } = render(
      <DailyView
        {...props}
        clients={alphaCatalog.clients}
        projects={alphaCatalog.projects}
        projectTasks={[]}
      />,
    );

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Alpha Project');
    });

    fireEvent.click(document.querySelectorAll('button[aria-expanded]')[2]);
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('entry.customTask'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('entry.typeCustomTask')).toBeInTheDocument();
    });

    rerender(<DailyView {...props} clients={[]} projects={[]} projectTasks={[]} />);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('entry.typeCustomTask')).not.toBeInTheDocument();
    });
  });

  test('clears stale task name when the selected project has no scoped tasks', async () => {
    const onAdd = mock(() => {});
    const props = {
      onAdd,
      selectedDate: '2026-05-11',
      permissions: [],
      dailyGoal: 8,
      currentDayTotal: 0,
    };

    const { rerender } = render(<DailyView {...props} {...alphaCatalog} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Alpha Task');
    });

    rerender(
      <DailyView
        {...props}
        clients={alphaCatalog.clients}
        projects={alphaCatalog.projects}
        projectTasks={[]}
      />,
    );

    await waitFor(() => {
      expect(document.body).not.toHaveTextContent('Alpha Task');
    });

    fireEvent.change(screen.getByPlaceholderText('0.0'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('entry.logTime'));

    await waitFor(() => {
      expect(onAdd).not.toHaveBeenCalled();
      expect(document.body).toHaveTextContent('entry.taskRequired');
    });
  });
});
