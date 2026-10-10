export type LdapRoleMapping = { ldapGroup: string; role: string };

export const LDAP_USER_IDENTITY_LIMITS = { dn: 2048, username: 100 } as const;

export type LdapUserSelection = { dn: string; username: string };

export type LdapDirectoryUser = LdapUserSelection & {
  name: string;
  email: string;
  existing: boolean;
};

export type LdapUserSearchResponse = {
  users: LdapDirectoryUser[];
  truncated: boolean;
  directoryVersion: string;
};

export type LdapUserImportResult = LdapUserSelection & {
  status: 'created' | 'existing' | 'failed';
};

export type LdapUserImportResponse = {
  created: number;
  existing: number;
  failed: number;
  results: LdapUserImportResult[];
};

export type LdapConfig = {
  enabled: boolean;
  serverUrl: string;
  baseDn: string;
  bindDn: string;
  bindPassword: string;
  userFilter: string;
  // Directory attribute names mapped onto the user's identity. Empty values fall back to
  // sensible defaults (givenName/sn/mail) in the LDAP service.
  firstNameAttribute: string;
  lastNameAttribute: string;
  emailAttribute: string;
  groupBaseDn: string;
  groupFilter: string;
  roleMappings: LdapRoleMapping[];
  tlsCaCertificate: string;
  autoProvisionAll: boolean;
  provisionOnLogin: boolean;
};
