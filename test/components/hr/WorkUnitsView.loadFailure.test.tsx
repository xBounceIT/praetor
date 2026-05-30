import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { User, WorkUnit } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

const toastErrorMock = mock((_message: string) => {});

mock.module('../../../utils/toast', () => ({
  toastError: (message: string) => toastErrorMock(message),
  toastSuccess: () => {},
  toast: { error: () => {}, success: () => {}, info: () => {} },
}));

mock.module('../../../services/api/workUnits', () => ({
  workUnitsApi: {
    getUsers: () => Promise.reject(new Error('network down')),
    updateUsers: () => Promise.resolve(),
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

describe('<WorkUnitsView /> assignment-load failure', () => {
  test('disables Save Assignments and toasts when getUsers rejects', async () => {
    const originalError = console.error;
    console.error = mock(() => {}) as unknown as typeof console.error;
    try {
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

      // Click Manage Members on the only work unit row.
      fireEvent.click(screen.getByText('hr:competenceCenters.manageMembers'));

      const saveBtn = (await screen.findByRole('button', {
        name: 'hr:competenceCenters.saveAssignments',
      })) as HTMLButtonElement;

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());

      expect(saveBtn.disabled).toBe(true);
      expect(toastErrorMock.mock.calls[0][0]).toBe('hr:competenceCenters.failedToLoadUnitUsers');
    } finally {
      console.error = originalError;
    }
  });
});
