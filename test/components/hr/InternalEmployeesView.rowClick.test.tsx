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

const InternalEmployeesView = (await import('../../../components/HR/InternalEmployeesView'))
  .default;

const employee: User = {
  id: 'u1',
  name: 'Mario Rossi',
  role: 'user',
  avatarInitials: 'MR',
  username: 'mrossi',
  employeeType: 'internal',
  authMethod: 'local',
  costPerHour: 25,
  email: 'mario@example.com',
  phone: '+39 02 1234',
  jobTitle: 'Consultant',
  department: 'Delivery',
  responsibleUserId: 'u-manager',
  responsibleUserName: 'Paola Manager',
  employeeCode: 'EMP-001',
  employmentStatus: 'active',
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

const renderView = (overrides: Partial<ComponentProps<typeof InternalEmployeesView>> = {}) => {
  const props: ComponentProps<typeof InternalEmployeesView> = {
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
    permissions: ['hr.internal.view', 'hr.internal.update'],
    ...overrides,
  };
  render(<InternalEmployeesView {...props} />);
  return props;
};

describe('<InternalEmployeesView /> row click', () => {
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
    expect(cellTexts).toContain('mario@example.com');
    expect(cellTexts).toContain('+39 02 1234');
    expect(cellTexts).toContain('Paola Manager');
    expect(cellTexts).not.toContain('mario@example.com+39 02 1234');
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
    expect(screen.getByDisplayValue('mario@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+39 02 1234')).toBeInTheDocument();
    expect(screen.getByDisplayValue('EMP-001')).toBeInTheDocument();
  });

  test('shows derived department as read-only and filters responsible self option', async () => {
    const user = userEvent.setup();
    renderView({ workUnits });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');

    expect(within(row).getByText('Alpha Center, Beta Center')).toBeInTheDocument();
    fireEvent.click(row);

    const department = screen.getByLabelText('employeeProfile.department');
    expect(department.tagName).toBe('OUTPUT');
    expect(department).toHaveTextContent('Alpha Center, Beta Center');
    expect(screen.queryByDisplayValue('Alpha Center, Beta Center')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('employeeProfile.responsible'));
    expect(screen.queryByText('Mario Rossi (mrossi)')).not.toBeInTheDocument();
    expect(await screen.findAllByText('Paola Manager (pmanager)')).not.toHaveLength(0);
  });

  test('row is not clickable without update permission', () => {
    renderView({ permissions: ['hr.internal.view'] });

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
      permissions: ['hr.internal.view', 'hr.costs_all.view', 'hr.costs_all.update'],
    });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');
    expect(row).toHaveClass('cursor-pointer');
    fireEvent.click(row);

    expect(screen.getByLabelText('common:labels.fullName *')).toBeDisabled();
    await waitFor(() => expect(getHourlyCostPeriodsMock).toHaveBeenCalledWith('u1'));
    await screen.findByText('€ 31,50');

    const saveButton = screen.getByText('internalEmployees.saveChanges');
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onUpdateEmployee).toHaveBeenCalledTimes(1));
    expect(onUpdateEmployee).toHaveBeenCalledWith('u1', {
      hourlyCostPeriods: [{ effectiveFrom: null, costPerHour: 31.5 }],
    });
  });

  test('cost viewer opens the calendar in read-only mode', async () => {
    renderView({ permissions: ['hr.internal.view', 'hr.costs_all.view'] });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');
    expect(row).toHaveClass('cursor-pointer');
    fireEvent.click(row);

    await waitFor(() => expect(getHourlyCostPeriodsMock).toHaveBeenCalledWith('u1'));
    expect(screen.getByLabelText('common:labels.fullName *')).toBeDisabled();
    expect(screen.queryByText('internalEmployees.saveChanges')).not.toBeInTheDocument();
  });

  test('does not synthesize table values for unset HR profile fields', () => {
    renderView({
      users: [
        {
          ...employee,
          employeeType: 'app_user',
          role: 'manager',
          email: undefined,
          phone: null,
          jobTitle: null,
          department: null,
          responsibleUserId: null,
          responsibleUserName: null,
          employeeCode: null,
          employmentStatus: null,
        },
      ],
    });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');

    expect(within(row).queryByText('manager')).not.toBeInTheDocument();
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

  test('submits HR profile fields when creating an internal employee', async () => {
    const user = userEvent.setup();
    const onAddEmployee = mock<ComponentProps<typeof InternalEmployeesView>['onAddEmployee']>(
      async () => ({ success: true }),
    );
    renderView({
      users: [],
      onAddEmployee,
      permissions: [
        'hr.internal.view',
        'hr.internal.update',
        'administration.user_management.create',
      ],
    });

    fireEvent.click(screen.getByText('internalEmployees.addEmployee'));
    fireEvent.change(screen.getByLabelText('common:labels.fullName *'), {
      target: { value: 'Luisa Bianchi' },
    });
    fireEvent.change(screen.getByLabelText('employeeProfile.email'), {
      target: { value: 'luisa@example.com' },
    });
    fireEvent.change(screen.getByLabelText('employeeProfile.phone'), {
      target: { value: '+39 02 5555' },
    });
    fireEvent.change(screen.getByLabelText('employeeProfile.jobTitle'), {
      target: { value: 'HR Specialist' },
    });
    fireEvent.change(screen.getByLabelText('employeeProfile.employeeCode'), {
      target: { value: 'EMP-222' },
    });
    fireEvent.change(screen.getByLabelText('employeeProfile.address'), {
      target: { value: 'Via Roma 1' },
    });
    await user.click(screen.getByLabelText('employeeProfile.responsible'));
    await user.click(await screen.findByText('Paola Manager (pmanager)'));

    fireEvent.click(screen.getByText('internalEmployees.saveChanges'));

    await waitFor(() => expect(onAddEmployee).toHaveBeenCalledTimes(1));
    expect(onAddEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Luisa Bianchi',
        email: 'luisa@example.com',
        phone: '+39 02 5555',
        jobTitle: 'HR Specialist',
        responsibleUserId: 'u-manager',
        employeeCode: 'EMP-222',
        address: 'Via Roma 1',
      }),
    );
    expect(onAddEmployee.mock.calls[0][0]).not.toHaveProperty('department');
  });

  test('omits HR profile fields when creating with only user-management create', async () => {
    const onAddEmployee = mock(async () => ({ success: true }));
    renderView({
      users: [],
      onAddEmployee,
      permissions: ['hr.internal.view', 'administration.user_management.create'],
    });

    fireEvent.click(screen.getByText('internalEmployees.addEmployee'));
    expect(screen.getByLabelText('common:labels.fullName *')).toBeEnabled();
    expect(screen.getByLabelText('employeeProfile.phone')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.employeeCode')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('common:labels.fullName *'), {
      target: { value: 'Luisa Bianchi' },
    });
    fireEvent.click(screen.getByText('internalEmployees.saveChanges'));

    await waitFor(() => expect(onAddEmployee).toHaveBeenCalledTimes(1));
    expect(onAddEmployee).toHaveBeenCalledWith({
      name: 'Luisa Bianchi',
    });
  });

  test('does not show add action for legacy hr.internal.create', () => {
    renderView({
      users: [],
      permissions: ['hr.internal.view', 'hr.internal.create', 'hr.internal.update'],
    });

    expect(screen.queryByText('internalEmployees.addEmployee')).not.toBeInTheDocument();
  });

  test('shows internal delete only with user-management delete', async () => {
    const user = userEvent.setup();
    renderView({
      permissions: [
        'hr.internal.view',
        'hr.internal.update',
        'administration.user_management.delete',
      ],
    });

    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
    expect(
      await screen.findByRole('button', { name: 'common:buttons.delete' }),
    ).toBeInTheDocument();
  });

  test('does not show internal delete for legacy hr.internal.delete', async () => {
    const user = userEvent.setup();
    renderView({
      permissions: ['hr.internal.view', 'hr.internal.update', 'hr.internal.delete'],
    });

    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
    await screen.findByRole('button', { name: 'internalEmployees.editEmployee' });
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).not.toBeInTheDocument();
  });

  test.each([
    'ldap',
    'oidc',
    'saml',
  ] as const)('keeps %s-managed identity disabled while allowing phone edits', async (authMethod) => {
    const onUpdateEmployee = mock<
      (id: string, updates: Partial<User>) => Promise<{ success: boolean; error?: string }>
    >(async () => ({ success: true }));
    renderView({
      users: [{ ...employee, employeeType: 'app_user', authMethod }],
      onUpdateEmployee,
    });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');
    fireEvent.click(row);

    expect(screen.getByLabelText('common:labels.fullName *')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.email')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.firstName')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.lastName')).toBeDisabled();
    const phoneInput = screen.getByLabelText('employeeProfile.phone');
    expect(phoneInput).toBeEnabled();
    fireEvent.change(phoneInput, {
      target: { value: '+39 02 9999' },
    });
    fireEvent.click(screen.getByText('internalEmployees.saveChanges'));

    await waitFor(() => expect(onUpdateEmployee).toHaveBeenCalledTimes(1));
    const updates = onUpdateEmployee.mock.calls[0][1] as Partial<User>;
    expect(updates).toEqual(expect.objectContaining({ phone: '+39 02 9999' }));
    expect(updates).not.toHaveProperty('name');
    expect(updates).not.toHaveProperty('email');
    expect(updates).not.toHaveProperty('firstName');
    expect(updates).not.toHaveProperty('lastName');
  });

  test('sorts by the structured last name rather than the display-name tail', () => {
    renderView({
      users: [
        { ...employee, id: 'u-rossi', name: 'Mario Rossi', firstName: 'Mario', lastName: 'Rossi' },
        // Display-name tail "Verdi" sorts after "Rossi", but the stored surname "Bianchi"
        // sorts before it — so this employee must render first.
        {
          ...employee,
          id: 'u-bianchi',
          name: 'Anna Verdi',
          firstName: 'Anna',
          lastName: 'Bianchi',
        },
      ],
    });

    const bodyText = document.body.textContent ?? '';
    expect(bodyText.indexOf('Anna Verdi')).toBeLessThan(bodyText.indexOf('Mario Rossi'));
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

    fireEvent.click(screen.getByText('internalEmployees.saveChanges'));

    await waitFor(() => expect(onUpdateEmployee).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Update rejected')).toBeInTheDocument();
    expect(screen.getByText('internalEmployees.editEmployee')).toBeInTheDocument();
  });

  test('keeps the delete confirmation open and shows an error when delete fails', async () => {
    const user = userEvent.setup();
    const onDeleteEmployee = mock(async () => ({
      success: false as const,
      error: 'Delete rejected',
    }));
    renderView({
      onDeleteEmployee,
      permissions: [
        'hr.internal.view',
        'hr.internal.update',
        'administration.user_management.delete',
      ],
    });

    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
    await user.click(screen.getByRole('button', { name: 'common:buttons.delete' }));

    expect(screen.getByText('internalEmployees.deleteEmployee')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'buttons.yesDelete' }));

    await waitFor(() => expect(onDeleteEmployee).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText('Delete rejected')).toBeInTheDocument();
    expect(screen.getByText('internalEmployees.deleteEmployee')).toBeInTheDocument();
  });

  test('keeps the delete confirmation open when delete throws', async () => {
    const user = userEvent.setup();
    const onDeleteEmployee = mock(async () => {
      throw new Error('Network down');
    });
    renderView({
      onDeleteEmployee,
      permissions: [
        'hr.internal.view',
        'hr.internal.update',
        'administration.user_management.delete',
      ],
    });

    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
    await user.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await user.click(screen.getByRole('button', { name: 'buttons.yesDelete' }));

    expect(await screen.findByText('Network down')).toBeInTheDocument();
    expect(screen.getByText('internalEmployees.deleteEmployee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'buttons.yesDelete' })).toBeEnabled();
  });
});
