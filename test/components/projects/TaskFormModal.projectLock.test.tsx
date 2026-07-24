import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { Client, Project, ProjectTask } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const TaskFormModal = (await import('../../../components/projects/TaskFormModal')).default;

const clients: Client[] = [{ id: 'c-1', name: 'Client One' }];
const projects: Project[] = [
  { id: 'p-1', name: 'Project One', clientId: 'c-1' },
  { id: 'p-2', name: 'Project Two', clientId: 'c-1' },
];
const editingTask: ProjectTask = {
  id: 't-1',
  name: 'Existing task',
  projectId: 'p-1',
  description: 'Desc',
};

const permissions = { canCreate: true, canUpdate: true, canDelete: true };

describe('<TaskFormModal /> project lock (deepsec logic-bug-9a7143142c)', () => {
  test('edit mode disables the project selector even when projectLocked is omitted', () => {
    render(
      <TaskFormModal
        isOpen
        onClose={() => {}}
        mode="edit"
        editingTask={editingTask}
        projects={projects}
        clients={clients}
        currency="€"
        permissions={permissions}
        onAdd={mock(async () => editingTask)}
        onUpdate={mock(async () => {})}
      />,
    );

    expect(document.getElementById('task-project')).toBeDisabled();
  });

  test('edit submit omits projectId from the update payload', async () => {
    const onUpdate = mock(async (_id: string, _updates: Partial<ProjectTask>) => {});
    render(
      <TaskFormModal
        isOpen
        onClose={() => {}}
        mode="edit"
        editingTask={editingTask}
        projects={projects}
        clients={clients}
        currency="€"
        permissions={permissions}
        onAdd={mock(async () => editingTask)}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.change(document.getElementById('task-name') as HTMLInputElement, {
      target: { value: 'Renamed task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'projects.saveChanges' }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0]?.[0]).toBe('t-1');
    const updates = onUpdate.mock.calls[0]?.[1];
    expect(updates).toMatchObject({ name: 'Renamed task' });
    expect(updates).not.toHaveProperty('projectId');
  });

  test('add mode keeps the project selector enabled when projectLocked is false', () => {
    render(
      <TaskFormModal
        isOpen
        onClose={() => {}}
        mode="add"
        projects={projects}
        clients={clients}
        currency="€"
        permissions={permissions}
        initialProjectId="p-1"
        onAdd={mock(async () => editingTask)}
        onUpdate={mock(async () => {})}
      />,
    );

    expect(document.getElementById('task-project')).not.toBeDisabled();
  });
});
