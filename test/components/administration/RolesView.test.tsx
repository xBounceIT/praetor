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

describe('<RolesView />', () => {
  test('renders create/update/delete checkboxes for all-scope permission rows', () => {
    renderRolesView();

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    fireEvent.click(screen.getByRole('button', { name: 'layout:modules.crm' }));

    const clientsAllLabel = screen.getByText('administration:permissions.crm.clients_all');
    const row = clientsAllLabel.closest('tr');

    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getAllByRole('checkbox')).toHaveLength(4);
  });
});
