import { describe, expect, mock } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Client, Project, ProjectTask, TimeEntry } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { reactTest as test } from '../../helpers/reactTest';
import { render } from '../../helpers/render';

installI18nMock();

const toastErrorMock = mock(() => {});
mock.module('../../../utils/toast', () => ({
  toastError: toastErrorMock,
  toastSuccess: () => {},
  toast: { error: () => {}, success: () => {}, info: () => {} },
}));

const EntryEditDialog = (await import('../../../components/timesheet/EntryEditDialog')).default;

const clients: Client[] = [
  { id: 'client-alpha', name: 'Alpha Client' },
  { id: 'client-beta', name: 'Beta Client' },
];

const projects: Project[] = [
  { id: 'project-alpha', name: 'Alpha Project', clientId: 'client-alpha' },
  { id: 'project-beta', name: 'Beta Project', clientId: 'client-beta' },
];

const projectTasks: ProjectTask[] = [
  { id: 'task-alpha', name: 'Alpha Task', projectId: 'project-alpha' },
  { id: 'task-alpha-2', name: 'Alpha QA', projectId: 'project-alpha' },
  { id: 'task-beta', name: 'Beta Task', projectId: 'project-beta' },
];

const sampleEntry: TimeEntry = {
  id: 'te-1',
  userId: 'u-1',
  date: '2026-05-11',
  clientId: 'client-alpha',
  clientName: 'Alpha Client',
  projectId: 'project-alpha',
  projectName: 'Alpha Project',
  task: 'Alpha Task',
  taskId: 'task-alpha',
  notes: 'initial notes',
  duration: 2.5,
  hourlyCost: 50,
  cost: 125,
  isPlaceholder: false,
  location: 'remote',
  createdAt: 1_700_000_000_000,
  version: 3,
};

const baseProps = {
  clients,
  projects,
  projectTasks,
  permissions: [],
  currency: '$',
  onAddCustomTask: mock(() => Promise.resolve(undefined)) as never,
};

