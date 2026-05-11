import { beforeEach, describe, expect, test } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import type { Client, Project, ProjectTask, Role, User } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const TasksView = (await import('../../../components/projects/TasksView')).default;

const noop = () => {};

const makeTasks = (count: number): ProjectTask[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `task-${index + 1}`,
    name: `Task ${index + 1}`,
    projectId: 'project-1',
  }));

const renderTasksView = (tasks: ProjectTask[]) =>
  render(
    createElement(TasksView, {
      tasks,
      projects: [] as Project[],
      clients: [] as Client[],
      permissions: [],
      users: [] as User[],
      roles: [] as Role[],
      currency: 'EUR',
      onAddTask: noop,
      onUpdateTask: noop,
      onDeleteTask: noop,
    }),
  );

describe('TasksView modal styling', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('task modal uses the shared shadcn modal layout and form primitives', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/TasksView.tsx', import.meta.url),
    ).text();

    expect(source).toContain("import { Button } from '@/components/ui/button';");
    expect(source).toContain("import { Field, FieldLabel } from '@/components/ui/field';");
    expect(source).toContain("import { Input } from '@/components/ui/input';");
    expect(source).toContain("import { Textarea } from '@/components/ui/textarea';");
    expect(source).toContain('<ModalContent size="lg">');
    expect(source).toContain('<ModalHeader>');
    expect(source).toContain('<ModalBody className="space-y-6">');
    expect(source).toContain('<ModalFooter className="sm:justify-between">');
    expect(source).toContain('<FieldLabel htmlFor="task-name">');
    expect(source).toContain('<FieldLabel htmlFor="task-description">');
    expect(source).toContain('<Input');
    expect(source).toContain('<Textarea');
    expect(source).toContain('variant="outline"');
    expect(source).toContain('variant="ghost"');
    expect(source).not.toContain('bg-white rounded-2xl');
    expect(source).not.toContain('shadow-lg transform active:scale-95');
    expect(source).not.toContain('shadow-white/20');
  });

  test('lets StandardTable control task rows per page', async () => {
    const user = userEvent.setup();
    renderTasksView(makeTasks(8));

    expect(screen.getByText('Task 5')).toBeInTheDocument();
    expect(screen.queryByText('Task 6')).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: '10' }));

    await waitFor(() => expect(screen.getByText('Task 6')).toBeInTheDocument());
    expect(screen.getByText('Task 8')).toBeInTheDocument();
  });
});
