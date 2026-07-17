import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import EmployeeHourlyCostPeriodsTable from '../../../components/HR/EmployeeHourlyCostPeriodsTable';
import type { EmployeeHourlyCostPeriodDraft } from '../../../components/HR/employeeHrProfile';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const initialPeriods: EmployeeHourlyCostPeriodDraft[] = [
  { key: 'baseline', effectiveFrom: null, costPerHour: '40' },
  { key: 'dated', effectiveFrom: '2025-01-01', costPerHour: '50' },
];

export const Harness = ({ canUpdate }: { canUpdate: boolean }) => {
  const [periods, setPeriods] = useState(initialPeriods);
  return (
    <EmployeeHourlyCostPeriodsTable
      periods={periods}
      onChange={setPeriods}
      errors={{}}
      currency="€"
      canUpdate={canUpdate}
      isLoading={false}
      loadError={null}
    />
  );
};

describe('<EmployeeHourlyCostPeriodsTable />', () => {
  test('derives the previous end date and labels the open boundaries', () => {
    render(<Harness canUpdate={false} />);

    expect(screen.getByText('employeeProfile.costPeriods.fromBeginning')).toBeInTheDocument();
    expect(screen.getByText('12/31/2024')).toBeInTheDocument();
    expect(screen.getByText('employeeProfile.costPeriods.toPresent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'employeeProfile.costPeriods.add' })).toBeNull();
  });

  test('allows adding and deleting every period after the fixed baseline', async () => {
    const user = userEvent.setup();
    render(<Harness canUpdate />);

    await user.click(screen.getByRole('button', { name: 'employeeProfile.costPeriods.add' }));
    expect(screen.getAllByLabelText('employeeProfile.costPeriods.costPerHour')).toHaveLength(3);

    const actionMenus = screen.getAllByRole('button', { name: 'table.rowActions' });
    await user.click(actionMenus[actionMenus.length - 1]);
    await user.click(
      await screen.findByRole('button', { name: 'employeeProfile.costPeriods.delete' }),
    );
    expect(screen.getAllByLabelText('employeeProfile.costPeriods.costPerHour')).toHaveLength(2);
    expect(actionMenus).toHaveLength(2);
    expect(screen.getAllByText('employeeProfile.costPeriods.toPresent').length).toBeGreaterThan(0);
  });
});
