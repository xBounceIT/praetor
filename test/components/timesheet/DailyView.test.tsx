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

// onAddCustomTask + currency are required on DailyView. Tests that never exercise the modal
// don't care about their values; provide harmless defaults so callers can spread these into
// the test's props.
const defaultModalProps = {
  onAddCustomTask: mock(() => Promise.resolve(undefined)) as never,
  currency: '$',
};

describe('<DailyView /> RBAC catalog sync', () => {
  test('rerendering with another scoped catalog replaces stale selections', async () => {
    const props = {
      onAdd: mock(() => {}),
      selectedDate: '2026-05-11',
      permissions: [],
      dailyGoal: 8,
      currentDayTotal: 0,
      ...defaultModalProps,
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
      ...defaultModalProps,
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

  test('opens the task form modal with the current project pre-filled and locked when Custom task is selected', async () => {
    const props = {
      onAdd: mock(() => {}),
      selectedDate: '2026-05-11',
      permissions: ['projects.tasks.create'],
      dailyGoal: 8,
      currentDayTotal: 0,
      onAddCustomTask: mock(() => Promise.resolve(undefined)) as never,
      currency: '$',
    };

    render(
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

    // Open the task SelectControl popover and pick the "+ Custom Task..." option.
    fireEvent.click(document.querySelectorAll('button[aria-expanded]')[2]);
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('entry.customTask'));

    // The TaskFormModal dialog appears with the "Create new task" title.
    await waitFor(() => {
      expect(screen.getByText('tasks.createNewTask')).toBeInTheDocument();
    });

    // The Project field (inside the dialog) is rendered with the DailyView selection and is disabled.
    const projectTrigger = document.getElementById('task-project') as HTMLButtonElement;
    expect(projectTrigger).toBeInTheDocument();
    expect(projectTrigger.disabled).toBe(true);
    expect(projectTrigger).toHaveTextContent('Alpha Project');
  });

  test('calls onAddCustomTask with the locked project when the modal is submitted', async () => {
    const onAdd = mock(() => {});
    const createdTask: ProjectTask = {
      id: 'task-new',
      name: 'Onboarding call',
      projectId: 'project-alpha',
    };
    const onAddCustomTask = mock(() => Promise.resolve(createdTask));

    render(
      <DailyView
        onAdd={onAdd}
        selectedDate="2026-05-11"
        permissions={['projects.tasks.create']}
        dailyGoal={8}
        currentDayTotal={0}
        onAddCustomTask={onAddCustomTask as never}
        currency="$"
        clients={alphaCatalog.clients}
        projects={alphaCatalog.projects}
        projectTasks={[]}
      />,
    );

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Alpha Project');
    });

    // Open the task select, pick "+ Custom Task...", then fill the modal name field.
    fireEvent.click(document.querySelectorAll('button[aria-expanded]')[2]);
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('entry.customTask'));

    const nameInput = (await screen.findByPlaceholderText(
      'tasks.taskNamePlaceholder',
    )) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Onboarding call' } });

    fireEvent.click(screen.getByRole('button', { name: 'tasks.addTask' }));

    // Wait for the create call. The first arg is the name; the second is the locked project id.
    await waitFor(() => {
      expect(onAddCustomTask).toHaveBeenCalledTimes(1);
    });
    const callArgs = (onAddCustomTask as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(callArgs[0]).toBe('Onboarding call');
    expect(callArgs[1]).toBe('project-alpha');
  });

  test('clears stale task name when the selected project has no scoped tasks', async () => {
    const onAdd = mock(() => {});
    const props = {
      onAdd,
      selectedDate: '2026-05-11',
      permissions: [],
      dailyGoal: 8,
      currentDayTotal: 0,
      ...defaultModalProps,
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

  test('disables submit until a positive hours value is entered', async () => {
    const props = {
      onAdd: mock(() => {}),
      selectedDate: '2026-05-11',
      permissions: [],
      dailyGoal: 8,
      currentDayTotal: 0,
      ...defaultModalProps,
    };

    render(<DailyView {...props} {...alphaCatalog} />);

    const submitButton = await screen.findByText('entry.logTime');
    expect(submitButton).toBeDisabled();

    const hoursInput = screen.getByPlaceholderText('0.0');
    fireEvent.change(hoursInput, { target: { value: '1.5' } });
    expect(submitButton).not.toBeDisabled();

    fireEvent.change(hoursInput, { target: { value: '0' } });
    expect(submitButton).toBeDisabled();

    fireEvent.change(hoursInput, { target: { value: '' } });
    expect(submitButton).toBeDisabled();
  });
});
