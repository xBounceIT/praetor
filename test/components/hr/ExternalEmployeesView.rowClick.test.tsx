import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { ResponsibleUserOption, User, WorkUnit } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const getHourlyCostPeriodsMock = mock(async () => [
  { id: 1, effectiveFrom: null, effectiveTo: null, costPerHour: 31.5 },
]);

mock.module('../../../services/api/users', () => ({
  usersApi: { getHourlyCostPeriods: getHourlyCostPeriodsMock },
}));

// The assignments modal is outside this view's responsibility in these tests.
mock.module('../../../components/HR/EmployeeAssignmentsModal', () => ({
  default: () => null,
}));

const ExternalEmployeesView = (await import('../../../components/HR/ExternalEmployeesView'))
  .default;

const employee: User = {
  id: 'u1',
  name: 'Mario Rossi',
  role: 'user',
  avatarInitials: 'MR',
  username: 'mrossi',
  employeeType: 'external',
  authMethod: 'local',
  costPerHour: 25,
  email: 'mario.contractor@example.com',
  phone: '+39 02 9876',
  responsibleUserId: 'u-manager',
  responsibleUserName: 'Paola Manager',
};

const responsibleUserOptions: ResponsibleUserOption[] = [
  { id: 'u1', name: 'Mario Rossi', username: 'mrossi', avatarInitials: 'MR' },
  { id: 'u-manager', name: 'Paola Manager', username: 'pmanager', avatarInitials: 'PM' },
];

const workUnits: WorkUnit[] = [
  {
    id: 'wu-beta',
    name: 'Beta Center',
    managers: [],
    members: [{ id: 'u1', name: 'Mario Rossi' }],
  },
  {
    id: 'wu-alpha',
    name: 'Alpha Center',
    managers: [],
    members: [{ id: 'u1', name: 'Mario Rossi' }],
  },
];

const renderView = (overrides: Partial<ComponentProps<typeof ExternalEmployeesView>> = {}) => {
  const props: ComponentProps<typeof ExternalEmployeesView> = {
    users: [employee],
    clients: [],
    projects: [],
    tasks: [],
    workUnits: [],
    responsibleUserOptions,
    onAddEmployee: mock(async () => ({ success: true })),
    onUpdateEmployee: mock(async () => ({ success: true })),
    onDeleteEmployee: mock(async () => ({ success: true })),
    currency: '€',
    permissions: ['hr.external.view', 'hr.external.update'],
    ...overrides,
  };
  render(<ExternalEmployeesView {...props} />);
  return props;
};

