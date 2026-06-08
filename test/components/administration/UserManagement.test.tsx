import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { User } from '../../../types';
import { THEME_STORAGE_KEY } from '../../../utils/theme';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

installI18nMock();

const usersApiMock = {
  getAssignments: mock(async () => ({ clientIds: [], projectIds: [], taskIds: [] })),
  getRoles: mock(async () => ({ roleIds: ['user'], primaryRoleId: 'user' })),
  updateAssignments: mock(async () => {}),
};

mock.module('../../../services/api/users', () => ({
  usersApi: usersApiMock,
}));

// confirmTotpReset() fires a success toast on resolve; stub sonner-backed toast
// helpers so the success path doesn't touch the real notification system in jsdom.
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});

mock.module('../../../utils/toast', () => ({
  toastSuccess: toastSuccessMock,
  toastError: toastErrorMock,
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

clearSpyStateAfterAll();

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
    onResetUserTotp: mock(async () => {}),
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
        endSessionEnabled: false,
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

  test('locks synced identity fields for non-local users and omits them from account updates', async () => {
    const ldapUser: User = {
      id: 'u-ldap',
      name: 'Lara LDAP',
      role: 'user',
      avatarInitials: 'LL',
      username: 'lara.ldap',
      email: 'lara.ldap@example.com',
      employeeType: 'app_user',
      authMethod: 'ldap',
    };
    const onUpdateUser = mock(() => {});
    renderUserManagement({
      users: [users[0], ldapUser],
      onUpdateUser,
    });

    fireEvent.click(screen.getByText('Lara LDAP'));
    await screen.findByText('hr:workforce.editUser');

    const firstNameInput = screen.getByLabelText('hr:workforce.name') as HTMLInputElement;
    const surnameInput = screen.getByLabelText('hr:workforce.surname') as HTMLInputElement;
    const emailInput = screen.getByLabelText('common:labels.email') as HTMLInputElement;
    expect(firstNameInput).toBeDisabled();
    expect(surnameInput).toBeDisabled();
    expect(emailInput).toBeDisabled();
    expect(firstNameInput.value).toBe('Lara');
    expect(surnameInput.value).toBe('LDAP');
    expect(emailInput.value).toBe('lara.ldap@example.com');
    expect(screen.getByText('hr:workforce.identityManagedByProvider')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: 'hr:workforce.saveChanges' });
    expect(saveButton).toBeDisabled();
    const disabledToggle = document.body.querySelector<HTMLElement>('[role="switch"]');
    if (!disabledToggle) throw new Error('Disabled switch not rendered');
    fireEvent.click(disabledToggle);
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    fireEvent.click(saveButton);

    expect(onUpdateUser).toHaveBeenCalledWith('u-ldap', { isDisabled: true });
    const [, updates] = onUpdateUser.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(updates).not.toHaveProperty('name');
    expect(updates).not.toHaveProperty('email');
  });

  const openAuthMethodDialog = async (
    rowName = 'Bob Brown',
    overrides: Partial<ComponentProps<typeof UserManagement>> = {},
  ) => {
    const user = userEvent.setup();
    const props = renderUserManagement(overrides);
    const row = getRowFor(rowName);
    const actionButton = row.querySelector('[aria-label="table.rowActions"]');
    if (!actionButton) throw new Error('Could not find row actions button');

    await user.click(actionButton);
    await user.click(
      await screen.findByRole('button', { name: 'hr:workforce.authMethod.changeAction' }),
    );
    return { user, props };
  };

  test('opens authentication method dialog from row actions and saves', async () => {
    const { user, props } = await openAuthMethodDialog();

    expect(screen.getByText('hr:workforce.authMethod.description')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'common:buttons.save' }));

    expect(props.onUpdateUserAuthMethod).toHaveBeenCalledWith('u2', 'local', null);
  });

  test('auth-method dialog carries the resolved shadcn theme scope', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    await openAuthMethodDialog();

    const dialogContent = await waitFor(() => {
      const node = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
      if (!node) throw new Error('Dialog content not rendered yet');
      return node;
    });

    expect(dialogContent.getAttribute('data-shadcn-theme-scope')).toBe('');
    expect(dialogContent.getAttribute('data-shadcn-theme')).toBe('dark');
    expect(dialogContent.className).toContain('dark');
  });

  test('auth-method select opens via popper and lists all four protocols', async () => {
    const { user } = await openAuthMethodDialog();

    const trigger = screen.getAllByRole('combobox')[0];
    if (!trigger) throw new Error('Auth-method select trigger not rendered');

    await user.click(trigger);

    // position="popper" renders the listbox in a portal at body level. Wait
    // for it to appear and assert all four protocol labels are mounted.
    const listbox = await waitFor(() => {
      const node = document.body.querySelector<HTMLElement>('[role="listbox"]');
      if (!node) throw new Error('Listbox not rendered yet');
      return node;
    });

    const optionTexts = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')).map(
      (opt) => opt.textContent ?? '',
    );

    expect(optionTexts).toEqual(
      expect.arrayContaining([
        'hr:workforce.authMethod.local',
        'hr:workforce.authMethod.ldap',
        'hr:workforce.authMethod.oidc',
        'hr:workforce.authMethod.saml',
      ]),
    );
  });

  test('provider select appears when the user is already on an SSO method', async () => {
    const ssoUser: User = {
      id: 'u3',
      name: 'Carla SSO',
      role: 'user',
      avatarInitials: 'CS',
      username: 'carla.sso',
      email: 'carla@example.com',
      employeeType: 'app_user',
      authMethod: 'oidc',
      authProviderId: 'sso-1',
      authProviderName: 'Keycloak',
    };

    await openAuthMethodDialog('Carla SSO', { users: [...users, ssoUser] });

    expect(await screen.findByText('hr:workforce.authMethod.providerLabel')).toBeInTheDocument();
  });

  describe('reset 2FA row action', () => {
    // Row actions live behind the StandardTable overflow ("table.rowActions")
    // trigger and are portalled into the open menu, mirroring the auth-method
    // action tests above.
    test('exposes the Reset 2FA action for a local app_user that is not the current user', async () => {
      // current user is u1 (Alice); Bob (u2) is a local app_user, so the action
      // is both present and enabled.
      const user = userEvent.setup();
      renderUserManagement();
      const trigger = getRowFor('Bob Brown').querySelector('[aria-label="table.rowActions"]');
      if (!trigger) throw new Error('No row-actions trigger for Bob Brown');
      await user.click(trigger);

      const action = await screen.findByRole('button', { name: 'hr:totpReset.action' });
      expect(action).not.toBeDisabled();
    });

    test('confirming the dialog calls onResetUserTotp with the row id', async () => {
      const user = userEvent.setup();
      const props = renderUserManagement();
      const trigger = getRowFor('Bob Brown').querySelector('[aria-label="table.rowActions"]');
      if (!trigger) throw new Error('No row-actions trigger for Bob Brown');
      await user.click(trigger);

      await user.click(await screen.findByRole('button', { name: 'hr:totpReset.action' }));

      // The confirm dialog surfaces the hr:totpReset.* keys.
      expect(await screen.findByText('hr:totpReset.confirmTitle')).toBeInTheDocument();
      expect(screen.getByText('hr:totpReset.confirmDescription')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'hr:totpReset.confirm' }));

      expect(props.onResetUserTotp).toHaveBeenCalledTimes(1);
      expect(props.onResetUserTotp).toHaveBeenCalledWith('u2');
      await waitFor(() =>
        expect(screen.queryByText('hr:totpReset.confirmTitle')).not.toBeInTheDocument(),
      );
    });

    test('cancelling the dialog does not call onResetUserTotp', async () => {
      const user = userEvent.setup();
      const props = renderUserManagement();
      const trigger = getRowFor('Bob Brown').querySelector('[aria-label="table.rowActions"]');
      if (!trigger) throw new Error('No row-actions trigger for Bob Brown');
      await user.click(trigger);

      await user.click(await screen.findByRole('button', { name: 'hr:totpReset.action' }));
      await screen.findByText('hr:totpReset.confirmTitle');

      await user.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));

      expect(props.onResetUserTotp).not.toHaveBeenCalled();
    });

    test('hides the Reset 2FA action for provider-managed (oidc/saml) users', async () => {
      const user = userEvent.setup();
      renderUserManagement({
        users: [
          {
            id: 'u-oidc',
            name: 'Oscar OIDC',
            role: 'user',
            avatarInitials: 'OO',
            username: 'oscar.oidc',
            employeeType: 'app_user',
            authMethod: 'oidc',
            authProviderName: 'Keycloak',
          },
          {
            id: 'u-saml',
            name: 'Sara SAML',
            role: 'user',
            avatarInitials: 'SS',
            username: 'sara.saml',
            employeeType: 'app_user',
            authMethod: 'saml',
            authProviderName: 'Okta',
          },
        ],
      });

      for (const name of ['Oscar OIDC', 'Sara SAML']) {
        const trigger = getRowFor(name).querySelector('[aria-label="table.rowActions"]');
        if (!trigger) throw new Error(`No row-actions trigger for ${name}`);
        await user.click(trigger);
        // The menu is open (the auth-method action proves it mounted), but the
        // provider-managed identity means the reset action is omitted.
        await screen.findByRole('button', { name: 'hr:workforce.authMethod.changeAction' });
        expect(
          screen.queryByRole('button', { name: 'hr:totpReset.action' }),
        ).not.toBeInTheDocument();
        await user.keyboard('{Escape}');
      }
    });

    test('disables the Reset 2FA action for the current user', async () => {
      // Render with Bob (u2) as the current user: an admin cannot reset their own
      // 2FA from this table, so the action is rendered disabled.
      const user = userEvent.setup();
      renderUserManagement({ currentUserId: 'u2' });
      const trigger = getRowFor('Bob Brown').querySelector('[aria-label="table.rowActions"]');
      if (!trigger) throw new Error('No row-actions trigger for Bob Brown');
      await user.click(trigger);

      const action = await screen.findByRole('button', { name: 'hr:totpReset.action' });
      expect(action).toBeDisabled();
    });

    test('does not render the Reset 2FA action without update permission', async () => {
      // Without update rights the reset action is gone; the delete action keeps
      // the overflow menu populated so it still opens.
      const user = userEvent.setup();
      renderUserManagement({ permissions: [deletePermission] });
      const trigger = getRowFor('Bob Brown').querySelector('[aria-label="table.rowActions"]');
      if (!trigger) throw new Error('No row-actions trigger for Bob Brown');
      await user.click(trigger);

      await screen.findByRole('button', { name: 'hr:workforce.deleteUser' });
      expect(screen.queryByRole('button', { name: 'hr:totpReset.action' })).not.toBeInTheDocument();
    });
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

  test('password field is masked by default and the eye toggle reveals it', async () => {
    const { user } = await openCreateUserModal();
    const passwordInput = document.getElementById('create-user-password') as HTMLInputElement;
    expect(passwordInput).not.toBeNull();
    expect(passwordInput.type).toBe('password');

    const toggle = screen.getByRole('button', { name: 'common:labels.showPassword' });
    await user.click(toggle);
    expect(passwordInput.type).toBe('text');
    expect(screen.getByRole('button', { name: 'common:labels.hidePassword' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'common:labels.hidePassword' }));
    expect(passwordInput.type).toBe('password');
  });

  describe('cost-per-hour permission gating in edit dialog', () => {
    // The cost input only renders when the caller can both see costs (hr.costs_all.view)
    // and edit the target user's cost (hr.costs_all.update for anyone, or hr.costs.update
    // for self).
    const usersForCostTests: User[] = [
      {
        id: 'u-self',
        name: 'Mary Manager',
        role: 'manager',
        avatarInitials: 'MM',
        username: 'mary.manager',
        employeeType: 'app_user',
        authMethod: 'local',
      },
      {
        id: 'u-other',
        name: 'Bob Brown',
        role: 'user',
        avatarInitials: 'BB',
        username: 'bob.brown',
        employeeType: 'app_user',
        authMethod: 'local',
      },
    ];

    const openEditDialog = async (
      rowName: string,
      overrides: Partial<ComponentProps<typeof UserManagement>>,
    ) => {
      renderUserManagement({
        users: usersForCostTests,
        currentUserId: 'u-self',
        ...overrides,
      });
      fireEvent.click(screen.getByText(rowName));
      // Wait for the modal to mount (header is rendered by the edit dialog only).
      await screen.findByText('hr:workforce.editUser');
    };

    test('shows cost input when editing self with hr.costs.update only', async () => {
      await openEditDialog('Mary Manager', {
        permissions: [updatePermission, 'hr.costs_all.view', 'hr.costs.update'],
      });

      expect(screen.getByText('hr:workforce.costPerHour')).toBeInTheDocument();
    });

    test('hides cost input when editing another user with only hr.costs.update', async () => {
      // Personal cost permission must not unlock the field for someone else's row.
      await openEditDialog('Bob Brown', {
        permissions: [updatePermission, 'hr.costs_all.view', 'hr.costs.update'],
      });

      expect(screen.queryByText('hr:workforce.costPerHour')).not.toBeInTheDocument();
    });

    test('shows cost input when editing another user with hr.costs_all.update', async () => {
      await openEditDialog('Bob Brown', {
        permissions: [updatePermission, 'hr.costs_all.view', 'hr.costs_all.update'],
      });

      expect(screen.getByText('hr:workforce.costPerHour')).toBeInTheDocument();
    });

    test('hides cost input entirely without hr.costs_all.view', async () => {
      // View permission is the precondition for showing the input at all.
      await openEditDialog('Mary Manager', {
        permissions: [updatePermission, 'hr.costs.update'],
      });

      expect(screen.queryByText('hr:workforce.costPerHour')).not.toBeInTheDocument();
    });

    test('saving unrelated fields without view-all does NOT clobber costPerHour', async () => {
      // Regression: when the cost input is hidden (no hr.costs_all.view), the
      // GET response masked costPerHour to 0. If the save handler still includes
      // costPerHour in the update payload, an unrelated edit (e.g. name) would
      // silently overwrite the DB cost with 0.
      const onUpdateUser = mock(() => {});
      const props: ComponentProps<typeof UserManagement> = {
        users: usersForCostTests,
        currentUserId: 'u-self',
        clients: [],
        projects: [],
        tasks: [],
        onAddUser: mock(async () => ({ success: true })),
        onDeleteUser: mock(() => {}),
        onUpdateUser,
        onUpdateUserRoles: mock(async () => {}),
        onUpdateUserAuthMethod: mock(async () => {}),
        onResetUserTotp: mock(async () => {}),
        permissions: [updatePermission, 'hr.costs.update'], // No view-all.
        roles: [],
        ssoProviders: [],
        currency: '$',
      };
      render(<UserManagement {...props} />);
      fireEvent.click(screen.getByText('Mary Manager'));
      await screen.findByText('hr:workforce.editUser');

      // Dirty the name field so the Save button enables, then submit.
      const firstNameInput = screen.getByDisplayValue('Mary') as HTMLInputElement;
      fireEvent.change(firstNameInput, { target: { value: 'Maria' } });

      const saveButton = await screen.findByRole('button', {
        name: 'hr:workforce.saveChanges',
      });
      fireEvent.click(saveButton);

      expect(onUpdateUser).toHaveBeenCalled();
      const [, updates] = (
        onUpdateUser.mock.calls as unknown as Array<[string, Record<string, unknown>]>
      )[0];
      expect(updates).not.toHaveProperty('costPerHour');
    });
  });
});

describe('UserManagement dark-mode form chrome', () => {
  test('edit, delete, and role-assignment modal chrome uses theme tokens, not light zinc', async () => {
    const source = await readComponentSource('administration/UserManagement.tsx');

    // Modal panels, the roles list box, section labels, and the role-selector cards adapt to the
    // theme instead of rendering as white/zinc slabs on the dark surface.
    expectSourceContainsAll(source, [
      'bg-card rounded-2xl shadow-2xl',
      'bg-muted/50 border border-border rounded-xl',
      "'bg-accent border-border shadow-sm'",
      'text-xs font-bold text-muted-foreground uppercase tracking-wider',
    ]);
    // The old hardcoded light chrome (white modal panels, zinc list box, light role cards) is gone.
    expectSourceOmitsAll(source, [
      'bg-white rounded-2xl shadow-2xl',
      'bg-zinc-50 border border-zinc-200 rounded-xl',
      "'bg-zinc-50 border-zinc-300 shadow-sm'",
      "'bg-white border-zinc-200 hover:border-zinc-300'",
    ]);
  });
});
