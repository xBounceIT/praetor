import { afterAll, beforeEach, describe, expect, mock } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { authSettingsReducer } from '../../../components/administration/authSettingsState';
import { ApiError } from '../../../services/api/client';
import type {
  LdapConfig,
  LdapSyncResponse,
  LdapTestResponse,
  LdapUserImportResponse,
  LdapUserSearchResponse,
  LdapUserSelection,
  Role,
  SsoProtocol,
  SsoProvider,
  User,
} from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { settleComponentTasks, reactTest as test } from '../../helpers/reactTest';
import { render } from '../../helpers/render';

installI18nMock();

const ldapApiMock = {
  searchUsers: mock(
    async (_query: string): Promise<LdapUserSearchResponse> => ({
      users: [],
      directoryVersion: 'a'.repeat(64),
      truncated: false,
    }),
  ),
  importUsers: mock(
    async (
      _users: LdapUserSelection[],
      _directoryVersion: string,
    ): Promise<LdapUserImportResponse> => ({
      created: 0,
      existing: 0,
      failed: 0,
      results: [],
    }),
  ),
  syncUsers: mock(
    async (): Promise<LdapSyncResponse> => ({
      success: true,
      synced: 3,
      created: 12,
    }),
  ),
  testAuthentication: mock(
    async (_username: string, _password: string): Promise<LdapTestResponse> => ({
      success: true,
      authenticated: true,
      username: 'alice',
      message: 'LDAP authentication succeeded',
      groups: [],
      roleIds: ['user'],
      roleResolution: 'matched',
    }),
  ),
};

const ssoApiMock = {
  // Issue #602: the admin form must render the URL the backend will validate against, not
  // one built from the frontend's API base. Default the mock to a split-host setup so any
  // test that surfaces the ACS URL exercises the divergent-origin path.
  getSamlAcsUrlInfo: mock(async () => ({
    acsUrlTemplate: 'https://api.example.com/api/auth/sso/saml/{slug}/callback',
  })),
};

const { ldapApi } = await import('../../../services/api/ldap');
const originalLdapApi = {
  searchUsers: ldapApi.searchUsers,
  importUsers: ldapApi.importUsers,
  syncUsers: ldapApi.syncUsers,
  testAuthentication: ldapApi.testAuthentication,
};

ldapApi.syncUsers = ldapApiMock.syncUsers;
ldapApi.searchUsers = ldapApiMock.searchUsers;
ldapApi.importUsers = ldapApiMock.importUsers;
ldapApi.testAuthentication = ldapApiMock.testAuthentication;

afterAll(() => {
  ldapApi.searchUsers = originalLdapApi.searchUsers;
  ldapApi.importUsers = originalLdapApi.importUsers;
  ldapApi.syncUsers = originalLdapApi.syncUsers;
  ldapApi.testAuthentication = originalLdapApi.testAuthentication;
});

mock.module('../../../services/api/sso', () => ({
  ssoApi: ssoApiMock,
}));

clearSpyStateAfterAll();

const AuthSettings = (await import('../../../components/administration/AuthSettings')).default;

const ldapConfig: LdapConfig = {
  enabled: false,
  serverUrl: 'ldap://ldap.example.com:389',
  baseDn: 'dc=example,dc=com',
  bindDn: 'cn=admin,dc=example,dc=com',
  bindPassword: 'secret',
  userFilter: '(uid={0})',
  firstNameAttribute: 'givenName',
  lastNameAttribute: 'sn',
  emailAttribute: 'mail',
  groupBaseDn: 'ou=groups,dc=example,dc=com',
  groupFilter: '(member={0})',
  roleMappings: [],
  tlsCaCertificate: '',
  autoProvisionAll: false,
  provisionOnLogin: true,
};

const enabledLdapConfig: LdapConfig = { ...ldapConfig, enabled: true };

const roles: Role[] = [
  {
    id: 'user',
    name: 'User',
    permissions: [],
    isAdmin: false,
    isSystem: true,
  },
];

const users: User[] = [
  {
    id: 'u1',
    name: 'Alice Admin',
    role: 'user',
    avatarInitials: 'AA',
    username: 'alice',
    isDisabled: false,
  },
  {
    id: 'u2',
    name: 'Bob User',
    role: 'user',
    avatarInitials: 'BU',
    username: 'bob',
    isDisabled: false,
  },
  {
    id: 'u-disabled',
    name: 'Disabled User',
    role: 'user',
    avatarInitials: 'DU',
    username: 'disabled',
    isDisabled: true,
  },
];
const buildProvider = (protocol: SsoProtocol, patch: Partial<SsoProvider> = {}): SsoProvider => ({
  id: `${protocol}-provider`,
  protocol,
  enabled: false,
  slug: `${protocol}-provider`,
  name: `${protocol.toUpperCase()} Provider`,
  issuerUrl: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  metadataUrl: '',
  metadataXml: '',
  entryPoint: '',
  idpIssuer: '',
  idpCert: '',
  spIssuer: '',
  privateKey: '',
  publicCert: '',
  usernameAttribute: protocol === 'saml' ? 'nameID' : 'preferred_username',
  nameAttribute: 'name',
  emailAttribute: 'email',
  groupsAttribute: 'groups',
  roleMappings: [],
  endSessionEnabled: false,
  ...patch,
});

const renderAuthSettings = (overrides: Partial<ComponentProps<typeof AuthSettings>> = {}) => {
  const defaultOnSaveSsoProvider = mock(async (provider: Partial<SsoProvider>) =>
    buildProvider(provider.protocol ?? 'oidc', provider),
  );
  const props: ComponentProps<typeof AuthSettings> = {
    config: ldapConfig,
    onSave: mock(async () => {}),
    roles,
    users,
    ssoProviders: [],
    onSaveSsoProvider: defaultOnSaveSsoProvider,
    onDeleteSsoProvider: mock(async () => {}),
    enableTotp: true,
    onSetEnableTotp: mock((_value: boolean) => {}),
    enforceTotp: false,
    onSetEnforceTotp: mock((_value: boolean) => {}),
    enforcedRoleIds: [],
    onSetEnforcedRoleIds: mock((_value: string[]) => {}),
    exemptRoleIds: [],
    exemptUserIds: [],
    onSetExemptRoleIds: mock((_value: string[]) => {}),
    onSetExemptUserIds: mock((_value: string[]) => {}),
    canManageMfa: true,
    sessionIdleTimeoutMinutes: 30,
    onSetSessionIdleTimeoutMinutes: mock((_value: number) => {}),
    canManageSession: true,
    ...overrides,
  };

  const view = render(<AuthSettings {...props} />);
  return { ...view, props };
};

const inputForLabel = (label: string): HTMLInputElement => {
  const input = screen.getByText(label).parentElement?.querySelector('input');
  if (!input) throw new Error(`Input not found for label ${label}`);
  return input;
};

const fillMinimalOidcProvider = () => {
  fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.oidc' }));

  const heading = screen.getByText('admin.sso.newProvider');
  const form = heading.closest('form') as HTMLFormElement | null;
  if (!form) throw new Error('OIDC provider form not found');

  const getInputByLabel = (labelText: string) => {
    const label = [...form.querySelectorAll('label')].find(
      (element) => element.textContent?.replace(/\s*\*$/, '') === labelText,
    );
    const input = label?.parentElement?.querySelector('input');
    if (!input) throw new Error(`Input for "${labelText}" not found`);
    return input;
  };

  fireEvent.change(getInputByLabel('admin.sso.name'), { target: { value: 'Broken OIDC' } });
  fireEvent.change(getInputByLabel('admin.sso.slug'), { target: { value: 'broken-oidc' } });

  return form;
};

describe('authSettingsReducer', () => {
  test('preserves the current state for an unrecognized action', () => {
    const state = { marker: true } as unknown as Parameters<typeof authSettingsReducer>[0];

    expect(authSettingsReducer(state, { type: 'unknown' } as never)).toBe(state);
  });
});

