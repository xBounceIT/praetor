import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { ResponsibleUserOption, User, WorkUnit } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

// The view only touches services/api transitively via the assignments modal,
// which this test never opens. Stub it so the view has no API dependency, which
// also avoids cross-file mock-leak fragility in the shared test runner.
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
    onUpdateEmployee: mock(() => {}),
    onDeleteEmployee: mock(() => {}),
    currency: '€',
    permissions: ['hr.external.view', 'hr.external.update'],
    ...overrides,
  };
  render(<ExternalEmployeesView {...props} />);
  return props;
};

describe('<ExternalEmployeesView /> row click', () => {
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
  });

  test('shows derived department in table and edit form', () => {
    renderView({ workUnits });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');

    expect(within(row).getByText('Alpha Center, Beta Center')).toBeInTheDocument();
    fireEvent.click(row);

    const department = screen.getByLabelText('employeeProfile.department');
    expect(department).toHaveValue('Alpha Center, Beta Center');
    expect(department).toHaveAttribute('readonly');
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
    expect(screen.getByLabelText('employeeProfile.department')).toHaveValue('');
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
    fireEvent.change(screen.getByLabelText('externalEmployees.name *'), {
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
      }),
    );
    expect(onAddEmployee.mock.calls[0][0]).not.toHaveProperty('department');
  });
});
