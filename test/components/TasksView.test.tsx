import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Client, Project, ProjectTask, Role, User } from '../../types';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

// Modal uses createPortal; passthrough is friendlier for screen queries in happy-dom.
mock.module('../../components/shared/Modal', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}));

// DeleteConfirmModal also relies on a portal; stub with inline confirm/cancel.
mock.module('../../components/shared/DeleteConfirmModal', () => ({
  default: ({
    isOpen,
    onConfirm,
    onClose,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <button type="button" onClick={onClose}>
          confirm-cancel
        </button>
        <button type="button" onClick={onConfirm}>
          confirm-yes
        </button>
      </div>
    ) : null,
}));

// UserAssignmentModal isn't relevant to this test scope; render null.
mock.module('../../components/shared/UserAssignmentModal', () => ({
  default: () => null,
}));

// Stub tasksApi at the sub-module level. TasksView imports tasksApi from this path,
// which sidesteps any pollution of the services/api umbrella mock from sibling test files.
mock.module('../../services/api/tasks', () => ({
  tasksApi: {
    getHoursForProjects: () => Promise.resolve({}),
    getUsers: () => Promise.resolve([]),
    updateUsers: () => Promise.resolve(),
  },
}));

const TasksView = (await import('../../components/projects/TasksView')).default;

const client: Client = { id: 'c-1', name: 'Acme' };
const project: Project = { id: 'p-1', name: 'Project Alpha', clientId: 'c-1', color: '#000' };
const user: User = {
  id: 'u-1',
  name: 'Test User',
  role: 'user',
  avatarInitials: 'TU',
  username: 'tuser',
};
const role: Role = { id: 'r-1', name: 'Member', isSystem: false, isAdmin: false, permissions: [] };
const existingTask: ProjectTask = {
  id: 't-1',
  name: 'Original Task',
  projectId: 'p-1',
  description: 'desc',
};

const basePerms = [
  'projects.tasks.view',
  'projects.tasks.create',
  'projects.tasks.update',
  'projects.tasks.delete',
];

afterEach(() => {
  document.body.style.overflow = '';
});

describe('<TasksView /> double-submit prevention', () => {
  test('handleSubmit (create): rapid clicks call onAddTask only once', async () => {
    let resolveAdd: (() => void) | undefined;
    const onAddTask = mock(
      (_name: string, _projectId: string) =>
        new Promise<void>((resolve) => {
          resolveAdd = resolve;
        }),
    );

    render(
      <TasksView
        tasks={[]}
        projects={[project]}
        clients={[client]}
        permissions={basePerms}
        users={[user]}
        roles={[role]}
        currency="EUR"
        onAddTask={onAddTask}
        onUpdateTask={() => {}}
        onDeleteTask={() => {}}
      />,
    );

    // Open the Add Task modal (the header button uses i18n key projects:tasks.addTask).
    const addButtons = screen.getAllByText('tasks.addTask');
    fireEvent.click(addButtons[0] as HTMLElement);

    // Pick a project via the real CustomSelect: open dropdown, then click the project option.
    const modal = screen.getByTestId('modal');
    const selectTrigger = modal.querySelector('button[type="button"]') as HTMLButtonElement;
    fireEvent.click(selectTrigger);
    fireEvent.click(screen.getByText(project.name));

    const nameInput = screen.getByPlaceholderText('tasks.taskNamePlaceholder') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'New Task' } });

    // Locate the actual submit button (type="submit") inside the form.
    const form = modal.querySelector('form') as HTMLFormElement;
    const findSubmit = () => form.querySelector('button[type="submit"]') as HTMLButtonElement;

    // Fire the form's submit event 3 times rapidly. Only the first should trigger onAddTask;
    // the others should be guarded by isSubmitting.
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => {
      expect(findSubmit().disabled).toBe(true);
    });

    resolveAdd?.();

    await waitFor(() => {
      expect(onAddTask).toHaveBeenCalledTimes(1);
    });
  });

  test('handleSubmit (edit): rapid clicks call onUpdateTask only once', async () => {
    let resolveUpdate: (() => void) | undefined;
    const onUpdateTask = mock(
      (_id: string, _updates: Partial<ProjectTask>) =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    render(
      <TasksView
        tasks={[existingTask]}
        projects={[project]}
        clients={[client]}
        permissions={basePerms}
        users={[user]}
        roles={[role]}
        currency="EUR"
        onAddTask={() => {}}
        onUpdateTask={onUpdateTask}
        onDeleteTask={() => {}}
      />,
    );

    // Open the edit modal by clicking on the edit pencil button (icon: fa-pen-to-square).
    const editIcons = document.querySelectorAll('i.fa-pen-to-square');
    expect(editIcons.length).toBeGreaterThan(0);
    const editButton = editIcons[0]?.closest('button') as HTMLButtonElement;
    fireEvent.click(editButton);

    // Submit the form rapidly; only the first submit should call onUpdateTask.
    const modal = screen.getByTestId('modal');
    const form = modal.querySelector('form') as HTMLFormElement;
    const findSubmit = () => form.querySelector('button[type="submit"]') as HTMLButtonElement;

    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => {
      expect(findSubmit().disabled).toBe(true);
    });

    resolveUpdate?.();

    await waitFor(() => {
      expect(onUpdateTask).toHaveBeenCalledTimes(1);
    });
  });
});
