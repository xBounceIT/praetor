import { describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createPortal } from 'react-dom';
import type { Client, Project, ProjectTask, Role, User } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

// Mock the sub-module the component imports so we don't hit the network.
mock.module('../../../services/api/tasks', () => ({
  tasksApi: {
    getHoursForProjects: () => Promise.resolve({}),
    getUsers: () => Promise.resolve([]),
    updateUsers: () => Promise.resolve(),
  },
}));

// OfferVersionsPanel.test.tsx registers a global `mock.module` for DeleteConfirmModal
// in Bun's runner; that mock persists across files and would otherwise stub out the
// confirm button this suite asserts against. Re-mock here so the suite is hermetic. We
// portal into document.body so the confirm buttons aren't hidden by the edit Dialog's
// modal aria-hidden boundary (the real component does this via Radix Dialog).
mock.module('../../../components/shared/DeleteConfirmModal', () => ({
  default: ({
    isOpen,
    onConfirm,
    onClose,
    isDeleting,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
    isDeleting?: boolean;
  }) =>
    isOpen
      ? createPortal(
          <div role="dialog" aria-modal="true">
            <button type="button" onClick={onClose} disabled={isDeleting}>
              buttons.noGoBack
            </button>
            <button type="button" onClick={onConfirm} disabled={isDeleting}>
              {isDeleting ? 'buttons.saving' : 'buttons.yesDelete'}
            </button>
          </div>,
          document.body,
        )
      : null,
}));

const TasksView = (await import('../../../components/projects/TasksView')).default;

const PROJECT: Project = {
  id: 'project-1',
  name: 'Project Alpha',
  clientId: 'client-1',
  color: '#000000',
} as unknown as Project;

const CLIENT: Client = {
  id: 'client-1',
  name: 'Client One',
} as unknown as Client;

const TASK: ProjectTask = {
  id: 'task-1',
  name: 'Existing Task',
  projectId: 'project-1',
  description: 'desc',
  billingType: 'time_and_materials',
  billingFrequency: 'monthly',
  expectedEffort: 10,
  monthlyEffort: 2,
  revenue: 100,
  notes: '',
};

const PERMISSIONS = [
  'projects.tasks.create',
  'projects.tasks.update',
  'projects.tasks.delete',
  'projects.tasks.view',
];

const USERS: User[] = [];
const ROLES: Role[] = [];

const renderTasksView = (
  overrides: {
    onAddTask?: ReturnType<typeof mock>;
    onUpdateTask?: ReturnType<typeof mock>;
    onDeleteTask?: ReturnType<typeof mock>;
    tasks?: ProjectTask[];
  } = {},
) => {
  const onAddTask = overrides.onAddTask ?? mock(() => Promise.resolve());
  const onUpdateTask = overrides.onUpdateTask ?? mock(() => Promise.resolve());
  const onDeleteTask = overrides.onDeleteTask ?? mock(() => Promise.resolve());

  const utils = render(
    <TasksView
      tasks={overrides.tasks ?? [TASK]}
      projects={[PROJECT]}
      clients={[CLIENT]}
      permissions={PERMISSIONS}
      users={USERS}
      roles={ROLES}
      currency="$"
      onAddTask={onAddTask as unknown as never}
      onUpdateTask={onUpdateTask as unknown as never}
      onDeleteTask={onDeleteTask as unknown as never}
    />,
  );

  return { ...utils, onAddTask, onUpdateTask, onDeleteTask };
};

const findCreateForm = () => {
  const heading = screen.getByText('tasks.createNewTask');
  const form = heading.closest('form');
  if (!form) throw new Error('Add task form not found');
  return form as HTMLFormElement;
};

const findEditForm = () => {
  const heading = screen.getByText('tasks.editTask');
  const form = heading.closest('form');
  if (!form) throw new Error('Edit task form not found');
  return form as HTMLFormElement;
};

