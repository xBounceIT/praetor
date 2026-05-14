import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { LdapConfig, Role, SsoProtocol, SsoProvider } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

const ldapApiMock = {
  testAuthentication: mock(async (_username: string, _password: string) => ({
    success: true,
    authenticated: true,
    username: 'alice',
    message: 'LDAP authentication succeeded',
    groups: [],
    roleIds: ['user'],
  })),
};

mock.module('../../../services/api/ldap', () => ({
  ldapApi: ldapApiMock,
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
  groupBaseDn: 'ou=groups,dc=example,dc=com',
  groupFilter: '(member={0})',
  roleMappings: [],
  tlsCaCertificate: '',
  autoProvisionAll: false,
};

const roles: Role[] = [
  {
    id: 'user',
    name: 'User',
    permissions: [],
    isAdmin: false,
    isSystem: true,
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
    ssoProviders: [],
    onSaveSsoProvider: defaultOnSaveSsoProvider,
    onDeleteSsoProvider: mock(async () => {}),
    ...overrides,
  };

  render(<AuthSettings {...props} />);
  return props;
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
      (element) => element.textContent === labelText,
    );
    const input = label?.parentElement?.querySelector('input');
    if (!input) throw new Error(`Input for "${labelText}" not found`);
    return input;
  };

  fireEvent.change(getInputByLabel('admin.sso.name'), { target: { value: 'Broken OIDC' } });
  fireEvent.change(getInputByLabel('admin.sso.slug'), { target: { value: 'broken-oidc' } });

  return form;
};

describe('<AuthSettings />', () => {
  beforeEach(() => {
    ldapApiMock.testAuthentication.mockClear();
  });

  test('allows testing the saved LDAP configuration before LDAP is enabled', async () => {
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

  test('shows the server error instead of the saved notification when LDAP save fails', async () => {
    const onSave = mock(async () => {
      throw new Error('Role mapping references a missing role');
    });

    renderAuthSettings({ onSave });

    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('alert')).toHaveTextContent('Role mapping references a missing role');
    });
    expect(screen.queryByText('admin.ldap.changesSaved')).not.toBeInTheDocument();
  });

  test('surfaces SSO provider save failures inline and restores the save button', async () => {
    const onSaveSsoProvider = mock(async () => {
      throw new Error('OIDC save failed');
    });
    renderAuthSettings({ onSaveSsoProvider });

    const form = fillMinimalOidcProvider();
    fireEvent.submit(form);

    await waitFor(() => expect(onSaveSsoProvider).toHaveBeenCalledTimes(1));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('admin.sso.errors.saveFailedTitle');
    expect(alert).toHaveTextContent('OIDC save failed');
    expect(screen.queryByText('admin.ldap.changesSaved')).not.toBeInTheDocument();

    expect(within(form).getByRole('button', { name: 'admin.sso.saveProvider' })).toBeEnabled();
  });
});
