import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { LdapConfig } from '../../../types';
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

const renderAuthSettings = (overrides: Partial<ComponentProps<typeof AuthSettings>> = {}) => {
  const props: ComponentProps<typeof AuthSettings> = {
    config: ldapConfig,
    onSave: mock(async () => {}),
    roles: [],
    ssoProviders: [],
    onSaveSsoProvider: mock(async () => {
      throw new Error('not used');
    }),
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
});
