import { describe, expect, mock, test } from 'bun:test';
import { screen } from '@testing-library/react';
import type { User, WorkUnit } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

mock.module('../../../services/api/workUnits', () => ({
  workUnitsApi: {
    getUsers: mock(async () => []),
    updateUsers: mock(async () => {}),
  },
}));

clearSpyStateAfterAll();

const WorkUnitsView = (await import('../../../components/WorkUnitsView')).default;

const PERMISSIONS = ['hr.work_units.view'];
const noop = mock(() => Promise.resolve()) as unknown as never;

const renderView = (workUnits: WorkUnit[]) =>
  render(
    <WorkUnitsView
      workUnits={workUnits}
      users={[] as User[]}
      permissions={PERMISSIONS}
      onAddWorkUnit={noop}
      onUpdateWorkUnit={noop}
      onDeleteWorkUnit={noop}
      refreshWorkUnits={noop}
    />,
  );

describe('<WorkUnitsView /> member preview (issue #761)', () => {
  test('renders member initials with a +N overflow badge instead of the count', () => {
    renderView([
      {
        id: 'wu-1',
        name: 'Engineering',
        managers: [{ id: 'u1', name: 'Andrea Scognamiglio' }],
        members: [
          { id: 'u1', name: 'Andrea Scognamiglio' },
          { id: 'u2', name: 'Bob Bridge' },
          { id: 'u3', name: 'Carla Conti' },
          { id: 'u4', name: 'Dario Dini' },
          { id: 'u5', name: 'Elsa Espo' },
          { id: 'u6', name: 'Franco Fini' },
        ],
        userCount: 6,
      },
    ]);

    expect(screen.getByText('AS')).toBeInTheDocument();
    // Each badge surfaces the member's full name as its accessible label.
    expect(screen.getByLabelText('Andrea Scognamiglio')).toBeInTheDocument();
    // 6 members, inline cap of 5 → one collapses into a "+1" badge.
    expect(screen.getByText('+1')).toBeInTheDocument();
    // The avatar row replaces both the count line and the empty-state text.
    expect(screen.queryByText(/competenceCenters\.users/)).not.toBeInTheDocument();
    expect(screen.queryByText(/competenceCenters\.noMembersAssigned/)).not.toBeInTheDocument();
  });

  test('shows a "no members assigned" empty state when a unit has no members', () => {
    renderView([
      {
        id: 'wu-2',
        name: 'Design',
        managers: [],
        members: [],
        userCount: 0,
      },
    ]);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/competenceCenters\.noMembersAssigned/)).toBeInTheDocument();
  });
});
