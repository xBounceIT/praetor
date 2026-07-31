import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
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

const USERS = [{ id: 'daniel', name: "Daniel D'Angeli" }] as User[];

const WORK_UNIT: WorkUnit = {
  id: 'wu-1',
  name: 'Offensive',
  managers: [
    { id: 'emanuele', name: 'Emanuele Ciccioli' },
    { id: 'daniel', name: "Daniel D'Angeli" },
  ],
  members: [],
};

const noop = mock(async () => {});

describe('<WorkUnitsView /> manager order', () => {
  test('keeps the card order and assigned managers missing from the management options', () => {
    render(
      <WorkUnitsView
        workUnits={[WORK_UNIT]}
        users={USERS}
        permissions={['hr.work_units.view', 'hr.work_units.update']}
        onAddWorkUnit={noop}
        onUpdateWorkUnit={noop}
        onDeleteWorkUnit={noop}
        refreshWorkUnits={noop}
      />,
    );

    const managerRegion = screen.getByRole('region', {
      name: 'hr:competenceCenters.managers: Offensive',
    });
    const card = managerRegion.closest('[data-slot="card"]');
    expect(card?.querySelector('[data-slot="card-header"]')).toHaveClass('px-4', 'py-3');
    expect(screen.getByRole('heading', { level: 3, name: 'Offensive' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 4, name: 'hr:competenceCenters.managers' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 4, name: 'hr:competenceCenters.members' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Emanuele Ciccioli')).toHaveClass('truncate');
    expect(screen.getByText('EC').closest('[data-slot="avatar"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(screen.getByLabelText('1 hr:competenceCenters.title')).toBeInTheDocument();
    const cardText = managerRegion.textContent ?? '';
    expect(cardText.indexOf('Emanuele Ciccioli')).toBeLessThan(cardText.indexOf("Daniel D'Angeli"));

    const manageManagers = screen.getByRole('button', {
      name: 'hr:competenceCenters.manageManagers: Offensive',
    });
    expect(manageManagers.getAttribute('data-slot')).toBe('button');
    expect(manageManagers.getAttribute('data-variant')).toBe('outline');
    expect(manageManagers.getAttribute('data-size')).toBe('xs');

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.edit: Offensive' }));
    expect(
      screen.getByRole('heading', { name: 'hr:competenceCenters.editCompetenceCenter' }),
    ).toBeInTheDocument();
    expect(document.getElementById('work-unit-edit-managers')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));

    fireEvent.click(manageManagers);
    expect(
      screen.getByRole('heading', { name: 'hr:competenceCenters.manageManagers' }),
    ).toBeInTheDocument();
    const managerTrigger = document.getElementById('work-unit-manager-assignments');
    if (!managerTrigger) throw new Error('manager assignment trigger not found');
    const managerText = managerTrigger.textContent ?? '';
    expect(managerText).toContain('Emanuele Ciccioli');
    expect(managerText).toContain("Daniel D'Angeli");
    expect(managerText.indexOf('Emanuele Ciccioli')).toBeLessThan(
      managerText.indexOf("Daniel D'Angeli"),
    );
  });
});
