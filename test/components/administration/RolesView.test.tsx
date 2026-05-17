import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, within } from '@testing-library/react';
import RolesView from '../../../components/administration/RolesView';
import type { Role } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const roles: Role[] = [
  {
    id: 'manager',
    name: 'Manager',
    permissions: [],
    isAdmin: false,
    isSystem: false,
  },
];

const renderRolesView = () =>
  render(
    <RolesView
      roles={roles}
      permissions={['administration.roles.create', 'administration.roles.update']}
      onCreateRole={mock(async () => {})}
      onRenameRole={mock(async () => {})}
      onUpdateRolePermissions={mock(async () => {})}
      onDeleteRole={mock(async () => {})}
    />,
  );

const openCreateAndSwitchToCrm = () => {
  fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
  fireEvent.mouseDown(screen.getByRole('tab', { name: /layout:modules.crm/ }));
};

const findClientsAllRow = () => {
  const label = screen.getByText('administration:permissions.crm.clients_all');
  const row = label.closest('tr');
  if (!row) throw new Error('clients_all row not found');
  return row as HTMLElement;
};

describe('<RolesView />', () => {
  test('renders create/update/delete checkboxes for all-scope permission rows', () => {
    renderRolesView();
    openCreateAndSwitchToCrm();

    const row = findClientsAllRow();
    expect(within(row).getAllByRole('checkbox')).toHaveLength(4);
  });

  test('select-all toggle promotes a partial selection to all-selected', () => {
    renderRolesView();
    openCreateAndSwitchToCrm();

    const row = findClientsAllRow();
    const [firstCheckbox] = within(row).getAllByRole('checkbox');
    fireEvent.click(firstCheckbox);
    expect(firstCheckbox.getAttribute('data-state')).toBe('checked');

    const selectAllToggle = within(row).getByRole('switch');
    expect(selectAllToggle.getAttribute('data-state')).toBe('checked');

    fireEvent.click(selectAllToggle);

    for (const checkbox of within(row).getAllByRole('checkbox')) {
      expect(checkbox.getAttribute('data-state')).toBe('checked');
    }
  });
});
