import type { LdapConfig, LdapTestResponse } from '../../types';
import { fetchApi } from './client';

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
};
