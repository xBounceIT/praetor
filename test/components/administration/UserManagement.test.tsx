import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { User } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const usersApiMock = {
  getAssignments: mock(async () => ({ clientIds: [], projectIds: [], taskIds: [] })),
  getRoles: mock(async () => ({ roleIds: ['user'], primaryRoleId: 'user' })),
  updateAssignments: mock(async () => {}),
};

mock.module('../../../services/api/users', () => ({
  usersApi: usersApiMock,
}));

const UserManagement = (await import('../../../components/administration/UserManagement')).default;

const updatePermission = 'administration.user_management.update';
const deletePermission = 'administration.user_management.delete';
const createPermission = 'administration.user_management.create';

const users: User[] = [
  {
    id: 'u1',
    name: 'Alice Admin',
    role: 'admin',
    avatarInitials: 'AA',
    username: 'alice.admin',
    email: 'alice@example.com',
    employeeType: 'app_user',
    authMethod: 'local',
  },
  {
    id: 'u2',
    name: 'Bob Brown',
    role: 'manager',
    avatarInitials: 'BB',
    username: 'bob.brown',
    employeeType: 'app_user',
    authMethod: 'local',
  },
];

const renderUserManagement = (overrides: Partial<ComponentProps<typeof UserManagement>> = {}) => {
  const props: ComponentProps<typeof UserManagement> = {
    users,
    clients: [],
    projects: [],
    tasks: [],
    onAddUser: mock(async () => ({ success: true })),
    onDeleteUser: mock(() => {}),
    onUpdateUser: mock(() => {}),
    onUpdateUserRoles: mock(async () => {}),
    onUpdateUserAuthMethod: mock(async () => {}),
    currentUserId: 'u1',
    permissions: [updatePermission, deletePermission],
    roles: [],
    ssoProviders: [
      {
        id: 'sso-1',
        protocol: 'oidc',
        slug: 'keycloak',
        name: 'Keycloak',
        enabled: true,
        issuerUrl: '',
        clientId: '',
        clientSecret: '',
        scopes: '',
        metadataUrl: '',
        metadataXml: '',
        entryPoint: '',
        idpIssuer: '',
        idpCert: '',
        spIssuer: '',
        privateKey: '',
        publicCert: '',
        usernameAttribute: '',
        nameAttribute: '',
        emailAttribute: '',
        groupsAttribute: '',
        roleMappings: [],
      },
    ],
    currency: '$',
    ...overrides,
  };

  render(<UserManagement {...props} />);
  return props;
};

const getRowFor = (text: string) => {
  const row = screen.getByText(text).closest('tr');
  if (!row) throw new Error(`Could not find row for ${text}`);
  return row;
};

