import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { User, WorkUnit } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

const getUsersMock = mock(async (_id: string, _signal?: AbortSignal) => ['u1']);
const updateUsersMock = mock(async (_id: string, _userIds: string[]) => {});

mock.module('../../../services/api/workUnits', () => ({
  workUnitsApi: {
    getUsers: getUsersMock,
    updateUsers: updateUsersMock,
  },
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
  test('renders the manage-members action as a native shadcn primary button', () => {
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
      name: 'hr:competenceCenters.manageMembers',
    });
    // Native shadcn Button carries these data attributes; the old bespoke
    // <button> did not, so this fails on the pre-fix markup.
    expect(trigger).toHaveAttribute('data-slot', 'button');
    expect(trigger).toHaveAttribute('data-variant', 'default');
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
