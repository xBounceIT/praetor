import fs from 'fs';
import ldap from 'ldapjs';
import * as ldapRepo from '../repositories/ldapRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { computeAvatarInitials } from '../utils/initials.ts';
import {
  buildGroupLookupFilter,
  buildUserLookupFilter,
  buildUserSyncFilter,
} from '../utils/ldap-filter.ts';
import { createChildLogger, serializeError } from '../utils/logger.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import {
  applyExternalRolesForUser,
  type ExternalRoleMapping,
  mapExternalGroupsToRoleIds,
} from './external-auth.ts';

const logger = createChildLogger({ module: 'ldap' });

interface LdapEntry {
  objectName: string;
  uid?: string | string[];
  sAMAccountName?: string | string[];
  cn?: string | string[];
  displayName?: string | string[];
  [key: string]: unknown;
}

interface LdapClient {
  bind: (dn: string, password: string, callback: (err: Error | null) => void) => void;
  unbind: (callback: (err?: Error) => void) => void;
  search: (
    base: string,
    options: { scope: string; filter: unknown; attributes?: string[] },
    callback: (err: Error | null, res: LdapSearchResult) => void,
  ) => void;
}

interface LdapSearchResult {
  on: (
    event: string,
    callback:
      | ((entry: LdapSearchEntry) => void)
      | ((err: Error) => void)
      | ((result: { status: number }) => void),
  ) => void;
}

interface LdapSearchEntry {
  objectName: string;
  object: Record<string, unknown>;
}

export type LdapAuthResult = {
  authenticated: boolean;
  userDn?: string;
  groups: string[];
  roleIds: string[];
};

class LDAPService {
  config: ldapRepo.LdapConfig | null;

  constructor() {
    this.config = null;
  }

  async loadConfig() {
    this.config = await ldapRepo.get();
  }

  async getClient(): Promise<LdapClient | null> {
    if (!this.config) {
      await this.loadConfig();
    }

    if (!this.config?.enabled) {
      return null;
    }

    const tlsOptions: {
      rejectUnauthorized: boolean;
      ca?: Buffer;
      cert?: Buffer;
      key?: Buffer;
    } = {
      rejectUnauthorized: process.env.LDAP_REJECT_UNAUTHORIZED !== 'false',
    };

    if (process.env.LDAP_TLS_CA_FILE && fs.existsSync(process.env.LDAP_TLS_CA_FILE)) {
      tlsOptions.ca = fs.readFileSync(process.env.LDAP_TLS_CA_FILE);
    }

    if (process.env.LDAP_TLS_CERT_FILE && fs.existsSync(process.env.LDAP_TLS_CERT_FILE)) {
      tlsOptions.cert = fs.readFileSync(process.env.LDAP_TLS_CERT_FILE);
    }

    if (process.env.LDAP_TLS_KEY_FILE && fs.existsSync(process.env.LDAP_TLS_KEY_FILE)) {
      tlsOptions.key = fs.readFileSync(process.env.LDAP_TLS_KEY_FILE);
    }

    return ldap.createClient({
      url: this.config.serverUrl,
      tlsOptions: tlsOptions,
    }) as LdapClient;
  }

  private getRoleMappings(): ExternalRoleMapping[] {
    return (this.config?.roleMappings ?? []).map((mapping) => ({
      externalGroup: mapping.ldapGroup,
      role: mapping.role,
    }));
  }

