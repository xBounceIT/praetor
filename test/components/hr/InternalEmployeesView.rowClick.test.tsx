import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { User } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

// The view only touches services/api transitively via the assignments modal,
// which this test never opens. Stub it so the view has no API dependency, which
// also avoids cross-file mock-leak fragility in the shared test runner.
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
  costPerHour: 25,
  email: 'mario@example.com',
  phone: '+39 02 1234',
  jobTitle: 'Consultant',
  department: 'Delivery',
  employeeCode: 'EMP-001',
  employmentStatus: 'active',
};

const renderView = (overrides: Partial<ComponentProps<typeof InternalEmployeesView>> = {}) => {
  const props: ComponentProps<typeof InternalEmployeesView> = {
    users: [employee],
    clients: [],
    projects: [],
    tasks: [],
    onAddEmployee: mock(async () => ({ success: true })),
    onUpdateEmployee: mock<(id: string, updates: Partial<User>) => void>(() => {}),
    onDeleteEmployee: mock(() => {}),
    currency: '€',
    permissions: ['hr.internal.view', 'hr.internal.update'],
    ...overrides,
  };
  render(<InternalEmployeesView {...props} />);
  return props;
};

describe('<InternalEmployeesView /> row click', () => {
  test('renders email and phone as separate table columns', () => {
    renderView();

    const headerTexts = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headerTexts).toContain('common:labels.email');
    expect(headerTexts).toContain('common:labels.phone');
    expect(headerTexts).not.toContain('employeeProfile.contact');

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');

    const cellTexts = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent?.trim());
    expect(cellTexts).toContain('mario@example.com');
    expect(cellTexts).toContain('+39 02 1234');
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
    expect(screen.getByDisplayValue('mario@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+39 02 1234')).toBeInTheDocument();
    expect(screen.getByDisplayValue('EMP-001')).toBeInTheDocument();
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
    expect(screen.getByLabelText('employeeProfile.department')).toHaveValue('');
    expect(screen.getByLabelText('employeeProfile.employeeCode')).toHaveValue('');
  });

  test('submits HR profile fields when creating an internal employee', async () => {
    const onAddEmployee = mock(async () => ({ success: true }));
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
    fireEvent.change(screen.getByLabelText('internalEmployees.name *'), {
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

    fireEvent.click(screen.getByText('internalEmployees.saveChanges'));

    await waitFor(() => expect(onAddEmployee).toHaveBeenCalledTimes(1));
    expect(onAddEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Luisa Bianchi',
        email: 'luisa@example.com',
        phone: '+39 02 5555',
        jobTitle: 'HR Specialist',
        employeeCode: 'EMP-222',
      }),
    );
  });

  test('omits HR profile fields when creating with only user-management create', async () => {
    const onAddEmployee = mock(async () => ({ success: true }));
    renderView({
      users: [],
      onAddEmployee,
      permissions: ['hr.internal.view', 'administration.user_management.create'],
    });

    fireEvent.click(screen.getByText('internalEmployees.addEmployee'));
    expect(screen.getByLabelText('employeeProfile.phone')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.employeeCode')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('internalEmployees.name *'), {
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

  test('keeps provider-managed name and email read-only on edit', async () => {
    const onUpdateEmployee = mock<(id: string, updates: Partial<User>) => void>(() => {});
    renderView({
      users: [{ ...employee, employeeType: 'app_user', authMethod: 'ldap' }],
      onUpdateEmployee,
    });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');
    fireEvent.click(row);

    expect(screen.getByLabelText('internalEmployees.name *')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.email')).toBeDisabled();
    // First/last name are directory-managed identity too — read-only for LDAP-bound users.
    expect(screen.getByLabelText('employeeProfile.firstName')).toBeDisabled();
    expect(screen.getByLabelText('employeeProfile.lastName')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('employeeProfile.phone'), {
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
});