describe('<ExternalEmployeesView /> row click', () => {
  beforeEach(() => {
    getHourlyCostPeriodsMock.mockClear();
  });

  test('renders email and phone as separate table columns', () => {
    renderView();

    const headerTexts = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headerTexts).toContain('common:labels.email');
    expect(headerTexts).toContain('employeeProfile.phone');
    expect(headerTexts).toContain('employeeProfile.responsible');
    expect(headerTexts).not.toContain('employeeProfile.contact');

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');

    const cellTexts = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent?.trim());
    expect(cellTexts).toContain('mario.contractor@example.com');
    expect(cellTexts).toContain('+39 02 9876');
    expect(cellTexts).toContain('Paola Manager');
    expect(cellTexts).not.toContain('mario.contractor@example.com+39 02 9876');
  });

  test('clicking a row opens the edit modal populated for that employee', () => {
    renderView();
    expect(screen.queryByDisplayValue('Mario Rossi')).not.toBeInTheDocument();

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');
    // cursor-pointer is added by StandardTable only when onRowClick is defined.
    expect(row).toHaveClass('cursor-pointer');

    fireEvent.click(row);

    expect(screen.getByDisplayValue('Mario Rossi')).toBeInTheDocument();
    expect(screen.getByLabelText('common:labels.fullName *')).toBeEnabled();
    expect(screen.getByLabelText('employeeProfile.firstName')).toBeEnabled();
    expect(screen.getByLabelText('employeeProfile.lastName')).toBeEnabled();
    expect(screen.getByLabelText('employeeProfile.email')).toBeEnabled();
    expect(screen.getByLabelText('employeeProfile.phone')).toBeEnabled();
  });

  test('shows derived department in table and edit form', () => {
    renderView({ workUnits });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');

    expect(within(row).getByText('Alpha Center, Beta Center')).toBeInTheDocument();
    fireEvent.click(row);

    const department = screen.getByLabelText('employeeProfile.department');
    expect(department.tagName).toBe('OUTPUT');
    expect(department).toHaveTextContent('Alpha Center, Beta Center');
    expect(screen.queryByDisplayValue('Alpha Center, Beta Center')).not.toBeInTheDocument();
  });

  test('row is not clickable without update permission', () => {
    renderView({ permissions: ['hr.external.view'] });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');
    // No onRowClick is wired when the user can't edit, so no clickable affordance.
    expect(row).not.toHaveClass('cursor-pointer');

    fireEvent.click(row);

    expect(screen.queryByDisplayValue('Mario Rossi')).not.toBeInTheDocument();
  });

  test('cost-only editor opens the calendar and submits only hourly cost periods', async () => {
    const onUpdateEmployee = mock<
      (id: string, updates: Partial<User>) => Promise<{ success: boolean; error?: string }>
    >(async () => ({ success: true }));
    renderView({
      onUpdateEmployee,
      permissions: ['hr.external.view', 'hr.costs_all.view', 'hr.costs_all.update'],
    });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');
    expect(row).toHaveClass('cursor-pointer');
    fireEvent.click(row);

    expect(screen.getByLabelText('common:labels.fullName *')).toBeDisabled();
    await waitFor(() => expect(getHourlyCostPeriodsMock).toHaveBeenCalledWith('u1'));
    await screen.findByText('€ 31,50');

    const saveButton = screen.getByText('externalEmployees.saveChanges');
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onUpdateEmployee).toHaveBeenCalledTimes(1));
    expect(onUpdateEmployee).toHaveBeenCalledWith('u1', {
      hourlyCostPeriods: [{ effectiveFrom: null, costPerHour: 31.5 }],
    });
  });

  test('does not synthesize table values for unset HR profile fields', () => {
    renderView({
      users: [
        {
          ...employee,
          email: undefined,
          phone: null,
          jobTitle: null,
          department: null,
          responsibleUserId: null,
          responsibleUserName: null,
          employeeCode: null,
          employmentStatus: null,
          contractType: 'contractor',
        },
      ],
    });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');

    expect(
      within(row).queryByText('employeeProfile.employmentStatuses.active'),
    ).not.toBeInTheDocument();
    expect(within(row).getAllByText('employeeProfile.notSet').length).toBeGreaterThanOrEqual(4);

    fireEvent.click(row);

    expect(screen.getByLabelText('employeeProfile.email')).toHaveValue('');
    expect(screen.getByLabelText('employeeProfile.jobTitle')).toHaveValue('');
    const department = screen.getByLabelText('employeeProfile.department');
    expect(department.tagName).toBe('OUTPUT');
    expect(department).toHaveTextContent('employeeProfile.notSet');
    expect(screen.getByLabelText('employeeProfile.employeeCode')).toHaveValue('');
  });

  test('submits HR profile fields when creating with external create permission', async () => {
    const user = userEvent.setup();
    const onAddEmployee = mock<ComponentProps<typeof ExternalEmployeesView>['onAddEmployee']>(
      async () => ({ success: true }),
    );
    renderView({
      users: [],
      onAddEmployee,
      permissions: ['hr.external.view', 'hr.external.create'],
    });

    fireEvent.click(screen.getByText('externalEmployees.addEmployee'));
    fireEvent.change(screen.getByLabelText('common:labels.fullName *'), {
      target: { value: 'Luisa Bianchi' },
    });
    fireEvent.change(screen.getByLabelText('employeeProfile.email'), {
      target: { value: 'luisa.contractor@example.com' },
    });
    fireEvent.change(screen.getByLabelText('employeeProfile.phone'), {
      target: { value: '+39 02 5555' },
    });
    fireEvent.change(screen.getByLabelText('employeeProfile.jobTitle'), {
      target: { value: 'Contractor' },
    });
    fireEvent.change(screen.getByLabelText('employeeProfile.address'), {
      target: { value: 'Via Milano 2' },
    });
    await user.click(screen.getByLabelText('employeeProfile.responsible'));
    await user.click(await screen.findByText('Paola Manager (pmanager)'));

    fireEvent.click(screen.getByText('externalEmployees.saveChanges'));

    await waitFor(() => expect(onAddEmployee).toHaveBeenCalledTimes(1));
    expect(onAddEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Luisa Bianchi',
        email: 'luisa.contractor@example.com',
        phone: '+39 02 5555',
        jobTitle: 'Contractor',
        responsibleUserId: 'u-manager',
        address: 'Via Milano 2',
      }),
    );
    expect(onAddEmployee.mock.calls[0][0]).not.toHaveProperty('department');
  });

  test('disables provider-managed identity while keeping phone enabled', () => {
    renderView({ users: [{ ...employee, authMethod: 'saml' }] });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');
    fireEvent.click(row);

    expect(screen.getByLabelText('common:labels.fullName *')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.firstName')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.lastName')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.email')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.phone')).toBeEnabled();
  });

  test('keeps the edit modal open and shows an error when update fails', async () => {
    const onUpdateEmployee = mock(async () => ({
      success: false as const,
      error: 'Update rejected',
    }));
    renderView({ onUpdateEmployee });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');
    fireEvent.click(row);

    fireEvent.click(screen.getByText('externalEmployees.saveChanges'));

    await waitFor(() => expect(onUpdateEmployee).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Update rejected')).toBeInTheDocument();
    expect(screen.getByText('externalEmployees.editEmployee')).toBeInTheDocument();
  });

  test('keeps the delete confirmation open and shows an error when delete fails', async () => {
    const user = userEvent.setup();
    const onDeleteEmployee = mock(async () => ({
      success: false as const,
      error: 'Delete rejected',
    }));
    renderView({
      onDeleteEmployee,
      permissions: ['hr.external.view', 'hr.external.update', 'hr.external.delete'],
    });

    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
    await user.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));

    expect(await screen.findByText('externalEmployees.deleteEmployee')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'buttons.yesDelete' }));

    await waitFor(() => expect(onDeleteEmployee).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText('Delete rejected')).toBeInTheDocument();
    expect(screen.getByText('externalEmployees.deleteEmployee')).toBeInTheDocument();
  });

  test('keeps the delete confirmation open when delete throws', async () => {
    const user = userEvent.setup();
    const onDeleteEmployee = mock(async () => {
      throw new Error('Network down');
    });
    renderView({
      onDeleteEmployee,
      permissions: ['hr.external.view', 'hr.external.update', 'hr.external.delete'],
    });

    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
    await user.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    await user.click(await screen.findByRole('button', { name: 'buttons.yesDelete' }));

    expect(await screen.findByText('Network down')).toBeInTheDocument();
    expect(screen.getByText('externalEmployees.deleteEmployee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'buttons.yesDelete' })).toBeEnabled();
  });
});
