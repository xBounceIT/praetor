import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SetStateAction } from 'react';
import type { LdapConfig } from '../../../types';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';

const updateConfigMock = mock(async (config: LdapConfig): Promise<LdapConfig> => config);

mock.module('../../../services/api', () => ({
  default: {
    ldap: {
      updateConfig: updateConfigMock,
    },
  },
}));

clearSpyStateAfterAll();

const { makeLdapHandlers } = await import('../../../hooks/handlers/ldapHandlers');

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

describe('makeLdapHandlers', () => {
  beforeEach(() => {
    updateConfigMock.mockReset();
    updateConfigMock.mockImplementation(async (config: LdapConfig) => config);
  });

  test('saveConfig persists the returned LDAP config', async () => {
    const updated = { ...ldapConfig, serverUrl: 'ldaps://ldap.example.com:636' };
    updateConfigMock.mockResolvedValue(updated);
    const setLdapConfig = mock((_config: SetStateAction<LdapConfig>) => {});
    const handlers = makeLdapHandlers({ setLdapConfig });

    await handlers.saveConfig(ldapConfig);

    expect(updateConfigMock).toHaveBeenCalledWith(ldapConfig);
    expect(setLdapConfig).toHaveBeenCalledWith(updated);
  });

  test('saveConfig rethrows API failures so the form can suppress saved feedback', async () => {
    const error = new Error('Role mapping references a missing role');
    updateConfigMock.mockRejectedValue(error);
    const setLdapConfig = mock((_config: SetStateAction<LdapConfig>) => {});
    const handlers = makeLdapHandlers({ setLdapConfig });
    const originalError = console.error;
    console.error = mock(() => {}) as unknown as typeof console.error;

    try {
      await expect(handlers.saveConfig(ldapConfig)).rejects.toThrow(
        'Role mapping references a missing role',
      );
      expect(setLdapConfig).not.toHaveBeenCalled();
    } finally {
      console.error = originalError;
    }
  });
});