describe('<TasksView /> double-submit guards', () => {
  test('handleSubmit (create): rapid clicks call onAddTask only once', async () => {
    let resolveAdd: (() => void) | undefined;
    const onAddTask = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveAdd = () => resolve();
        }),
    );

    // Render with no pre-existing tasks so there's no row to confuse "Project Alpha" with.
    const { onAddTask: addMock } = renderTasksView({ onAddTask, tasks: [] });
    const user = userEvent.setup();

    // Open the create modal via the HeaderAddButton.
    await user.click(screen.getByRole('button', { name: /tasks\.addTask/ }));

    // Fill required fields: name input and project select.
    const nameInput = screen.getByPlaceholderText('tasks.taskNamePlaceholder') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'My New Task' } });

    // Open project SelectControl combobox (searchable Popover) and pick the project.
    const projectButton = screen
      .getAllByRole('button')
      .find((btn) => btn.textContent?.includes('labels.selectOption'));
    if (!projectButton) throw new Error('project select trigger not found');
    await user.click(projectButton);

    // Wait for the popover and pick the project option.
    const option = await screen.findByRole('option', { name: 'Project Alpha' });
    await user.click(option);

    const form = findCreateForm();

    // Rapid-fire 3 submits while the first promise is still pending.
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    // The fix awaits onAddTask before closing the modal — the modal should
    // remain mounted while the promise is pending. On un-guarded code the
    // modal would close synchronously after the first call, masking the
    // duplicate-submit bug.
    expect(screen.queryByText('tasks.createNewTask')).toBeInTheDocument();

    // Resolve the pending promise so the finally-block runs.
    await act(async () => {
      resolveAdd?.();
    });

    expect(addMock).toHaveBeenCalledTimes(1);
  });

  test('handleSubmit (edit): rapid clicks call onUpdateTask only once', async () => {
    let resolveUpdate: (() => void) | undefined;
    const onUpdateTask = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = () => resolve();
        }),
    );

    const { onUpdateTask: updateMock } = renderTasksView({ onUpdateTask });

    // Click the task row to open edit modal.
    fireEvent.click(screen.getByText('Existing Task'));
    const form = findEditForm();

    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    // The modal must stay open while the submit awaits — see test above.
    expect(screen.queryByText('tasks.editTask')).toBeInTheDocument();

    await act(async () => {
      resolveUpdate?.();
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  test('close controls are inert while a submit is in flight', async () => {
    let resolveUpdate: (() => void) | undefined;
    const onUpdateTask = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = () => resolve();
        }),
    );

    renderTasksView({ onUpdateTask });

    fireEvent.click(screen.getByText('Existing Task'));
    const form = findEditForm();

    fireEvent.submit(form);

    // While the submit is in flight, the Cancel button must be disabled.
    const cancelButton = await screen.findByRole('button', { name: 'common:buttons.cancel' });
    expect((cancelButton as HTMLButtonElement).disabled).toBe(true);

    // Clicking Cancel must not close the modal.
    fireEvent.click(cancelButton);
    expect(screen.queryByText('tasks.editTask')).toBeInTheDocument();

    // Resolve and verify modal closes.
    await act(async () => {
      resolveUpdate?.();
    });
    await waitFor(() => {
      expect(screen.queryByText('tasks.editTask')).not.toBeInTheDocument();
    });
  });

  test('handleDelete: rapid clicks call onDeleteTask only once', async () => {
    let resolveDelete: (() => void) | undefined;
    const onDeleteTask = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = () => resolve();
        }),
    );

    const { onDeleteTask: deleteMock } = renderTasksView({ onDeleteTask });

    // Open edit modal, then click Delete inside the footer.
    fireEvent.click(screen.getByText('Existing Task'));
    fireEvent.click(screen.getByRole('button', { name: /common:buttons\.delete/ }));

    // Confirm delete in the DeleteConfirmModal.
    const confirmButton = await screen.findByRole('button', { name: 'buttons.yesDelete' });

    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await act(async () => {
      resolveDelete?.();
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
