import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, within } from '@testing-library/react';
import RolesView from '../../../components/administration/RolesView';
import { rolesViewReducer } from '../../../components/administration/rolesViewState';
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

const openCreateAndSwitchToModule = (module: 'crm' | 'hr') => {
  fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
  const tab = screen.getByRole('tab', { name: new RegExp(`layout:modules\\.${module}`) });
  fireEvent.mouseDown(tab);
};

const findClientsAllRow = () => {
  const label = screen.getByText('administration:permissions.crm.clients_all');
  const row = label.closest('tr');
  if (!row) throw new Error('clients_all row not found');
  return row as HTMLElement;
};

const findHrInternalRow = () => {
  const label = screen.getByText('administration:permissions.hr.internal');
  const row = label.closest('tr');
  if (!row) throw new Error('hr.internal row not found');
  return row as HTMLElement;
};

describe('rolesViewReducer', () => {
  test('preserves state for unrecognized reducer actions', () => {
    const state = {
      isCreateOpen: false,
      isRenameOpen: false,
      isPermissionsOpen: false,
      isDeleteConfirmOpen: false,
      isDeleting: false,
      activeRole: null,
      roleName: '',
      selectedPermissions: [],
      formErrors: {},
      activeModuleTab: '',
    } satisfies Parameters<typeof rolesViewReducer>[0];
    const unrecognizedAction = { type: 'unrecognized' } as unknown as Parameters<
      typeof rolesViewReducer
    >[1];

    expect(rolesViewReducer(state, unrecognizedAction)).toBe(state);
  });
});

describe('<RolesView />', () => {
  test('renders create/update/delete checkboxes for all-scope permission rows', () => {
    renderRolesView();
    openCreateAndSwitchToModule('crm');

    const row = findClientsAllRow();
    expect(within(row).getAllByRole('checkbox')).toHaveLength(4);
  });

  test('select-all switch stays off when only some actions are checked', () => {
    renderRolesView();
    openCreateAndSwitchToModule('crm');

    const row = findClientsAllRow();
    const [firstCheckbox] = within(row).getAllByRole('checkbox');
    fireEvent.click(firstCheckbox);
    expect(firstCheckbox.getAttribute('data-state')).toBe('checked');

    const selectAllSwitch = within(row).getByRole('switch');
    expect(selectAllSwitch.getAttribute('data-state')).toBe('unchecked');
  });

  test('flipping the select-all switch on checks every action in the row', () => {
    renderRolesView();
    openCreateAndSwitchToModule('crm');

    const row = findClientsAllRow();
    const selectAllSwitch = within(row).getByRole('switch');
    fireEvent.click(selectAllSwitch);

    expect(selectAllSwitch.getAttribute('data-state')).toBe('checked');
    for (const checkbox of within(row).getAllByRole('checkbox')) {
      expect(checkbox.getAttribute('data-state')).toBe('checked');
    }
  });

  test('renders N/A cells for unavailable hr.internal create/delete actions', () => {
    renderRolesView();
    openCreateAndSwitchToModule('hr');

    const row = findHrInternalRow();
    expect(within(row).getAllByText('common:table.empty')).toHaveLength(2);
    expect(within(row).getAllByRole('checkbox')).toHaveLength(2);
  });
});
