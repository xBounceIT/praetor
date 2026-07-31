import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User, WorkUnit } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

const getUsersMock = mock(async (_id: string, _signal?: AbortSignal) => ['u1']);
const updateUsersMock = mock(async (_id: string, _userIds: string[]) => {});
const toastErrorMock = mock((_message: string) => {});

mock.module('../../../services/api/workUnits', () => ({
  workUnitsApi: {
    getUsers: getUsersMock,
    updateUsers: updateUsersMock,
  },
}));

mock.module('../../../utils/toast', () => ({
  toastError: toastErrorMock,
}));

clearSpyStateAfterAll();

const WorkUnitsView = (await import('../../../components/WorkUnitsView')).default;

const USERS: User[] = [
  {
    id: 'u1',
    name: 'Alice',
    username: 'alice',
    role: 'admin',
    avatarInitials: 'AL',
  } as unknown as User,
  {
    id: 'u2',
    name: 'Bob',
    username: 'bob',
    role: 'user',
    avatarInitials: 'BO',
  } as unknown as User,
];

const UNIT: WorkUnit = {
  id: 'wu-1',
  name: 'Engineering',
  managers: [{ id: 'u1', name: 'Alice' }],
  description: 'eng',
  userCount: 1,
};

const PERMISSIONS = [
  'hr.work_units.create',
  'hr.work_units.update',
  'hr.work_units.delete',
  'hr.work_units.view',
];

describe('<WorkUnitsView /> member assignments', () => {
  test('uses a dedicated dialog and partial update for manager assignments', async () => {
    const onUpdate = mock(() => Promise.resolve());
    const user = userEvent.setup();

    render(
      <WorkUnitsView
        workUnits={[UNIT]}
        users={USERS}
        permissions={PERMISSIONS}
        onAddWorkUnit={mock(() => Promise.resolve()) as unknown as never}
        onUpdateWorkUnit={onUpdate as unknown as never}
        onDeleteWorkUnit={mock(() => Promise.resolve()) as unknown as never}
        refreshWorkUnits={mock(() => Promise.resolve()) as unknown as never}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'hr:competenceCenters.manageManagers: Engineering',
      }),
    );
    expect(
      screen.getByRole('heading', { name: 'hr:competenceCenters.manageManagers' }),
    ).toBeInTheDocument();

    const managerSelect = document.getElementById('work-unit-manager-assignments');
    if (!managerSelect) throw new Error('manager assignment trigger not found');
    await user.click(managerSelect);
    await user.click(await screen.findByRole('option', { name: 'Bob' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'hr:competenceCenters.saveManagers' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('wu-1', { managerIds: ['u1', 'u2'] }),
    );
  });

  test('keeps the manager dialog open and reports save failures', async () => {
    const onUpdate = mock(() => Promise.reject(new Error('save failed')));
    const user = userEvent.setup();
    toastErrorMock.mockClear();

    render(
      <WorkUnitsView
        workUnits={[UNIT]}
        users={USERS}
        permissions={PERMISSIONS}
        onAddWorkUnit={mock(() => Promise.resolve()) as unknown as never}
        onUpdateWorkUnit={onUpdate as unknown as never}
        onDeleteWorkUnit={mock(() => Promise.resolve()) as unknown as never}
        refreshWorkUnits={mock(() => Promise.resolve()) as unknown as never}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'hr:competenceCenters.manageManagers: Engineering',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'hr:competenceCenters.saveManagers' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('hr:competenceCenters.failedToSaveManagers'),
    );
    expect(
      screen.getByRole('heading', { name: 'hr:competenceCenters.manageManagers' }),
    ).toBeInTheDocument();
  });

  test('renders the manage-members action as a native shadcn outline button', () => {
    render(
      <WorkUnitsView
        workUnits={[UNIT]}
        users={USERS}
        permissions={PERMISSIONS}
        onAddWorkUnit={mock(() => Promise.resolve()) as unknown as never}
        onUpdateWorkUnit={mock(() => Promise.resolve()) as unknown as never}
        onDeleteWorkUnit={mock(() => Promise.resolve()) as unknown as never}
        refreshWorkUnits={mock(() => Promise.resolve()) as unknown as never}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: 'hr:competenceCenters.manageMembers: Engineering',
    });
    // Native shadcn Button carries these data attributes; the old bespoke
    // <button> did not, so this fails on the pre-fix markup.
    expect(trigger.getAttribute('data-slot')).toBe('button');
    expect(trigger.getAttribute('data-variant')).toBe('outline');
    expect(trigger.getAttribute('data-size')).toBe('xs');
  });

  test('uses the shared user assignment modal for competence-center members', async () => {
    const refresh = mock(() => Promise.resolve());

    render(
      <WorkUnitsView
        workUnits={[UNIT]}
        users={USERS}
        permissions={PERMISSIONS}
        onAddWorkUnit={mock(() => Promise.resolve()) as unknown as never}
        onUpdateWorkUnit={mock(() => Promise.resolve()) as unknown as never}
        onDeleteWorkUnit={mock(() => Promise.resolve()) as unknown as never}
        refreshWorkUnits={refresh as unknown as never}
      />,
    );

    fireEvent.click(screen.getByText('hr:competenceCenters.manageMembers'));

    expect(
      await screen.findByRole('heading', { name: 'hr:competenceCenters.manageMembers' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('assignment.availableUsers')).toBeInTheDocument();
    expect(await screen.findByText('assignment.assignedUsers')).toBeInTheDocument();
    expect(getUsersMock.mock.calls[0][0]).toBe('wu-1');

    fireEvent.click(screen.getByText('Bob'));
    fireEvent.click(screen.getByRole('button', { name: /assignment.assignSelected/ }));
    fireEvent.click(screen.getByRole('button', { name: 'hr:competenceCenters.saveAssignments' }));

    await waitFor(() => expect(updateUsersMock).toHaveBeenCalledWith('wu-1', ['u1', 'u2']));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
