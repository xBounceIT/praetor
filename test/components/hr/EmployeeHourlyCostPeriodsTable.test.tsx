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

const EmptyCostHarness = () => {
  const [periods, setPeriods] = useState<EmployeeHourlyCostPeriodDraft[]>([
    { key: 'baseline', effectiveFrom: null, costPerHour: '' },
  ]);
  return (
    <EmployeeHourlyCostPeriodsTable
      periods={periods}
      onChange={setPeriods}
      errors={{ 'hourlyCostPeriods.baseline.costPerHour': 'required' }}
      currency="€"
      canUpdate
      isLoading={false}
      loadError={null}
    />
  );
};

describe('<EmployeeHourlyCostPeriodsTable />', () => {
  test('derives the previous end date and labels the open boundaries', async () => {
    const user = userEvent.setup();
    render(<Harness canUpdate={false} />);

    expect(screen.getByText('employeeProfile.costPeriods.fromBeginning')).toBeInTheDocument();
    expect(screen.getByText('12/31/2024')).toBeInTheDocument();
    expect(screen.getByText('employeeProfile.costPeriods.toPresent')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'employeeProfile.costPeriods.from' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'employeeProfile.costPeriods.to' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'employeeProfile.costPeriods.add' })).toBeNull();

    const infoButton = screen.getByRole('button', {
      name: 'employeeProfile.costPeriods.description',
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.hover(infoButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'employeeProfile.costPeriods.description',
    );
  });

  test('edits both effective boundaries with the shared date picker and separates currency', async () => {
    const user = userEvent.setup();
    render(<Harness canUpdate />);

    expect(
      screen.queryByLabelText('employeeProfile.costPeriods.costPerHour'),
    ).not.toBeInTheDocument();

    const effectiveFrom = screen.getByRole('combobox', {
      name: 'employeeProfile.costPeriods.from',
    });
    expect(effectiveFrom).toHaveTextContent('01/01/2025');

    const effectiveTo = screen.getByRole('combobox', {
      name: 'employeeProfile.costPeriods.to',
    });
    await user.click(effectiveTo);
    await user.click(await screen.findByRole('button', { name: '30' }));
    expect(effectiveFrom).toHaveTextContent('12/31/2024');

    await user.click(effectiveFrom);
    await user.click(await screen.findByRole('button', { name: '29' }));
    expect(effectiveFrom).toHaveTextContent('12/29/2024');
    expect(effectiveTo).toHaveTextContent('12/28/2024');

    await user.click(screen.getAllByRole('button', { name: 'table.rowActions' })[0]);
    await user.click(await screen.findByRole('button', { name: 'common:buttons.edit' }));

    const costInput = screen.getByLabelText('employeeProfile.costPeriods.costPerHour');
    const inputGroup = costInput.closest('[data-slot="input-group"]');
    expect(inputGroup).toHaveTextContent('€');
    expect(inputGroup?.querySelector('[data-slot="input-group-addon"]')).toHaveTextContent('€');
    expect(
      screen.queryByRole('combobox', { name: 'employeeProfile.costPeriods.to' }),
    ).toBeInTheDocument();
  });

  test('allows adding and deleting every period after the fixed baseline', async () => {
    const user = userEvent.setup();
    render(<Harness canUpdate />);

    await user.click(screen.getByRole('button', { name: 'employeeProfile.costPeriods.add' }));
    expect(screen.getAllByLabelText('employeeProfile.costPeriods.costPerHour')).toHaveLength(1);

    const actionMenus = screen.getAllByRole('button', { name: 'table.rowActions' });
    expect(actionMenus).toHaveLength(3);
    await user.click(actionMenus[actionMenus.length - 1]);
    await user.click(
      await screen.findByRole('button', { name: 'employeeProfile.costPeriods.delete' }),
    );
    expect(
      screen.queryByLabelText('employeeProfile.costPeriods.costPerHour'),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'table.rowActions' })).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'table.rowActions' })[1]);
    await user.click(
      await screen.findByRole('button', { name: 'employeeProfile.costPeriods.delete' }),
    );
    expect(screen.getAllByRole('button', { name: 'table.rowActions' })).toHaveLength(1);
    expect(screen.getAllByText('employeeProfile.costPeriods.toPresent').length).toBeGreaterThan(0);
  });

  test('keeps empty costs and their validation visible outside edit mode', () => {
    render(<EmptyCostHarness />);

    expect(screen.getByText('€ —')).toBeInTheDocument();
    expect(screen.getByText('required')).toBeInTheDocument();
  });
});
