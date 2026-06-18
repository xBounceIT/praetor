import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, within } from '@testing-library/react';
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
};

const renderView = (overrides: Partial<ComponentProps<typeof ExternalEmployeesView>> = {}) => {
  const props: ComponentProps<typeof ExternalEmployeesView> = {
    users: [employee],
    clients: [],
    projects: [],
    tasks: [],
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
    expect(headerTexts).toContain('common:labels.phone');
    expect(headerTexts).not.toContain('employeeProfile.contact');

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');

    const cellTexts = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent?.trim());
    expect(cellTexts).toContain('mario.contractor@example.com');
    expect(cellTexts).toContain('+39 02 9876');
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
});