describe('<UserManagement />', () => {
  beforeEach(() => {
    localStorage.clear();
    usersApiMock.getAssignments.mockClear();
    usersApiMock.getRoles.mockClear();
    usersApiMock.updateAssignments.mockClear();
  });

  test('renders user details through StandardTable columns', () => {
    renderUserManagement();

    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('alice.admin')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('manager')).toBeInTheDocument();
    expect(screen.getByText('manager').closest('[data-status-badge]')).not.toBeNull();
    expect(screen.getByText('common:common.none')).toBeInTheDocument();
    expect(screen.getAllByText('common:common.active')).toHaveLength(2);
  });

  test('renders a distinct auth-method badge per protocol', () => {
    renderUserManagement({
      users: [
        {
          id: 'u-local',
          name: 'Local User',
          role: 'user',
          avatarInitials: 'LU',
          username: 'local.user',
          employeeType: 'app_user',
          authMethod: 'local',
        },
        {
          id: 'u-ldap',
          name: 'Ldap User',
          role: 'user',
          avatarInitials: 'LD',
          username: 'ldap.user',
          employeeType: 'app_user',
          authMethod: 'ldap',
        },
        {
          id: 'u-oidc',
          name: 'Oidc User',
          role: 'user',
          avatarInitials: 'OI',
          username: 'oidc.user',
          employeeType: 'app_user',
          authMethod: 'oidc',
          authProviderName: 'Keycloak',
        },
        {
          id: 'u-saml',
          name: 'Saml User',
          role: 'user',
          avatarInitials: 'SA',
          username: 'saml.user',
          employeeType: 'app_user',
          authMethod: 'saml',
          authProviderName: 'Okta',
        },
      ],
    });

    const authBadgeFor = (rowText: string) => {
      const row = getRowFor(rowText);
      const badges = row.querySelectorAll('[data-status-badge]');
      const authBadge = badges[badges.length - 2];
      if (!authBadge) throw new Error(`No auth badge found for ${rowText}`);
      return authBadge as HTMLElement;
    };

    expect(authBadgeFor('Local User').querySelector('i')?.className ?? '').toContain('fa-database');
    expect(authBadgeFor('Ldap User').querySelector('i')?.className ?? '').toContain('fa-sitemap');
    expect(authBadgeFor('Saml User').querySelector('i')?.className ?? '').toContain(
      'fa-building-shield',
    );
    const oidcBadge = authBadgeFor('Oidc User');
    expect(oidcBadge.querySelector('svg')).not.toBeNull();
    expect(oidcBadge.querySelector('i')).toBeNull();
  });

  test('filters users with the external search input', () => {
    renderUserManagement();

    fireEvent.change(screen.getByPlaceholderText('hr:workforce.searchUsers'), {
      target: { value: 'alice' },
    });

    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    expect(screen.queryByText('Bob Brown')).not.toBeInTheDocument();
  });

  test('opens edit modal when an editable row is clicked', () => {
    renderUserManagement();

    fireEvent.click(screen.getByText('Bob Brown'));

    expect(screen.getByText('hr:workforce.editUser')).toBeInTheDocument();
  });

  test('action button does not also trigger row edit', async () => {
    const user = userEvent.setup();
    const props = renderUserManagement();
    const bobRow = getRowFor('Bob Brown');
    const actionButton = bobRow.querySelector('[aria-label="table.rowActions"]');
    if (!actionButton) throw new Error('Could not find row actions button');

    await user.click(actionButton);
    const disableButton = await screen.findByRole('button', { name: 'hr:workforce.disableUser' });

    await user.click(disableButton);

    expect(props.onUpdateUser).toHaveBeenCalledWith('u2', { isDisabled: true });
    expect(usersApiMock.getRoles).not.toHaveBeenCalled();
  });

  test('shows empty state when no users match the search', () => {
    renderUserManagement();

    fireEvent.change(screen.getByPlaceholderText('hr:workforce.searchUsers'), {
      target: { value: 'nobody' },
    });

    expect(screen.getByText('hr:workforce.noUsers')).toBeInTheDocument();
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob Brown')).not.toBeInTheDocument();
  });

  test('opens authentication method dialog from row actions and saves', async () => {
    const user = userEvent.setup();
    const props = renderUserManagement();
    const bobRow = getRowFor('Bob Brown');
    const actionButton = bobRow.querySelector('[aria-label="table.rowActions"]');
    if (!actionButton) throw new Error('Could not find row actions button');

    await user.click(actionButton);
    await user.click(
      await screen.findByRole('button', { name: 'hr:workforce.authMethod.changeAction' }),
    );

    expect(screen.getByText('hr:workforce.authMethod.description')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    expect(props.onUpdateUserAuthMethod).toHaveBeenCalledWith('u2', 'local', null);
  });

  const openCreateUserModal = async () => {
    const user = userEvent.setup();
    renderUserManagement({
      permissions: [updatePermission, deletePermission, createPermission],
    });
    await user.click(screen.getByText('hr:workforce.addUser'));
    const firstNameInput = await screen.findByPlaceholderText('e.g. Alice');
    const usernameInput = screen.getByPlaceholderText('e.g. alice.smith') as HTMLInputElement;
    return { user, firstNameInput, usernameInput };
  };

  test('strips accents and special characters when auto-generating username', async () => {
    const { user, firstNameInput, usernameInput } = await openCreateUserModal();
    const surnameInput = screen.getByPlaceholderText('e.g. Smith');

    await user.type(firstNameInput, 'José');
    await user.type(surnameInput, "O'Brien");

    expect(usernameInput.value).toBe('jose.obrien');
  });

  test('strips hyphens and inner whitespace from a single name field', async () => {
    const { user, firstNameInput, usernameInput } = await openCreateUserModal();

    await user.type(firstNameInput, 'Anna-Maria');

    expect(usernameInput.value).toBe('annamaria');
  });
});
