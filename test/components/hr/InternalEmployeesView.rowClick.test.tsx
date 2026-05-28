import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { User } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

mock.module('../../../services/api', () => ({
  usersApi: {
    getAssignments: mock(async () => ({ clientIds: [], projectIds: [], taskIds: [] })),
    updateAssignments: mock(async () => {}),
  },
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
};

const renderView = (overrides: Partial<ComponentProps<typeof InternalEmployeesView>> = {}) => {
  const props: ComponentProps<typeof InternalEmployeesView> = {
    users: [employee],
    clients: [],
    projects: [],
    tasks: [],
    onAddEmployee: mock(async () => ({ success: true })),
    onUpdateEmployee: mock(() => {}),
    onDeleteEmployee: mock(() => {}),
    currency: '€',
    permissions: ['hr.internal.view', 'hr.internal.update'],
    ...overrides,
  };
  render(<InternalEmployeesView {...props} />);
  return props;
};

describe('<InternalEmployeesView /> row click', () => {
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
    renderView({ permissions: ['hr.internal.view'] });

    const row = screen.getByText('Mario Rossi').closest('tr');
    if (!row) throw new Error('employee row not found');
    // No onRowClick is wired when the user can't edit, so no clickable affordance.
    expect(row).not.toHaveClass('cursor-pointer');

    fireEvent.click(row);

    expect(screen.queryByDisplayValue('Mario Rossi')).not.toBeInTheDocument();
  });
});
