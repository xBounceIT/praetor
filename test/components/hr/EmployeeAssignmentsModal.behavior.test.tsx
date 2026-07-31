import { beforeEach, describe, expect, mock } from 'bun:test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Client, Project, User } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup';
import { reactTest as test } from '../../helpers/reactTest';
import { render } from '../../helpers/render';

installI18nMock();

const usersApiMock = {
  getAssignments: mock(async () => ({ clientIds: [], projectIds: [], taskIds: [] })),
  updateAssignments: mock(async () => {}),
};

mock.module('../../../services/api/users', () => ({ usersApi: usersApiMock }));
mock.module('../../../utils/toast', () => ({ toastError: mock(() => {}) }));
clearSpyStateAfterAll();

const EmployeeAssignmentsModal = (await import('../../../components/HR/EmployeeAssignmentsModal'))
  .default;

const employee: User = {
  id: 'u1',
  name: 'Test User',
  role: 'user',
  avatarInitials: 'TU',
  username: 'test.user',
};

const clients: Client[] = Array.from({ length: 9 }, (_, index) => ({
  id: `c${index + 1}`,
  name: `Client ${String(index + 1).padStart(2, '0')}`,
}));

const projects: Project[] = Array.from({ length: 9 }, (_, index) => ({
  id: `p${index + 1}`,
  clientId: clients[0].id,
  name: `Project ${String(index + 1).padStart(2, '0')}`,
}));

const renderModal = () =>
  render(
    <EmployeeAssignmentsModal
      user={employee}
      clients={clients}
      projects={projects}
      tasks={[]}
      isOpen
      onClose={mock(() => {})}
    />,
  );

describe('<EmployeeAssignmentsModal /> pagination', () => {
  beforeEach(() => {
    usersApiMock.getAssignments.mockClear();
    usersApiMock.updateAssignments.mockClear();
  });

  test('keeps columns independent, preserves selections, and resets pages on search', async () => {
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => expect(usersApiMock.getAssignments).toHaveBeenCalledWith('u1'));
    await screen.findByRole('checkbox', { name: 'Client 01' });

    const clientsPagination = screen.getByRole('navigation', {
      name: 'hr:workforce.clients: common:pagination.page',
    });
    const projectsPagination = screen.getByRole('navigation', {
      name: 'hr:workforce.projects: common:pagination.page',
    });
    const nextClients = within(clientsPagination).getByRole('button', {
      name: 'common:buttons.next: hr:workforce.clients',
    });
    const nextProjects = within(projectsPagination).getByRole('button', {
      name: 'common:buttons.next: hr:workforce.projects',
    });

    await user.click(nextClients);
    expect(screen.queryByRole('checkbox', { name: 'Client 01' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Client 08' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Project 01' })).toBeInTheDocument();

    await user.click(screen.getByText('Client 08'));
    expect(screen.getByRole('checkbox', { name: 'Client 08' })).toBeChecked();

    await user.click(nextProjects);
    expect(screen.getByRole('checkbox', { name: 'Project 08' })).toBeInTheDocument();

    await user.type(
      screen.getByRole('searchbox', { name: 'hr:workforce.searchClients' }),
      ' Client 01 ',
    );
    expect(screen.getByRole('checkbox', { name: 'Client 01' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Project 01' })).toBeInTheDocument();
    expect(
      within(clientsPagination).getByRole('button', {
        name: 'common:buttons.previous: hr:workforce.clients',
      }),
    ).toBeDisabled();
    expect(
      within(projectsPagination).getByRole('button', {
        name: 'common:buttons.previous: hr:workforce.projects',
      }),
    ).toBeDisabled();
  });

  test('does not reload or discard edits when the same user object is refreshed', async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal();

    await screen.findByRole('checkbox', { name: 'Client 01' });
    await user.click(screen.getByRole('checkbox', { name: 'Client 01' }));
    expect(screen.getByRole('checkbox', { name: 'Client 01' })).toBeChecked();

    rerender(
      <EmployeeAssignmentsModal
        user={{ ...employee, name: 'Renamed Test User' }}
        clients={clients}
        projects={projects}
        tasks={[]}
        isOpen
        onClose={mock(() => {})}
      />,
    );

    await waitFor(() => expect(usersApiMock.getAssignments).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('checkbox', { name: 'Client 01' })).toBeChecked();
  });
});