describe('<AuthSettings />', () => {
  beforeEach(() => {
    ldapApiMock.searchUsers.mockReset();
    ldapApiMock.importUsers.mockReset();
    ldapApiMock.searchUsers.mockResolvedValue({
      users: [],
      directoryVersion: 'a'.repeat(64),
      truncated: false,
    });
    ldapApiMock.importUsers.mockResolvedValue({ created: 0, existing: 0, failed: 0, results: [] });
    ldapApiMock.testAuthentication.mockClear();
    ldapApiMock.syncUsers.mockClear();
  });

  test('searches saved LDAP while disabled and imports only manually selected users', async () => {
    const alice = {
      dn: 'uid=alice,dc=test',
      username: 'Alice',
      name: 'Alice Directory',
      email: 'alice@test.com',
      existing: false,
    };
    const bob = {
      dn: 'uid=bob,dc=test',
      username: 'bob',
      name: 'Bob Directory',
      email: '',
      existing: false,
    };
    const existing = {
      dn: 'uid=local,dc=test',
      username: 'local',
      name: 'Local Account',
      email: '',
      existing: true,
    };
    ldapApiMock.searchUsers.mockResolvedValue({
      users: [alice, bob, existing],
      directoryVersion: 'a'.repeat(64),
      truncated: true,
    });
    ldapApiMock.importUsers.mockResolvedValue({
      created: 1,
      existing: 0,
      failed: 0,
      results: [{ dn: alice.dn, username: 'alice', status: 'created' }],
    });
    const onImported = mock(() => {});
    renderAuthSettings({
      onLdapUsersSynced: onImported,
      config: { ...ldapConfig, provisionOnLogin: false, autoProvisionAll: false },
    });

    fireEvent.change(screen.getByLabelText('admin.ldap.import.query'), {
      target: { value: 'Directory' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.import.search' }));
    await waitFor(() => expect(screen.getByText('Alice Directory')).toBeInTheDocument());
    expect(ldapApiMock.searchUsers).toHaveBeenCalledWith('Directory');
    expect(screen.getByText('admin.ldap.import.truncated')).toBeInTheDocument();
    const aliceRow = screen.getByText('Alice Directory').closest('tr');
    const localRow = screen.getByText('Local Account').closest('tr');
    if (!aliceRow || !localRow) throw new Error('Missing directory rows');
    expect(within(localRow).getByRole('checkbox')).toBeDisabled();
    const importButton = screen.getByRole('button', { name: 'admin.ldap.import.selected' });
    expect(importButton).toBeDisabled();
    fireEvent.click(within(aliceRow).getByRole('checkbox'));
    fireEvent.click(importButton);
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(ldapApiMock.importUsers).toHaveBeenCalledWith(
      [{ dn: alice.dn, username: alice.username }],
      'a'.repeat(64),
    );
    expect(within(aliceRow).getByRole('checkbox')).toBeDisabled();
    expect(importButton).toBeDisabled();
    expect(screen.getByText('admin.ldap.import.summary')).toBeInTheDocument();
  });

  test('blocks manual directory search until changes are saved and clears old selections', async () => {
    ldapApiMock.searchUsers.mockResolvedValue({
      users: [
        {
          dn: 'uid=alice,dc=test',
          username: 'alice',
          name: 'Alice Directory',
          email: '',
          existing: false,
        },
      ],
      directoryVersion: 'a'.repeat(64),
      truncated: false,
    });
    renderAuthSettings();
    fireEvent.change(screen.getByLabelText('admin.ldap.import.query'), {
      target: { value: 'alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.import.search' }));
    await waitFor(() => expect(screen.getByText('Alice Directory')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'admin.ldap.import.selectUser' }));
    fireEvent.change(inputForLabel('admin.ldap.baseDnLabel'), { target: { value: 'dc=changed' } });
    expect(screen.getByRole('button', { name: 'admin.ldap.import.search' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'admin.ldap.import.selected' })).toBeDisabled();
    expect(screen.queryByText('Alice Directory')).toBeNull();
    expect(screen.getByText('admin.ldap.import.saveFirst')).toBeInTheDocument();
  });

  test('reports partial failures, preserves failed selections for retry and refreshes created users', async () => {
    const alice = {
      dn: 'uid=alice,dc=test',
      username: 'alice',
      name: 'Alice Directory',
      email: '',
      existing: false,
    };
    const bob = {
      dn: 'uid=bob,dc=test',
      username: 'bob',
      name: 'Bob Directory',
      email: '',
      existing: false,
    };
    ldapApiMock.searchUsers.mockResolvedValue({
      users: [alice, bob],
      directoryVersion: 'a'.repeat(64),
      truncated: false,
    });
    ldapApiMock.importUsers.mockResolvedValueOnce({
      created: 1,
      existing: 0,
      failed: 1,
      results: [
        { ...alice, status: 'created' },
        { ...bob, status: 'failed' },
      ],
    });
    const onImported = mock(() => {});
    renderAuthSettings({ onLdapUsersSynced: onImported });
    fireEvent.change(screen.getByLabelText('admin.ldap.import.query'), {
      target: { value: 'Directory' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.import.search' }));
    await waitFor(() => expect(screen.getByText('Bob Directory')).toBeInTheDocument());
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.import.selected' }));
    await waitFor(() => expect(screen.getByText('admin.ldap.import.failed')).toBeInTheDocument());
    expect(onImported).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.import.selected' }));
    await waitFor(() => expect(ldapApiMock.importUsers).toHaveBeenCalledTimes(2));
    expect(ldapApiMock.importUsers.mock.calls[1]).toEqual([
      [{ dn: bob.dn, username: 'bob' }],
      'a'.repeat(64),
    ]);
  });

  test('shows directory errors and recovers for a subsequent search', async () => {
    ldapApiMock.searchUsers.mockRejectedValueOnce(new Error('LDAP offline'));
    renderAuthSettings();
    const searchButton = screen.getByRole('button', { name: 'admin.ldap.import.search' });
    expect(searchButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('admin.ldap.import.query'), {
      target: { value: 'alice' },
    });
    fireEvent.click(searchButton);
    await waitFor(() =>
      expect(screen.getByText('admin.ldap.import.searchError')).toBeInTheDocument(),
    );
    fireEvent.click(searchButton);
    await waitFor(() => expect(screen.getByText('admin.ldap.import.empty')).toBeInTheDocument());
    expect(screen.queryByText('admin.ldap.import.searchError')).toBeNull();
  });

  test('counts Unicode code points consistently with the LDAP search API minimum', () => {
    renderAuthSettings();
    fireEvent.change(screen.getByLabelText('admin.ldap.import.query'), { target: { value: '😀' } });
    const searchButton = screen.getByRole('button', {
      name: 'admin.ldap.import.search',
    }) as HTMLButtonElement;
    expect(searchButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('admin.ldap.import.query'), {
      target: { value: '😀😁' },
    });
    expect(searchButton.disabled).toBe(false);
    expect(ldapApiMock.searchUsers).not.toHaveBeenCalled();
  });

  test('requires a new search after a directory configuration conflict', async () => {
    ldapApiMock.searchUsers.mockResolvedValue({
      users: [
        {
          dn: 'uid=alice,dc=test',
          username: 'alice',
          name: 'Alice Directory',
          email: '',
          existing: false,
        },
      ],
      truncated: false,
      directoryVersion: 'a'.repeat(64),
    });
    ldapApiMock.importUsers.mockRejectedValue(
      new ApiError('changed', 409, false, 'ldap_configuration_changed'),
    );
    renderAuthSettings();
    fireEvent.change(screen.getByLabelText('admin.ldap.import.query'), {
      target: { value: 'alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.import.search' }));
    await waitFor(() => expect(screen.getByText('Alice Directory')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'admin.ldap.import.selectUser' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.import.selected' }));
    await waitFor(() =>
      expect(screen.getByText('admin.ldap.import.configurationChanged')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Alice Directory')).toBeNull();
    expect(screen.getByRole('button', { name: 'admin.ldap.import.selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'admin.ldap.import.search' })).toBeEnabled();
  });

  test('allows testing the saved LDAP configuration before LDAP is enabled', async () => {
    ldapApiMock.testAuthentication.mockResolvedValueOnce({
      success: true,
      authenticated: true,
      username: 'alice',
      message: 'LDAP authentication succeeded',
      groups: [],
      roleIds: ['user'],
      roleResolution: 'matched',
    });
    renderAuthSettings();

    const testButton = screen.getByRole('button', { name: 'admin.ldap.testAuthentication' });
    expect(testButton).toBeEnabled();

    fireEvent.change(inputForLabel('admin.ldap.testUsername'), { target: { value: ' alice ' } });
    fireEvent.change(inputForLabel('admin.ldap.testPassword'), { target: { value: 'secret' } });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(ldapApiMock.testAuthentication).toHaveBeenCalledWith('alice', 'secret');
    });
  });

  test('Provisioning section exposes two independent switches that round-trip to onSave (#644)', async () => {
    const onSave = mock(async (_config: LdapConfig) => {});
    renderAuthSettings({ onSave });

    const onLoginSwitch = document.getElementById('ldap-provision-on-login') as HTMLInputElement;
    const autoAllSwitch = document.getElementById('ldap-auto-provision-all') as HTMLInputElement;
    expect(onLoginSwitch).toBeTruthy();
    expect(autoAllSwitch).toBeTruthy();
    expect(onLoginSwitch.getAttribute('aria-checked')).toBe('true');
    expect(autoAllSwitch.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(onLoginSwitch);
    expect(onLoginSwitch.getAttribute('aria-checked')).toBe('false');
    expect(autoAllSwitch.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(autoAllSwitch);
    expect(autoAllSwitch.getAttribute('aria-checked')).toBe('true');
    expect(onLoginSwitch.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const submitted = onSave.mock.calls[0]?.[0] as LdapConfig;
    expect(submitted.provisionOnLogin).toBe(false);
    expect(submitted.autoProvisionAll).toBe(true);
  });

  test('manual LDAP sync calls the saved sync endpoint and renders returned counts', async () => {
    ldapApiMock.syncUsers.mockResolvedValueOnce({ success: true, synced: 3, created: 12 });
    const onLdapUsersSynced = mock(() => {});
    renderAuthSettings({ config: enabledLdapConfig, onLdapUsersSynced });

    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.sync.runNow' }));

    await waitFor(() => expect(ldapApiMock.syncUsers).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onLdapUsersSynced).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId('ldap-sync-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ldap-sync-synced')).toHaveTextContent('3');
    expect(screen.getByTestId('ldap-sync-created')).toHaveTextContent('12');
  });

  test('manual LDAP sync is disabled while LDAP is disabled', () => {
    renderAuthSettings();

    const syncButton = screen.getByRole('button', { name: 'admin.ldap.sync.runNow' });
    expect(syncButton).toBeDisabled();
    fireEvent.click(syncButton);
    expect(ldapApiMock.syncUsers).not.toHaveBeenCalled();
    expect(screen.getByText('admin.ldap.sync.ldapDisabled')).toBeInTheDocument();
  });

  test('manual LDAP sync is disabled while LDAP configuration has unsaved edits', () => {
    renderAuthSettings({ config: enabledLdapConfig });

    fireEvent.change(inputForLabel('admin.ldap.bindDnLabel'), {
      target: { value: 'cn=changed,dc=example,dc=com' },
    });

    expect(screen.getByRole('button', { name: 'admin.ldap.sync.runNow' })).toBeDisabled();
    expect(screen.getByText('admin.ldap.sync.unsavedChanges')).toBeInTheDocument();
  });

  test('manual LDAP sync shows loading state and ignores double clicks while in flight', async () => {
    let resolveSync: (value: LdapSyncResponse) => void = () => {};
    ldapApiMock.syncUsers.mockImplementationOnce(
      () =>
        new Promise<LdapSyncResponse>((resolve) => {
          resolveSync = resolve;
        }),
    );
    const onSave = mock(async (_config: LdapConfig) => {});
    renderAuthSettings({ config: enabledLdapConfig, onSave });

    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.sync.runNow' }));

    await waitFor(() => expect(ldapApiMock.syncUsers).toHaveBeenCalledTimes(1));
    const loadingButton = screen.getByRole('button', { name: 'admin.ldap.sync.running' });
    expect(loadingButton).toBeDisabled();
    expect(inputForLabel('admin.ldap.serverUrlLabel')).toBeDisabled();

    const saveButton = screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' });
    expect(saveButton).toBeDisabled();
    const ldapForm = saveButton.closest('form');
    if (!ldapForm) throw new Error('LDAP save form not found');
    fireEvent.submit(ldapForm);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(loadingButton);
    expect(ldapApiMock.syncUsers).toHaveBeenCalledTimes(1);

    resolveSync({ success: true, synced: 1, created: 0 });
    await waitFor(() => expect(screen.getByTestId('ldap-sync-summary')).toBeInTheDocument());
  });

  test('manual LDAP sync surfaces backend failures inline', async () => {
    ldapApiMock.syncUsers.mockRejectedValueOnce(
      new Error('LDAP sync failed: directory unreachable'),
    );
    const onLdapUsersSynced = mock(() => {});
    renderAuthSettings({ config: enabledLdapConfig, onLdapUsersSynced });

    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.sync.runNow' }));

    const alert = await screen.findByTestId('ldap-sync-error');
    expect(alert).toHaveTextContent('admin.ldap.sync.errorTitle');
    expect(alert).toHaveTextContent('LDAP sync failed: directory unreachable');
    expect(onLdapUsersSynced).not.toHaveBeenCalled();
    expect(screen.queryByText('admin.ldap.changesSaved')).not.toBeInTheDocument();
  });

  test('keeps focus in the LDAP role mapping input while typing', () => {
    renderAuthSettings();

    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.addMapping' }));
    const input = screen.getByRole('textbox', {
      name: 'admin.ldap.ldapGroupPlaceholder',
    }) as HTMLInputElement;

    input.focus();
    fireEvent.change(input, { target: { value: 'CN=Praetor Admins' } });

    const updatedInput = screen.getByRole('textbox', {
      name: 'admin.ldap.ldapGroupPlaceholder',
    }) as HTMLInputElement;
    expect(updatedInput).toBe(input);
    expect(updatedInput.value).toBe('CN=Praetor Admins');
    expect(document.activeElement).toBe(updatedInput);
  });

  describe('2FA org policy (MFA tab)', () => {
    const openMfaTab = () => {
      fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.mfa' }));
    };

    test('shows the MFA tab when canManageMfa is true and reveals the Enable/Enforce switches on click', () => {
      renderAuthSettings();

      // The MFA controls live behind their own tab, so they are not visible until navigated to.
      expect(document.getElementById('enable-totp')).toBeNull();
      expect(document.getElementById('enforce-totp')).toBeNull();

      openMfaTab();

      // The Enable switch reflects enableTotp=true and the Enforce switch reflects enforceTotp=false.
      const enableSwitch = document.getElementById('enable-totp') as HTMLInputElement;
      const enforceSwitch = document.getElementById('enforce-totp') as HTMLInputElement;
      expect(enableSwitch).toBeTruthy();
      expect(enforceSwitch).toBeTruthy();
      expect(enableSwitch.getAttribute('aria-checked')).toBe('true');
      expect(enforceSwitch.getAttribute('aria-checked')).toBe('false');

      // The role and user multi-selects are present too.
      expect(document.getElementById('totp-enforced-roles')).toBeTruthy();
      expect(document.getElementById('totp-exempt-roles')).toBeTruthy();
      expect(document.getElementById('totp-exempt-users')).toBeTruthy();
    });

    test('reflects enforceTotp=true on the Enforce switch', () => {
      renderAuthSettings({ enforceTotp: true });
      openMfaTab();

      const enforceSwitch = document.getElementById('enforce-totp') as HTMLInputElement;
      expect(enforceSwitch.getAttribute('aria-checked')).toBe('true');
    });

    test('toggling the Enable switch calls onSetEnableTotp(false)', () => {
      const onSetEnableTotp = mock((_value: boolean) => {});
      renderAuthSettings({ enableTotp: true, onSetEnableTotp });
      openMfaTab();

      const enableSwitch = document.getElementById('enable-totp') as HTMLInputElement;
      fireEvent.click(enableSwitch);

      expect(onSetEnableTotp).toHaveBeenCalledTimes(1);
      expect(onSetEnableTotp).toHaveBeenCalledWith(false);
    });

    test('toggling the Enforce switch calls onSetEnforceTotp(true)', () => {
      const onSetEnforceTotp = mock((_value: boolean) => {});
      renderAuthSettings({ enableTotp: true, enforceTotp: false, onSetEnforceTotp });
      openMfaTab();

      const enforceSwitch = document.getElementById('enforce-totp') as HTMLInputElement;
      fireEvent.click(enforceSwitch);

      expect(onSetEnforceTotp).toHaveBeenCalledTimes(1);
      expect(onSetEnforceTotp).toHaveBeenCalledWith(true);
    });

    test('disables the Enforce switch while the feature kill-switch is off', () => {
      renderAuthSettings({ enableTotp: false });
      openMfaTab();

      const enforceSwitch = document.getElementById('enforce-totp') as HTMLInputElement;
      const exemptUsersSelect = document.getElementById('totp-exempt-users') as HTMLButtonElement;
      expect(enforceSwitch).toBeDisabled();
      expect(exemptUsersSelect).toBeDisabled();
    });

    test('disables the exempt users select while enforcement is off', () => {
      renderAuthSettings({ enableTotp: true, enforceTotp: false });
      openMfaTab();

      const exemptUsersSelect = document.getElementById('totp-exempt-users') as HTMLButtonElement;
      expect(exemptUsersSelect).toBeDisabled();
    });

    test('selecting an exempt user calls onSetExemptUserIds with active user ids only', () => {
      const onSetExemptUserIds = mock((_value: string[]) => {});
      renderAuthSettings({ enforceTotp: true, onSetExemptUserIds });
      openMfaTab();

      const exemptUsersSelect = document.getElementById('totp-exempt-users') as HTMLButtonElement;
      fireEvent.click(exemptUsersSelect);
      expect(screen.queryByText('Disabled User (disabled)')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Bob User (bob)'));
      expect(onSetExemptUserIds).toHaveBeenCalledTimes(1);
      expect(onSetExemptUserIds).toHaveBeenCalledWith(['u2']);
    });
    test('shows usernames for duplicate exempt user display names', () => {
      renderAuthSettings({
        enforceTotp: true,
        users: [
          {
            id: 'u1',
            name: 'Shared Name',
            avatarInitials: 'SN',
            username: 'shared.one',
            isDisabled: false,
          },
          {
            id: 'u2',
            name: 'Shared Name',
            avatarInitials: 'SN',
            username: 'shared.two',
            isDisabled: false,
          },
        ],
      });
      openMfaTab();

      const exemptUsersSelect = document.getElementById('totp-exempt-users') as HTMLButtonElement;
      fireEvent.click(exemptUsersSelect);

      expect(screen.getByText('Shared Name (shared.one)')).toBeInTheDocument();
      expect(screen.getByText('Shared Name (shared.two)')).toBeInTheDocument();
    });

    test('hides the MFA tab when the user lacks general-settings update permission', () => {
      // The policy persists via the general-settings endpoint; a user who can view auth settings
      // but not update general settings must not see controls that would 403 on save.
      renderAuthSettings({ canManageMfa: false });

      expect(screen.queryByRole('button', { name: 'admin.tabs.mfa' })).not.toBeInTheDocument();
      expect(document.getElementById('enable-totp')).toBeNull();
      expect(document.getElementById('enforce-totp')).toBeNull();
    });
  });

  describe('session policy tab', () => {
    const openSessionTab = () => {
      fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.session' }));
    };

    test('shows the Session tab for admins who can update general settings', () => {
      renderAuthSettings();

      expect(screen.queryByLabelText('sessionPolicy.timeoutLabel')).not.toBeInTheDocument();

      openSessionTab();

      const input = screen.getByLabelText('sessionPolicy.timeoutLabel') as HTMLInputElement;
      expect(input.value).toBe('30');
      expect(screen.getByText('sessionPolicy.timeoutDescription')).toBeInTheDocument();
    });

    test('saves a valid inactivity timeout in minutes', async () => {
      const onSetSessionIdleTimeoutMinutes = mock(async (_value: number) => {});
      renderAuthSettings({ onSetSessionIdleTimeoutMinutes });
      openSessionTab();

      fireEvent.change(screen.getByLabelText('sessionPolicy.timeoutLabel'), {
        target: { value: '45' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'sessionPolicy.save' }));

      await waitFor(() => {
        expect(onSetSessionIdleTimeoutMinutes).toHaveBeenCalledWith(45);
      });
    });

    test('keeps the saved state when the parent applies the returned timeout', async () => {
      const onSetSessionIdleTimeoutMinutes = mock(async (_value: number) => {});
      const view = renderAuthSettings({ onSetSessionIdleTimeoutMinutes });
      openSessionTab();

      fireEvent.change(screen.getByLabelText('sessionPolicy.timeoutLabel'), {
        target: { value: '45' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'sessionPolicy.save' }));

      await waitFor(() => {
        expect(onSetSessionIdleTimeoutMinutes).toHaveBeenCalledWith(45);
      });

      view.rerender(<AuthSettings {...view.props} sessionIdleTimeoutMinutes={45} />);

      expect(screen.getByText('sessionPolicy.saved')).toBeInTheDocument();
      expect((screen.getByLabelText('sessionPolicy.timeoutLabel') as HTMLInputElement).value).toBe(
        '45',
      );
    });
    test('does not show saved state when session timeout save fails', async () => {
      const onSetSessionIdleTimeoutMinutes = mock(async (_value: number) => {
        throw new Error('save failed');
      });
      renderAuthSettings({ onSetSessionIdleTimeoutMinutes });
      openSessionTab();

      fireEvent.change(screen.getByLabelText('sessionPolicy.timeoutLabel'), {
        target: { value: '45' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'sessionPolicy.save' }));

      await waitFor(() => {
        expect(onSetSessionIdleTimeoutMinutes).toHaveBeenCalledWith(45);
      });
      await waitFor(() => {
        expect(screen.queryByText('sessionPolicy.saved')).not.toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: 'sessionPolicy.save' })).not.toBeDisabled();
    });
    test('validates the allowed timeout range before saving', () => {
      const onSetSessionIdleTimeoutMinutes = mock((_value: number) => {});
      renderAuthSettings({ onSetSessionIdleTimeoutMinutes });
      openSessionTab();

      fireEvent.change(screen.getByLabelText('sessionPolicy.timeoutLabel'), {
        target: { value: '4' },
      });

      expect(screen.getByText('sessionPolicy.validation')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sessionPolicy.save' })).toBeDisabled();
      expect(onSetSessionIdleTimeoutMinutes).not.toHaveBeenCalled();
    });

    test('hides the Session tab when the user lacks general-settings update permission', () => {
      renderAuthSettings({ canManageSession: false });

      expect(screen.queryByRole('button', { name: 'admin.tabs.session' })).not.toBeInTheDocument();
    });
  });

  test('Attribute Mapping inputs render the configured values and round-trip to onSave', async () => {
    const onSave = mock(async (_config: LdapConfig) => {});
    renderAuthSettings({ onSave });

    const firstNameInput = inputForLabel('admin.ldap.attributeMapping.firstNameLabel');
    const lastNameInput = inputForLabel('admin.ldap.attributeMapping.lastNameLabel');
    const emailInput = inputForLabel('admin.ldap.attributeMapping.emailLabel');

    expect(firstNameInput.value).toBe('givenName');
    expect(lastNameInput.value).toBe('sn');
    expect(emailInput.value).toBe('mail');

    fireEvent.change(firstNameInput, { target: { value: 'preferredName' } });
    fireEvent.change(lastNameInput, { target: { value: 'familyName' } });
    fireEvent.change(emailInput, { target: { value: 'userPrincipalName' } });

    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const submitted = onSave.mock.calls[0]?.[0] as LdapConfig;
    expect(submitted.firstNameAttribute).toBe('preferredName');
    expect(submitted.lastNameAttribute).toBe('familyName');
    expect(submitted.emailAttribute).toBe('userPrincipalName');
  });

  // #638: the tester previously lied about every existing user — claiming they would be
  // demoted to DEFAULT_ROLE_ID when LDAP authenticated but no group matched, even though
  // real login preserves the admin-assigned role. The render branches below assert that
  // each roleResolution state surfaces with its own label and help text.
  describe('LDAP test role resolution (issue #638)', () => {
    const runTest = async (overrides: Partial<LdapTestResponse>) => {
      ldapApiMock.testAuthentication.mockResolvedValueOnce({
        success: true,
        authenticated: true,
        username: 'alice',
        message: 'LDAP authentication succeeded',
        userDn: 'uid=alice,ou=people,dc=example,dc=com',
        groups: ['cn=engineers,ou=groups,dc=example,dc=com'],
        roleIds: ['user'],
        roleResolution: 'matched',
        ...overrides,
      });
      renderAuthSettings();
      fireEvent.change(inputForLabel('admin.ldap.testUsername'), { target: { value: 'alice' } });
      fireEvent.change(inputForLabel('admin.ldap.testPassword'), { target: { value: 'secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.testAuthentication' }));
      await waitFor(() => {
        expect(ldapApiMock.testAuthentication).toHaveBeenCalled();
      });
    };

    test('renders the Mapped Roles label without a fallback hint when groups match', async () => {
      await runTest({ roleResolution: 'matched', roleIds: ['admin'] });
      await waitFor(() => {
        expect(screen.getByText('admin.ldap.test.roleIds')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('ldap-test-role-resolution-help')).toBeNull();
      expect(screen.queryByText('admin.ldap.test.preservedRoleLabel')).toBeNull();
      expect(screen.queryByText('admin.ldap.test.defaultRoleLabel')).toBeNull();
    });

    test('renders the Current Role label and preserved-role hint for existing LDAP users with no match', async () => {
      await runTest({ roleResolution: 'preserved', roleIds: ['manager'] });
      await waitFor(() => {
        expect(screen.getByText('admin.ldap.test.preservedRoleLabel')).toBeInTheDocument();
      });
      expect(screen.getByTestId('ldap-test-role-resolution-help')).toHaveTextContent(
        'admin.ldap.test.preservedRoleHelp',
      );
      // The misleading "Mapped Roles" label must not appear for the preserved state.
      expect(screen.queryByText('admin.ldap.test.roleIds')).toBeNull();
    });

    test('renders the Default Role label and default hint for first-time users with no match', async () => {
      await runTest({ roleResolution: 'default', roleIds: ['user'] });
      await waitFor(() => {
        expect(screen.getByText('admin.ldap.test.defaultRoleLabel')).toBeInTheDocument();
      });
      expect(screen.getByTestId('ldap-test-role-resolution-help')).toHaveTextContent(
        'admin.ldap.test.defaultRoleHelp',
      );
    });

    // Surface the production-rejection case so the admin does not mistake it for `preserved`.
    test('renders the Login Rejected label and rejected hint for disabled or non-app_user rows', async () => {
      await runTest({ roleResolution: 'rejected', roleIds: [] });
      await waitFor(() => {
        expect(screen.getByText('admin.ldap.test.rejectedRoleLabel')).toBeInTheDocument();
      });
      expect(screen.getByTestId('ldap-test-role-resolution-help')).toHaveTextContent(
        'admin.ldap.test.rejectedRoleHelp',
      );
    });
  });

  test('shows the server error instead of the saved notification when LDAP save fails', async () => {
    const onSave = mock(async () => {
      throw new Error('Role mapping references a missing role');
    });

    renderAuthSettings({ onSave });

    // Dirty the form so the save button is enabled — the production button is gated on edits.
    fireEvent.change(inputForLabel('admin.ldap.bindDnLabel'), {
      target: { value: 'cn=admin2,dc=example,dc=com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('alert')).toHaveTextContent('Role mapping references a missing role');
    });
    expect(screen.queryByText('admin.ldap.changesSaved')).not.toBeInTheDocument();
  });

  test('disables the LDAP save button until the admin edits the form', () => {
    renderAuthSettings();

    const saveButton = screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' });
    expect(saveButton).toBeDisabled();

    fireEvent.change(inputForLabel('admin.ldap.bindDnLabel'), {
      target: { value: 'cn=admin2,dc=example,dc=com' },
    });

    expect(saveButton).toBeEnabled();
  });

  test('renders the SAML ACS URL using the backend-authoritative template (issue #602)', async () => {
    ssoApiMock.getSamlAcsUrlInfo.mockClear();
    renderAuthSettings();

    // Open SAML tab and type a slug into the new-provider form.
    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    const form = screen.getByText('admin.sso.newProvider').closest('form') as HTMLFormElement;
    const slugLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent?.replace(/\s*\*$/, '') === 'admin.sso.slug',
    );
    const slugInput = slugLabel?.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'okta' } });

    // The endpoint resolves asynchronously on mount, so wait for the URL to appear.
    const acsField = await waitFor(() => {
      const label = [...form.querySelectorAll('label')].find(
        (el) => el.textContent === 'admin.sso.acsUrl',
      );
      const input = label?.parentElement?.querySelector('input') as HTMLInputElement | null;
      if (!input?.readOnly) throw new Error('ACS URL field not yet rendered');
      return input;
    });

    expect(ssoApiMock.getSamlAcsUrlInfo).toHaveBeenCalledTimes(1);
    // Backend origin (api.example.com) wins over any frontend-derived value.
    expect(acsField.value).toBe('https://api.example.com/api/auth/sso/saml/okta/callback');
  });

  test('retries the ACS URL fetch if the user left SAML before the first request settled (#649 review)', async () => {
    ssoApiMock.getSamlAcsUrlInfo.mockClear();
    // First attempt never settles, simulating a slow network the user gives up on. The bug
    // guarded by this test: a ref-based lock set before settle would prevent the second
    // visit from refetching, stranding the preview in 'loading' forever.
    ssoApiMock.getSamlAcsUrlInfo.mockImplementationOnce(() => new Promise(() => {}));

    renderAuthSettings();

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    await waitFor(() => expect(ssoApiMock.getSamlAcsUrlInfo).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.ldap' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));

    await waitFor(() => expect(ssoApiMock.getSamlAcsUrlInfo).toHaveBeenCalledTimes(2));

    // And the retry produces a usable URL.
    const form = screen.getByText('admin.sso.newProvider').closest('form') as HTMLFormElement;
    const slugLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent?.replace(/\s*\*$/, '') === 'admin.sso.slug',
    );
    const slugInput = slugLabel?.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'okta' } });

    const acsField = await waitFor(() => {
      const label = [...form.querySelectorAll('label')].find(
        (el) => el.textContent === 'admin.sso.acsUrl',
      );
      const input = label?.parentElement?.querySelector('input') as HTMLInputElement | null;
      if (!input?.readOnly) throw new Error('ACS URL field not yet rendered');
      return input;
    });
    expect(acsField.value).toBe('https://api.example.com/api/auth/sso/saml/okta/callback');
  });

  test('retries the ACS URL fetch on SAML re-entry after a transient error (#649 review)', async () => {
    ssoApiMock.getSamlAcsUrlInfo.mockClear();
    // First attempt fails (transient 503), second attempt succeeds. Without retry-on-reentry,
    // a one-off failure would permanently disable the preview until a full page reload.
    ssoApiMock.getSamlAcsUrlInfo.mockImplementationOnce(async () => {
      throw new Error('temporary network failure');
    });

    renderAuthSettings();

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    await waitFor(() => expect(ssoApiMock.getSamlAcsUrlInfo).toHaveBeenCalledTimes(1));

    // Wait for the error UI so we know the first attempt resolved into the 'error' state.
    const form = screen.getByText('admin.sso.newProvider').closest('form') as HTMLFormElement;
    const slugLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent?.replace(/\s*\*$/, '') === 'admin.sso.slug',
    );
    const slugInput = slugLabel?.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'okta' } });
    await waitFor(() => {
      if (!within(form).queryByText(/temporary network failure/)) {
        throw new Error('Error not yet rendered');
      }
    });

    // Leave SAML and return — the retry should fire.
    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.ldap' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));

    await waitFor(() => expect(ssoApiMock.getSamlAcsUrlInfo).toHaveBeenCalledTimes(2));

    const acsField = await waitFor(() => {
      const refreshedForm = screen.getByText('admin.sso.newProvider').closest('form');
      const label = [...(refreshedForm?.querySelectorAll('label') ?? [])].find(
        (el) => el.textContent === 'admin.sso.acsUrl',
      );
      const input = label?.parentElement?.querySelector('input') as HTMLInputElement | null;
      if (!input?.readOnly) throw new Error('ACS URL field not yet rendered');
      return input;
    });
    expect(acsField.value).toBe('https://api.example.com/api/auth/sso/saml/okta/callback');
  });

  test('shows an error message when the backend cannot resolve the ACS URL (issue #602)', async () => {
    ssoApiMock.getSamlAcsUrlInfo.mockClear();
    ssoApiMock.getSamlAcsUrlInfo.mockImplementationOnce(async () => {
      throw new Error('SSO_CALLBACK_BASE_URL or FRONTEND_URL must be configured for SSO');
    });

    renderAuthSettings();

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    const form = screen.getByText('admin.sso.newProvider').closest('form') as HTMLFormElement;
    const slugLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent?.replace(/\s*\*$/, '') === 'admin.sso.slug',
    );
    const slugInput = slugLabel?.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'okta' } });

    const message = await waitFor(() => {
      const node = within(form).queryByText(/SSO_CALLBACK_BASE_URL or FRONTEND_URL/);
      if (!node) throw new Error('Configuration hint not rendered');
      return node;
    });
    expect(message).toBeInTheDocument();

    // The misleading editable ACS URL field must NOT appear when the backend can't resolve it.
    const acsLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent === 'admin.sso.acsUrl',
    );
    expect(acsLabel?.parentElement?.querySelector('input')).toBeNull();
  });

  test('surfaces SSO provider save failures inline and restores the save button', async () => {
    const onSaveSsoProvider = mock(async () => {
      throw new Error('OIDC save failed');
    });
    renderAuthSettings({ onSaveSsoProvider });

    const form = fillMinimalOidcProvider();
    await act(async () => {
      fireEvent.submit(form);
      await settleComponentTasks();
    });

    await waitFor(() => expect(onSaveSsoProvider).toHaveBeenCalledTimes(1));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('admin.sso.errors.saveFailedTitle');
    expect(alert).toHaveTextContent('OIDC save failed');
    expect(screen.queryByText('admin.ldap.changesSaved')).not.toBeInTheDocument();

    expect(within(form).getByRole('button', { name: 'admin.sso.saveProvider' })).toBeEnabled();
  });

  describe('OIDC provider activation', () => {
    const firstProvider = buildProvider('oidc', {
      id: 'oidc-first',
      name: 'First OIDC',
      slug: 'first-oidc',
      issuerUrl: 'https://idp.example.com',
      clientId: 'praetor',
      clientSecret: '********',
    });
    const secondProvider = buildProvider('oidc', {
      id: 'oidc-second',
      name: 'Second OIDC',
      slug: 'second-oidc',
      enabled: true,
    });
    const openOidcTab = () =>
      fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.oidc' }));
    const providerRow = (name: string) => {
      const row = screen.getByText(name).closest('div.p-4');
      if (!row) throw new Error(`Provider row not found: ${name}`);
      return within(row as HTMLElement);
    };
    const pendingSave = () => {
      let resolveSave: (provider: SsoProvider) => void = () => {};
      let rejectSave: (reason: Error) => void = () => {};
      const promise = new Promise<SsoProvider>((resolve, reject) => {
        resolveSave = resolve;
        rejectSave = reject;
      });
      return { promise, resolve: resolveSave, reject: rejectSave };
    };
    const controlIsDisabled = (control: HTMLElement) =>
      control.hasAttribute('disabled') || control.closest('fieldset[disabled]') !== null;

    test('keeps pending activation locked across authentication tab changes', async () => {
      const pending = pendingSave();
      const onSaveSsoProvider = mock((_patch: Partial<SsoProvider>) => pending.promise);
      const view = renderAuthSettings({ ssoProviders: [firstProvider], onSaveSsoProvider });
      openOidcTab();
      fireEvent.click(providerRow(firstProvider.name).getByRole('switch'));
      fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.ldap' }));
      openOidcTab();

      const toggle = providerRow(firstProvider.name).getByRole('switch');
      try {
        expect(controlIsDisabled(toggle)).toBe(true);
        fireEvent.click(toggle);
        expect(onSaveSsoProvider).toHaveBeenCalledTimes(1);
      } finally {
        await act(async () => {
          pending.resolve({ ...firstProvider, enabled: true });
          await settleComponentTasks();
        });
      }
      view.rerender(
        <AuthSettings {...view.props} ssoProviders={[{ ...firstProvider, enabled: true }]} />,
      );
      expect(toggle).toBeEnabled();
      expect(toggle).toBeChecked();
    });

    test('retains activation failures received while the OIDC tab is unmounted', async () => {
      const pending = pendingSave();
      renderAuthSettings({
        ssoProviders: [firstProvider],
        onSaveSsoProvider: mock((_patch: Partial<SsoProvider>) => pending.promise),
      });
      openOidcTab();
      fireEvent.click(providerRow(firstProvider.name).getByRole('switch'));
      fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.ldap' }));
      await act(async () => {
        pending.reject(new Error('Activation rejected'));
        await settleComponentTasks();
      });
      openOidcTab();

      const row = providerRow(firstProvider.name);
      expect(row.getByRole('alert')).toHaveTextContent('Activation rejected');
      expect(row.getByRole('switch')).toBeEnabled();
      expect(row.getByRole('switch')).not.toBeChecked();
    });

    test('blocks form writes while the edited provider activation is being saved', async () => {
      const pending = pendingSave();
      const onSaveSsoProvider = mock((_patch: Partial<SsoProvider>) => pending.promise);
      renderAuthSettings({ ssoProviders: [firstProvider], onSaveSsoProvider });
      openOidcTab();
      fireEvent.click(providerRow(firstProvider.name).getByTitle('admin.sso.editProvider'));
      const form = screen.getByText('admin.sso.editProvider').closest('form');
      if (!form) throw new Error('Provider form not found');
      fireEvent.click(providerRow(firstProvider.name).getByRole('switch'));

      try {
        expect(
          controlIsDisabled(within(form).getByRole('button', { name: 'admin.sso.saveProvider' })),
        ).toBe(true);
        fireEvent.submit(form);
        expect(onSaveSsoProvider).toHaveBeenCalledTimes(1);
      } finally {
        await act(async () => {
          pending.resolve({ ...firstProvider, enabled: true });
          await settleComponentTasks();
        });
      }
      expect(within(form).getByRole('button', { name: 'admin.sso.saveProvider' })).toBeEnabled();
    });

    test('locks activation, draft selection, and form edits during a provider form save', async () => {
      const pending = pendingSave();
      const onSaveSsoProvider = mock((_patch: Partial<SsoProvider>) => pending.promise);
      renderAuthSettings({
        ssoProviders: [firstProvider, secondProvider],
        onSaveSsoProvider,
      });
      openOidcTab();
      fireEvent.click(providerRow(firstProvider.name).getByTitle('admin.sso.editProvider'));
      fireEvent.change(inputForLabel('admin.sso.name'), { target: { value: 'Saved name' } });
      const form = screen.getByText('admin.sso.editProvider').closest('form');
      if (!form) throw new Error('Provider form not found');
      fireEvent.submit(form);
      fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.ldap' }));
      openOidcTab();

      try {
        expect(controlIsDisabled(providerRow(firstProvider.name).getByRole('switch'))).toBe(true);
        expect(
          controlIsDisabled(providerRow(secondProvider.name).getByTitle('admin.sso.editProvider')),
        ).toBe(true);
        expect(controlIsDisabled(inputForLabel('admin.sso.name'))).toBe(true);
        expect(controlIsDisabled(screen.getByRole('button', { name: 'admin.sso.clearForm' }))).toBe(
          true,
        );
        fireEvent.click(providerRow(firstProvider.name).getByRole('switch'));
        fireEvent.submit(screen.getByText('admin.sso.editProvider').closest('form') as HTMLElement);
        expect(onSaveSsoProvider).toHaveBeenCalledTimes(1);
      } finally {
        await act(async () => {
          pending.resolve({ ...firstProvider, name: 'Saved name' });
          await settleComponentTasks();
        });
      }
      expect(inputForLabel('admin.sso.name').value).toBe('Saved name');
      expect(inputForLabel('admin.sso.name')).toBeEnabled();
      expect(providerRow(firstProvider.name).getByRole('switch')).toBeEnabled();
    });

    test('activates only the selected provider and reflects the persisted state', async () => {
      const onSaveSsoProvider = mock(async (patch: Partial<SsoProvider>) => ({
        ...firstProvider,
        ...patch,
      }));
      const view = renderAuthSettings({
        ssoProviders: [firstProvider, secondProvider],
        onSaveSsoProvider,
      });
      openOidcTab();

      const firstSwitch = providerRow(firstProvider.name).getByRole('switch', {
        name: `admin.sso.enabled: ${firstProvider.name}`,
      });
      expect(firstSwitch).not.toBeChecked();
      expect(providerRow(secondProvider.name).getByRole('switch')).toBeChecked();

      await act(async () => {
        fireEvent.click(firstSwitch);
        await settleComponentTasks();
      });
      expect(onSaveSsoProvider).toHaveBeenCalledTimes(1);
      expect(onSaveSsoProvider).toHaveBeenCalledWith({ id: firstProvider.id, enabled: true });

      view.rerender(
        <AuthSettings
          {...view.props}
          ssoProviders={[{ ...firstProvider, enabled: true }, secondProvider]}
        />,
      );
      expect(firstSwitch).toBeChecked();
      expect(providerRow(secondProvider.name).getByRole('switch')).toBeChecked();
      expect(screen.queryByText('admin.sso.errors.saveFailedTitle')).not.toBeInTheDocument();
    });

    test('keeps pending states and errors independent when two providers save concurrently', async () => {
      const firstPending = pendingSave();
      const secondPending = pendingSave();
      const onSaveSsoProvider = mock((patch: Partial<SsoProvider>) =>
        patch.id === firstProvider.id ? firstPending.promise : secondPending.promise,
      );
      const view = renderAuthSettings({
        ssoProviders: [firstProvider, secondProvider],
        onSaveSsoProvider,
      });
      openOidcTab();
      fireEvent.click(providerRow(firstProvider.name).getByRole('switch'));
      fireEvent.click(providerRow(secondProvider.name).getByRole('switch'));
      expect(onSaveSsoProvider.mock.calls.map(([patch]) => patch)).toEqual([
        { id: firstProvider.id, enabled: true },
        { id: secondProvider.id, enabled: false },
      ]);
      await act(async () => {
        secondPending.reject(new Error('Second provider rejected'));
        await settleComponentTasks();
      });
      expect(controlIsDisabled(providerRow(firstProvider.name).getByRole('switch'))).toBe(true);
      expect(providerRow(secondProvider.name).getByRole('alert')).toHaveTextContent(
        'Second provider rejected',
      );

      await act(async () => {
        firstPending.resolve({ ...firstProvider, enabled: true });
        await settleComponentTasks();
      });
      view.rerender(
        <AuthSettings
          {...view.props}
          ssoProviders={[{ ...firstProvider, enabled: true }, secondProvider]}
        />,
      );
      expect(providerRow(firstProvider.name).getByRole('switch')).toBeChecked();
      expect(providerRow(firstProvider.name).getByRole('switch')).toBeEnabled();
      expect(providerRow(secondProvider.name).getByRole('switch')).toBeChecked();
      expect(providerRow(secondProvider.name).getByRole('alert')).toHaveTextContent(
        'Second provider rejected',
      );
    });

    test('does not replace another provider draft when activation completes', async () => {
      const pending = pendingSave();
      renderAuthSettings({
        ssoProviders: [firstProvider, secondProvider],
        onSaveSsoProvider: mock((_patch: Partial<SsoProvider>) => pending.promise),
      });
      openOidcTab();
      fireEvent.click(providerRow(firstProvider.name).getByTitle('admin.sso.editProvider'));
      fireEvent.click(providerRow(firstProvider.name).getByRole('switch'));
      fireEvent.click(providerRow(secondProvider.name).getByTitle('admin.sso.editProvider'));
      fireEvent.change(inputForLabel('admin.sso.name'), { target: { value: 'Second draft' } });
      await act(async () => {
        pending.resolve({ ...firstProvider, enabled: true });
        await settleComponentTasks();
      });
      expect(inputForLabel('admin.sso.name').value).toBe('Second draft');
      expect(inputForLabel('admin.sso.slug').value).toBe(secondProvider.slug);
    });

    test('keeps activation unchanged on failure, blocks duplicate requests, and allows retry', async () => {
      let rejectSave: (reason: Error) => void = () => {};
      const onSaveSsoProvider = mock(
        (_patch: Partial<SsoProvider>): Promise<SsoProvider> =>
          new Promise((_resolve, reject) => {
            rejectSave = reject;
          }),
      );
      renderAuthSettings({
        ssoProviders: [firstProvider, secondProvider],
        onSaveSsoProvider,
      });
      openOidcTab();
      const row = providerRow(firstProvider.name);
      const toggle = row.getByRole('switch');
      fireEvent.click(toggle);
      fireEvent.click(toggle);

      expect(toggle).toBeDisabled();
      expect(toggle).not.toBeChecked();
      expect(onSaveSsoProvider).toHaveBeenCalledTimes(1);
      expect(row.getByTitle('admin.sso.editProvider')).toBeDisabled();
      expect(row.getByTitle('admin.sso.deleteProvider')).toBeDisabled();
      expect(providerRow(secondProvider.name).getByRole('switch')).toBeEnabled();

      await act(async () => {
        rejectSave(new Error('Issuer URL is required'));
        await settleComponentTasks();
      });
      expect(row.getByRole('alert')).toHaveTextContent('Issuer URL is required');
      expect(toggle).toBeEnabled();
      expect(toggle).not.toBeChecked();
      expect(screen.queryByText('admin.ldap.changesSaved')).not.toBeInTheDocument();

      onSaveSsoProvider.mockImplementation(async (patch) => ({ ...firstProvider, ...patch }));
      await act(async () => {
        fireEvent.click(toggle);
        await settleComponentTasks();
      });
      expect(onSaveSsoProvider).toHaveBeenCalledTimes(2);
      expect(row.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('deactivates the selected provider without saving another provider draft', async () => {
      const onSaveSsoProvider = mock(async (patch: Partial<SsoProvider>) => ({
        ...secondProvider,
        ...patch,
      }));
      renderAuthSettings({
        ssoProviders: [firstProvider, secondProvider],
        onSaveSsoProvider,
      });
      openOidcTab();
      fireEvent.click(providerRow(firstProvider.name).getByTitle('admin.sso.editProvider'));
      fireEvent.change(inputForLabel('admin.sso.name'), { target: { value: 'Unsaved name' } });

      await act(async () => {
        fireEvent.click(providerRow(secondProvider.name).getByRole('switch'));
        await settleComponentTasks();
      });
      expect(onSaveSsoProvider).toHaveBeenCalledWith({ id: secondProvider.id, enabled: false });
      expect(inputForLabel('admin.sso.name').value).toBe('Unsaved name');
      expect(inputForLabel('admin.sso.slug').value).toBe(firstProvider.slug);
    });

    test('preserves unsaved edits when toggling the edited provider and omits activation on form save', async () => {
      const onSaveSsoProvider = mock(async (patch: Partial<SsoProvider>) => ({
        ...firstProvider,
        ...patch,
        enabled: true,
      }));
      const view = renderAuthSettings({ ssoProviders: [firstProvider], onSaveSsoProvider });
      openOidcTab();
      fireEvent.click(providerRow(firstProvider.name).getByTitle('admin.sso.editProvider'));
      fireEvent.change(inputForLabel('admin.sso.name'), { target: { value: 'Unsaved name' } });

      await act(async () => {
        fireEvent.click(providerRow(firstProvider.name).getByRole('switch'));
        await settleComponentTasks();
      });
      view.rerender(
        <AuthSettings {...view.props} ssoProviders={[{ ...firstProvider, enabled: true }]} />,
      );
      expect(inputForLabel('admin.sso.name').value).toBe('Unsaved name');
      const form = screen.getByText('admin.sso.editProvider').closest('form');
      if (!form) throw new Error('Provider form not found');
      expect(within(form).queryByRole('switch', { name: 'admin.sso.enabled' })).toBeNull();

      await act(async () => {
        fireEvent.submit(form);
        await settleComponentTasks();
      });
      expect(onSaveSsoProvider).toHaveBeenCalledTimes(2);
      const savedDraft = onSaveSsoProvider.mock.calls[1]?.[0];
      expect(savedDraft).toMatchObject({
        id: firstProvider.id,
        name: 'Unsaved name',
        clientSecret: '********',
      });
      expect(savedDraft).not.toHaveProperty('enabled');
    });

    test('creates OIDC providers disabled without an activation toggle on the configuration form', async () => {
      const { props } = renderAuthSettings();
      const form = fillMinimalOidcProvider();
      expect(within(form).queryByRole('switch', { name: 'admin.sso.enabled' })).toBeNull();
      expect(
        within(form).getByRole('switch', { name: 'admin.sso.endSessionEnabled' }),
      ).toBeEnabled();

      await act(async () => {
        fireEvent.submit(form);
        await settleComponentTasks();
      });
      expect(props.onSaveSsoProvider).toHaveBeenCalledWith(
        expect.objectContaining({ protocol: 'oidc', enabled: false }),
      );
    });

    test('retains the existing SAML form activation control', async () => {
      renderAuthSettings({ ssoProviders: [buildProvider('saml')] });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
        await settleComponentTasks();
      });
      const form = screen.getByText('admin.sso.newProvider').closest('form');
      if (!form) throw new Error('SAML form not found');
      expect(within(form).getByRole('switch', { name: 'admin.sso.enabled' })).toBeEnabled();
    });
  });

  describe('masked secret guard (issue #601)', () => {
    const MASKED = '********';

    const editSamlProvider = async (provider: SsoProvider) => {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
        await settleComponentTasks();
      });
      const editButton = screen
        .getByText(provider.name)
        .closest('div.p-4')
        ?.querySelector('button[title="admin.sso.editProvider"]') as HTMLButtonElement | null;
      if (!editButton) throw new Error('Edit provider button not found');
      fireEvent.click(editButton);
      const heading = screen.getByText('admin.sso.editProvider');
      const form = heading.closest('form') as HTMLFormElement | null;
      if (!form) throw new Error('SAML provider form not found');
      return form;
    };

    test('SAML masked metadataXml/idpCert/privateKey render as a "Secret stored" badge instead of a textarea pre-filled with the mask', async () => {
      const provider = buildProvider('saml', {
        id: 'saml-stored',
        name: 'SAML Stored',
        slug: 'saml-stored',
        enabled: true,
        entryPoint: 'https://idp.example.com/sso',
        metadataXml: MASKED,
        idpCert: MASKED,
        privateKey: MASKED,
      });
      renderAuthSettings({ ssoProviders: [provider] });
      const form = await editSamlProvider(provider);

      expect(within(form).queryAllByText('admin.sso.metadataXmlStored')).toHaveLength(1);
      expect(within(form).queryAllByText('admin.sso.idpCertStored')).toHaveLength(1);
      expect(within(form).queryAllByText('admin.sso.privateKeyStored')).toHaveLength(1);

      // No textarea should be pre-filled with the masked sentinel — that was the bug.
      for (const textarea of within(form).queryAllByRole('textbox')) {
        expect((textarea as HTMLTextAreaElement).value).not.toBe(MASKED);
      }
    });

    test('saving a SAML provider in Stored mode round-trips MASKED_SECRET so the server preserves the stored values', async () => {
      const provider = buildProvider('saml', {
        id: 'saml-stored',
        name: 'SAML Stored',
        slug: 'saml-stored',
        enabled: true,
        entryPoint: 'https://idp.example.com/sso',
        metadataXml: MASKED,
        idpCert: MASKED,
        privateKey: MASKED,
      });
      const onSaveSsoProvider = mock(async (next: Partial<SsoProvider>) => ({
        ...provider,
        ...next,
      }));
      renderAuthSettings({ ssoProviders: [provider], onSaveSsoProvider });
      const form = await editSamlProvider(provider);

      await act(async () => {
        fireEvent.submit(form);
        await settleComponentTasks();
      });

      await waitFor(() => expect(onSaveSsoProvider).toHaveBeenCalledTimes(1));
      const submitted = onSaveSsoProvider.mock.calls[0]?.[0] as Partial<SsoProvider>;
      // The server preserves the stored value when it sees MASKED_SECRET exactly; the bug was
      // sending `MASKED_SECRET + typed characters`.
      expect(submitted.metadataXml).toBe(MASKED);
      expect(submitted.idpCert).toBe(MASKED);
      expect(submitted.privateKey).toBe(MASKED);
    });

    test('clicking Replace clears the field and lets the admin type a new value that is sent to the server', async () => {
      const provider = buildProvider('saml', {
        id: 'saml-stored',
        name: 'SAML Stored',
        slug: 'saml-stored',
        enabled: true,
        entryPoint: 'https://idp.example.com/sso',
        metadataXml: MASKED,
        idpCert: MASKED,
        privateKey: MASKED,
      });
      const onSaveSsoProvider = mock(async (next: Partial<SsoProvider>) => ({
        ...provider,
        ...next,
      }));
      renderAuthSettings({ ssoProviders: [provider], onSaveSsoProvider });
      const form = await editSamlProvider(provider);

      const idpCertBlock = within(form).getByText('admin.sso.idpCertStored').closest('div')
        ?.parentElement as HTMLElement;
      fireEvent.click(within(idpCertBlock).getByRole('button', { name: 'secretField.replace' }));

      const idpCertLabel = within(form)
        .getAllByText('admin.sso.idpCert')
        .find((node) => node.tagName === 'LABEL') as HTMLLabelElement | undefined;
      const idpCertField = idpCertLabel?.closest('div')?.parentElement as HTMLElement;
      const idpCertTextarea = within(idpCertField).getByRole('textbox') as HTMLTextAreaElement;
      expect(idpCertTextarea.value).toBe('');

      fireEvent.change(idpCertTextarea, { target: { value: 'NEW-CERT-PEM' } });
      await act(async () => {
        fireEvent.submit(form);
        await settleComponentTasks();
      });

      await waitFor(() => expect(onSaveSsoProvider).toHaveBeenCalledTimes(1));
      const submitted = onSaveSsoProvider.mock.calls[0]?.[0] as Partial<SsoProvider>;
      expect(submitted.idpCert).toBe('NEW-CERT-PEM');
      // The fields the admin did not replace still round-trip the mask.
      expect(submitted.metadataXml).toBe(MASKED);
      expect(submitted.privateKey).toBe(MASKED);
    });

    test('"Keep stored value" restores the mask after entering Replace mode so the admin can back out', async () => {
      const provider = buildProvider('saml', {
        id: 'saml-stored',
        name: 'SAML Stored',
        slug: 'saml-stored',
        enabled: true,
        entryPoint: 'https://idp.example.com/sso',
        metadataXml: MASKED,
        idpCert: MASKED,
        privateKey: MASKED,
      });
      renderAuthSettings({ ssoProviders: [provider] });
      const form = await editSamlProvider(provider);

      const idpCertBlock = within(form).getByText('admin.sso.idpCertStored').closest('div')
        ?.parentElement as HTMLElement;
      fireEvent.click(within(idpCertBlock).getByRole('button', { name: 'secretField.replace' }));

      fireEvent.click(within(form).getByRole('button', { name: 'secretField.keepStored' }));

      // After cancelling, the field is back to Stored mode — no textarea, only the badge.
      expect(within(form).queryAllByText('admin.sso.idpCertStored')).toHaveLength(1);
    });

    test('OIDC clientSecret with a masked value renders as a Stored badge and round-trips the mask on save', async () => {
      const provider = buildProvider('oidc', {
        id: 'oidc-stored',
        name: 'OIDC Stored',
        slug: 'oidc-stored',
        enabled: true,
        issuerUrl: 'https://idp.example.com',
        clientId: 'praetor',
        clientSecret: MASKED,
      });
      const onSaveSsoProvider = mock(async (next: Partial<SsoProvider>) => ({
        ...provider,
        ...next,
      }));
      renderAuthSettings({ ssoProviders: [provider], onSaveSsoProvider });

      fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.oidc' }));
      const editButton = screen
        .getByText('OIDC Stored')
        .closest('div.p-4')
        ?.querySelector('button[title="admin.sso.editProvider"]') as HTMLButtonElement | null;
      if (!editButton) throw new Error('Edit provider button not found');
      fireEvent.click(editButton);

      const heading = screen.getByText('admin.sso.editProvider');
      const form = heading.closest('form') as HTMLFormElement;

      // Stored badge present; no password input is rendered with the mask as its value.
      expect(within(form).queryAllByText('admin.sso.secretStored')).toHaveLength(1);
      for (const passwordInput of form.querySelectorAll('input[type="password"]')) {
        expect((passwordInput as HTMLInputElement).value).not.toBe(MASKED);
      }

      fireEvent.submit(form);
      await waitFor(() => expect(onSaveSsoProvider).toHaveBeenCalledTimes(1));
      const submitted = onSaveSsoProvider.mock.calls[0]?.[0] as Partial<SsoProvider>;
      expect(submitted.clientSecret).toBe(MASKED);
    });

    test('LDAP bindPassword with a masked value renders as a Stored badge and round-trips the mask on save', async () => {
      const onSave = mock(async (_config: LdapConfig) => {});
      renderAuthSettings({
        config: { ...ldapConfig, bindPassword: MASKED },
        onSave,
      });

      // Stored badge appears for the bind password — no input pre-filled with the mask.
      expect(screen.getByTestId('ldap-bind-password')).toBeInTheDocument();
      expect(screen.queryByTestId('ldap-bind-password-input')).toBeNull();

      // Make some unrelated change so isLdapDirty is true, then save.
      const bindDnInput = screen
        .getByText('admin.ldap.bindDnLabel')
        .parentElement?.querySelector('input') as HTMLInputElement;
      fireEvent.change(bindDnInput, { target: { value: 'cn=admin2,dc=example,dc=com' } });

      fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      const submitted = onSave.mock.calls[0]?.[0] as LdapConfig;
      expect(submitted.bindPassword).toBe(MASKED);
    });

    test('clicking Replace on LDAP bindPassword clears the field and lets the admin type a new password', async () => {
      const onSave = mock(async (_config: LdapConfig) => {});
      renderAuthSettings({
        config: { ...ldapConfig, bindPassword: MASKED },
        onSave,
      });

      fireEvent.click(screen.getByTestId('ldap-bind-password-replace'));

      const passwordInput = screen.getByTestId('ldap-bind-password-input') as HTMLInputElement;
      expect(passwordInput.value).toBe('');

      fireEvent.change(passwordInput, { target: { value: 'new-pw' } });
      fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      const submitted = onSave.mock.calls[0]?.[0] as LdapConfig;
      expect(submitted.bindPassword).toBe('new-pw');
    });
  });

  test('blocks save and surfaces idpIssuer error for enabled manual SAML missing the issuer', async () => {
    // Issue #597: Praetor needs an expected issuer for its post-signature SAML issuer check.
    // The form must refuse to send a save request for an enabled manual SAML config that
    // has not specified an IdP issuer.
    const onSaveSsoProvider = mock(async (provider: Partial<SsoProvider>) =>
      buildProvider(provider.protocol ?? 'saml', provider),
    );
    renderAuthSettings({
      onSaveSsoProvider,
      ssoProviders: [
        buildProvider('saml', {
          enabled: true,
          entryPoint: 'https://idp.example.com/sso',
          idpCert: 'MIIBdummyCert',
          // idpIssuer left empty — the violation under test.
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    // The form initially renders an empty "new provider" draft. Click the pen icon on the
    // listed SAML provider to load its values into the form.
    fireEvent.click(screen.getByRole('button', { name: 'admin.sso.editProvider' }));
    const heading = screen.getByText('admin.sso.editProvider', {
      selector: '[data-slot="card-title"]',
    });
    const form = heading.closest('form') as HTMLFormElement | null;
    if (!form) throw new Error('SAML provider form not found');

    fireEvent.submit(form);

    await waitFor(() => {
      expect(within(form).getByText('admin.sso.errors.idpIssuerRequired')).toBeInTheDocument();
    });
    expect(onSaveSsoProvider).not.toHaveBeenCalled();
  });
});
