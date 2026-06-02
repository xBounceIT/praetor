export type LdapRoleMapping = { ldapGroup: string; role: string };

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
