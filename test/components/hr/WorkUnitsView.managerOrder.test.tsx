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
  test('keeps the card order and assigned managers missing from the user options', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.edit: Offensive' }));

    const editManagerTrigger = document.getElementById('work-unit-edit-managers');
    if (!editManagerTrigger) throw new Error('edit manager trigger not found');
    const editText = editManagerTrigger.textContent ?? '';
    expect(editText).toContain('Emanuele Ciccioli');
    expect(editText).toContain("Daniel D'Angeli");
    expect(editText.indexOf('Emanuele Ciccioli')).toBeLessThan(editText.indexOf("Daniel D'Angeli"));
  });
});