  async authenticateWithProfile(username: string, password: string): Promise<LdapAuthResult> {
    let client: LdapClient | null = null;
    try {
      client = await this.getClient();
      if (!client) {
        return { authenticated: false, groups: [], roleIds: ['user'] };
      }
      const ldapClient = client;
      const config = this.config;
      if (!config) {
        return { authenticated: false, groups: [], roleIds: ['user'] };
      }

      // Bind with service account first to find the user's DN
      await new Promise<void>((resolve, reject) => {
        ldapClient.bind(config.bindDn, config.bindPassword, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Find user DN
      const userDn = await this.findUserDn(ldapClient, username);
      if (!userDn) {
        return { authenticated: false, groups: [], roleIds: ['user'] };
      }

      const groups = await this.findUserGroups(ldapClient, userDn, username);

      // Try to bind as the user
      // We need a new client for this to verify credentials safely without messing up the service connection state
      // or we can just re-bind. Re-binding on the same client is standard.
      await new Promise<void>((resolve, reject) => {
        ldapClient.bind(userDn, password, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return {
        authenticated: true,
        userDn,
        groups,
        roleIds: mapExternalGroupsToRoleIds(groups, this.getRoleMappings()),
      };
    } catch (err) {
      logger.error({ err: serializeError(err), username }, 'LDAP auth error');
      return { authenticated: false, groups: [], roleIds: ['user'] };
    } finally {
      if (client) {
        client.unbind((err) => {
          if (err) {
            logger.warn({ err: serializeError(err) }, 'Error unbinding LDAP client');
          }
        });
      }
    }
  }

  async authenticate(username: string, password: string): Promise<boolean> {
    const result = await this.authenticateWithProfile(username, password);
    return result.authenticated;
  }

  async findUserDn(client: LdapClient, username: string): Promise<string | null> {
    const config = this.config;
    if (!config) {
      return null;
    }
    const searchOptions = {
      scope: 'sub',
      filter: buildUserLookupFilter(config.userFilter, username),
    };

    return new Promise((resolve, reject) => {
      client.search(config.baseDn, searchOptions, (err, res) => {
        if (err) return reject(err);

        let foundDn: string | null = null;

        res.on('searchEntry', (entry: LdapSearchEntry) => {
          foundDn = entry.objectName;
        });

        res.on('error', (err: Error) => {
          reject(err);
        });

        res.on('end', (result: { status: number }) => {
          if (result.status !== 0) {
            reject(new Error('LDAP search failed status: ' + result.status));
          } else {
            resolve(foundDn);
          }
        });
      });
    });
  }

  async findUserGroups(client: LdapClient, userDn: string, username: string): Promise<string[]> {
    const config = this.config;
    if (!config?.groupBaseDn || !config.groupFilter) {
      return [];
    }

    const searchValues = [userDn, username].filter((value, idx, arr) => arr.indexOf(value) === idx);
    const groups = new Set<string>();

    for (const searchValue of searchValues) {
      let searchOptions: {
        scope: 'sub';
        filter: ReturnType<typeof buildGroupLookupFilter>;
        attributes: string[];
      };

      try {
        searchOptions = {
          scope: 'sub',
          filter: buildGroupLookupFilter(config.groupFilter, searchValue),
          attributes: ['cn', 'dn', 'distinguishedName'],
        };
      } catch (err) {
        logger.warn(
          { err: serializeError(err), username },
          'LDAP group filter is invalid; skipping group role mapping',
        );
        return [];
      }

      try {
        await new Promise<void>((resolve, reject) => {
          client.search(config.groupBaseDn, searchOptions, (err, res) => {
            if (err) return reject(err);

            res.on('searchEntry', (entry: LdapSearchEntry) => {
              groups.add(entry.objectName);
              const cn = entry.object.cn;
              if (typeof cn === 'string') groups.add(cn);
              else if (Array.isArray(cn)) {
                for (const value of cn) {
                  if (typeof value === 'string') groups.add(value);
                }
              }
            });

            res.on('error', (err: Error) => reject(err));
            res.on('end', () => resolve());
          });
        });
      } catch (err) {
        logger.warn(
          { err: serializeError(err), username },
          'LDAP group lookup failed; skipping group role mapping',
        );
        return [];
      }
    }

    return [...groups];
  }

  // Sync users from LDAP to local DB
  async syncUsers(): Promise<{
    skipped?: boolean;
    reason?: string;
    synced?: number;
    created?: number;
  }> {
    let client: LdapClient | null = null;
    try {
      logger.info('Starting LDAP sync');
      client = await this.getClient();
      if (!client) {
        logger.info('LDAP sync skipped: LDAP is disabled');
        return { skipped: true, reason: 'LDAP is disabled' };
      }
      const ldapClient = client;
      const config = this.config;
      if (!config) {
        return { skipped: true, reason: 'LDAP config not loaded' };
      }

      await new Promise<void>((resolve, reject) => {
        ldapClient.bind(config.bindDn, config.bindPassword, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const searchOptions = {
        scope: 'sub',
        filter: buildUserSyncFilter(config.userFilter),
        attributes: ['uid', 'cn', 'sn', 'givenName', 'mail', 'displayName', 'sAMAccountName'],
      };

      const entries: LdapEntry[] = [];

      await new Promise<void>((resolve, reject) => {
        ldapClient.search(config.baseDn, searchOptions, (err, res) => {
          if (err) return reject(err);

          res.on('searchEntry', (entry: LdapSearchEntry) => {
            entries.push({
              ...(entry.object as Record<string, unknown>),
              objectName: entry.objectName,
            });
          });

          res.on('error', (err: Error) => {
            logger.error({ err: serializeError(err) }, 'LDAP search error');
          });

          res.on('end', () => {
            resolve();
          });
        });
      });

      logger.info({ count: entries.length }, 'Found LDAP users');

      let syncedCount = 0;
      let createdCount = 0;

      for (const entry of entries) {
        let username = entry.uid;
        if (Array.isArray(username)) username = username[0];

        // Fallback for AD, where the username attribute is sAMAccountName rather than uid.
        if (!username && entry.sAMAccountName) {
          username = entry.sAMAccountName;
          if (Array.isArray(username)) username = username[0];
        }

        if (!username) {
          logger.warn('Skipping LDAP entry without username');
          continue;
        }

        const nameValue: string | string[] | undefined = entry.cn || entry.displayName;
        let name: string;
        if (nameValue) {
          name = Array.isArray(nameValue) ? nameValue[0] : nameValue;
        } else {
          name = username;
        }

        const existing = await usersRepo.findLoginUserByUsername(username);
        const groups = await this.findUserGroups(ldapClient, entry.objectName, username);
        const roleIds = mapExternalGroupsToRoleIds(groups, this.getRoleMappings());

        if (existing) {
          await usersRepo.updateNameByUsername(username, name);
          await applyExternalRolesForUser(existing.id, groups, this.getRoleMappings());
          syncedCount++;
        } else {
          const id = generatePrefixedId('u');
          await usersRepo.createUser({
            id,
            name,
            username,
            passwordHash: usersRepo.EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
            role: roleIds[0],
            avatarInitials: computeAvatarInitials(name),
          });
          await applyExternalRolesForUser(id, groups, this.getRoleMappings());
          createdCount++;
        }
      }

      logger.info({ syncedCount, createdCount }, 'LDAP sync completed');
      return { synced: syncedCount, created: createdCount };
    } catch (err) {
      logger.error({ err: serializeError(err) }, 'LDAP sync failed');
      throw err;
    } finally {
      if (client) {
        client.unbind(() => {});
      }
    }
  }
}

export default new LDAPService();
