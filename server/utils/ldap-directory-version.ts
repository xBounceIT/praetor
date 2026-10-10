import { createHash } from 'node:crypto';
import type { LdapConfig } from '../types/ldap.ts';

// Bind passwords never enter the public fingerprint. Pin the directory, search scope,
// profile and role mappings so selections cannot migrate to another configuration.
export const getLdapDirectoryVersion = (config: LdapConfig): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        config.serverUrl,
        config.baseDn,
        config.bindDn,
        config.userFilter,
        config.firstNameAttribute,
        config.lastNameAttribute,
        config.emailAttribute,
        config.groupBaseDn,
        config.groupFilter,
        config.roleMappings,
        config.tlsCaCertificate,
      ]),
    )
    .digest('hex');

export class LdapDirectoryChangedError extends Error {
  constructor() {
    super('LDAP configuration changed; search the directory again');
  }
}
