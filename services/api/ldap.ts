import type { LdapConfig, LdapSyncResponse, LdapTestResponse } from '../../types';
import { fetchApi } from './client';

const LDAP_SYNC_TIMEOUT_MS = 5 * 60 * 1000;

export const ldapApi = {
  getConfig: (): Promise<LdapConfig> => fetchApi('/ldap/config'),

  updateConfig: (config: Partial<LdapConfig>): Promise<LdapConfig> =>
    fetchApi('/ldap/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  testAuthentication: (username: string, password: string): Promise<LdapTestResponse> =>
    fetchApi('/ldap/test', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  syncUsers: (): Promise<LdapSyncResponse> =>
    fetchApi('/ldap/sync', {
      method: 'POST',
      timeoutMs: LDAP_SYNC_TIMEOUT_MS,
    }),
};
