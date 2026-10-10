import type {
  LdapConfig,
  LdapSyncResponse,
  LdapTestResponse,
  LdapUserImportResponse,
  LdapUserSearchResponse,
  LdapUserSelection,
} from '../../types';
import { fetchApi } from './client';

const LDAP_SYNC_TIMEOUT_MS = 5 * 60 * 1000;
const LDAP_SEARCH_TIMEOUT_MS = 60_000;

export const ldapApi = {
  searchUsers: (query: string): Promise<LdapUserSearchResponse> =>
    fetchApi('/ldap/users/search', {
      method: 'POST',
      body: JSON.stringify({ query }),
      timeoutMs: LDAP_SEARCH_TIMEOUT_MS,
    }),

  importUsers: (
    users: LdapUserSelection[],
    directoryVersion: string,
  ): Promise<LdapUserImportResponse> =>
    fetchApi('/ldap/users/import', {
      method: 'POST',
      body: JSON.stringify({ users, directoryVersion }),
      timeoutMs: LDAP_SYNC_TIMEOUT_MS,
    }),
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