describe('<EntryEditDialog />', () => {
  test('renders nothing when entry is null', () => {
    const { container } = render(
      <EntryEditDialog
        {...baseProps}
        entry={null}
        onClose={mock(() => {})}
        onSave={mock(() => {})}
      />,
    );
    expect(container).not.toHaveTextContent('entry.editEntry');
  });

  test('pre-populates fields from the entry and saves the edited duration + notes', async () => {
    const onSave = mock(() => Promise.resolve());
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={sampleEntry}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    // Hours input shows the original duration; notes input shows the original notes.
    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    const notesInput = document.getElementById('entry-edit-notes') as HTMLInputElement;
    expect(hoursInput.value).toBe('2,5');
    expect(notesInput.value).toBe('initial notes');

    fireEvent.change(hoursInput, { target: { value: '3,25' } });
    fireEvent.change(notesInput, { target: { value: 'updated notes' } });

    fireEvent.submit(hoursInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const [id, patch] = (onSave as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      Partial<TimeEntry>,
    ];
    expect(id).toBe('te-1');
    expect(patch).toEqual({ version: 3, duration: 3.25, notes: 'updated notes' });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  test('shows project and task descriptions when their catalog options are hovered', async () => {
    const user = userEvent.setup();
    render(
      <EntryEditDialog
        {...baseProps}
        projects={projects.map((project) =>
          project.id === 'project-alpha'
            ? { ...project, description: 'Alpha project description' }
            : project,
        )}
        projectTasks={projectTasks.map((task) =>
          task.id === 'task-alpha' ? { ...task, description: 'Alpha task description' } : task,
        )}
        entry={sampleEntry}
        onClose={mock(() => {})}
        onSave={mock(() => {})}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Alpha Project/ }));
    const projectOptions = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    expect(projectOptions).not.toBeNull();
    const projectOption = within(projectOptions as HTMLElement)
      .getByText('Alpha Project')
      .closest('[data-slot="tooltip-trigger"]');
    expect(projectOption).not.toBeNull();
    await user.hover(projectOption as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Alpha project description');
    await user.click(projectOption as HTMLElement);

    await user.click(screen.getByRole('button', { name: /Alpha Task/ }));
    const taskOptions = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    expect(taskOptions).not.toBeNull();
    const taskOption = within(taskOptions as HTMLElement)
      .getByText('Alpha Task')
      .closest('[data-slot="tooltip-trigger"]');
    expect(taskOption).not.toBeNull();
    await user.hover(taskOption as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Alpha task description');
  });

  test('does not call onSave when no field changed; still closes', async () => {
    const onSave = mock(() => Promise.resolve());
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={sampleEntry}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    fireEvent.submit(hoursInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  test('keeps the dialog open and surfaces a toast when onSave rejects', async () => {
    toastErrorMock.mockClear();
    const onSave = mock(() => Promise.reject(new Error('Server said no')));
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={sampleEntry}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    fireEvent.change(hoursInput, { target: { value: '4' } });
    fireEvent.submit(hoursInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Server said no');
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('allows editing other fields on a duration=0 placeholder entry', async () => {
    const onSave = mock(() => Promise.resolve());
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={{ ...sampleEntry, duration: 0, isPlaceholder: true }}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    const notesInput = document.getElementById('entry-edit-notes') as HTMLInputElement;
    expect(hoursInput.value).toBe('0');

    fireEvent.change(notesInput, { target: { value: 'placeholder note' } });
    fireEvent.submit(hoursInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const [, patch] = (onSave as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      Partial<TimeEntry>,
    ];
    expect(patch).toEqual({ version: 3, notes: 'placeholder note' });
  });

  test('clearing the hours field still allows saving notes-only changes', async () => {
    const onSave = mock(() => Promise.resolve());
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={sampleEntry}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    const notesInput = document.getElementById('entry-edit-notes') as HTMLInputElement;

    fireEvent.change(hoursInput, { target: { value: '' } });
    fireEvent.change(notesInput, { target: { value: 'just the note' } });
    fireEvent.submit(hoursInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const [, patch] = (onSave as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      Partial<TimeEntry>,
    ];
    // Blank duration is treated as "untouched" — no `duration` field in the patch.
    expect(patch).toEqual({ version: 3, notes: 'just the note' });
  });

  test('does not allow an existing note to be cleared', async () => {
    const onSave = mock(() => Promise.resolve());

    render(
      <EntryEditDialog
        {...baseProps}
        entry={sampleEntry}
        onClose={mock(() => {})}
        onSave={onSave as never}
      />,
    );

    const notesInput = document.getElementById('entry-edit-notes') as HTMLInputElement;
    fireEvent.change(notesInput, { target: { value: '   ' } });

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    await waitFor(() => {
      expect(document.body).toHaveTextContent('entry.notesRequired');
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  test('hides paused and terminated projects from the edit catalog selector', () => {
    const pausedProject: Project = {
      id: 'project-paused',
      name: 'Paused Project',
      clientId: 'client-alpha',
      status: 'in_pausa',
    };
    const terminatedProject: Project = {
      id: 'project-terminated',
      name: 'Terminated Project',
      clientId: 'client-alpha',
      status: 'terminato',
    };
    const expiredProject: Project = {
      id: 'project-expired',
      name: 'Expired Project',
      clientId: 'client-alpha',
      endDate: '2000-01-01',
      status: 'in_corso',
    };

    render(
      <EntryEditDialog
        {...baseProps}
        projects={[...projects, pausedProject, terminatedProject, expiredProject]}
        projectTasks={[
          ...projectTasks,
          { id: 'task-paused', name: 'Paused Task', projectId: 'project-paused' },
          { id: 'task-terminated', name: 'Terminated Task', projectId: 'project-terminated' },
          { id: 'task-expired', name: 'Expired Task', projectId: 'project-expired' },
        ]}
        entry={sampleEntry}
        onClose={mock(() => {})}
        onSave={mock(() => {})}
      />,
    );

    const projectTrigger = screen.getByRole('button', { name: /Alpha Project/ });
    fireEvent.click(projectTrigger);

    expect(document.body).not.toHaveTextContent('Paused Project');
    expect(document.body).not.toHaveTextContent('Paused Task');
    expect(document.body).not.toHaveTextContent('Terminated Project');
    expect(document.body).not.toHaveTextContent('Terminated Task');
    expect(document.body).toHaveTextContent('Expired Project');
  });
  test('resolves seeded taskId via name lookup when the entry has no taskId FK', () => {
    render(
      <EntryEditDialog
        {...baseProps}
        // Legacy/orphan entry: taskId is null but the task name matches a catalog row.
        entry={{ ...sampleEntry, taskId: null }}
        onClose={mock(() => {})}
        onSave={mock(() => {})}
      />,
    );

    // The Task SelectControl trigger surfaces the resolved task name, not the placeholder,
    // proving the seed found a real catalog id rather than rendering an empty dropdown.
    expect(document.body).toHaveTextContent('Alpha Task');
  });

  test('cancel closes without saving', () => {
    const onSave = mock(() => Promise.resolve());
    const onClose = mock(() => {});

    render(
      <EntryEditDialog
        {...baseProps}
        entry={sampleEntry}
        onClose={onClose}
        onSave={onSave as never}
      />,
    );

    const hoursInput = document.getElementById('entry-edit-hours') as HTMLInputElement;
    fireEvent.change(hoursInput, { target: { value: '9' } });

    const cancelButtons = Array.from(document.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('common:buttons.cancel'),
    );
    expect(cancelButtons.length).toBeGreaterThan(0);
    fireEvent.click(cancelButtons[0]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
