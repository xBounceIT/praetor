import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { LdapConfig, Role } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

const testAuthenticationMock = mock(async () => ({
  success: true,
  authenticated: true,
  username: 'alice',
  message: 'ok',
  groups: [],
  roleIds: [],
}));

mock.module('../../../services/api/ldap', () => ({
  ldapApi: {
    testAuthentication: testAuthenticationMock,
  },
}));

clearSpyStateAfterAll();

const AuthSettings = (await import('../../../components/administration/AuthSettings')).default;

const ldapConfig: LdapConfig = {
  enabled: false,
  serverUrl: 'ldap://ldap.example.com:389',
  baseDn: 'dc=example,dc=com',
  bindDn: '',
  bindPassword: '',
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
    isSystem: true,
    isAdmin: false,
    permissions: [],
  },
];

const renderAuthSettings = (overrides: Partial<ComponentProps<typeof AuthSettings>> = {}) => {
  const props: ComponentProps<typeof AuthSettings> = {
    config: ldapConfig,
    onSave: mock(async () => {}),
    roles,
    ssoProviders: [],
    onSaveSsoProvider: mock(async (provider) => ({
      id: 'sso-1',
      protocol: provider.protocol ?? 'oidc',
      slug: provider.slug ?? 'provider',
      name: provider.name ?? 'Provider',
      enabled: provider.enabled ?? false,
      issuerUrl: provider.issuerUrl ?? '',
      clientId: provider.clientId ?? '',
      clientSecret: provider.clientSecret ?? '',
      scopes: provider.scopes ?? '',
      metadataUrl: provider.metadataUrl ?? '',
      metadataXml: provider.metadataXml ?? '',
      entryPoint: provider.entryPoint ?? '',
      idpIssuer: provider.idpIssuer ?? '',
      idpCert: provider.idpCert ?? '',
      spIssuer: provider.spIssuer ?? '',
      privateKey: provider.privateKey ?? '',
      publicCert: provider.publicCert ?? '',
      usernameAttribute: provider.usernameAttribute ?? '',
      nameAttribute: provider.nameAttribute ?? '',
      emailAttribute: provider.emailAttribute ?? '',
      groupsAttribute: provider.groupsAttribute ?? '',
      roleMappings: provider.roleMappings ?? [],
    })),
    onDeleteSsoProvider: mock(async () => {}),
    ...overrides,
  };

  render(<AuthSettings {...props} />);
  return props;
};

describe('<AuthSettings /> LDAP save', () => {
  beforeEach(() => {
    testAuthenticationMock.mockClear();
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
