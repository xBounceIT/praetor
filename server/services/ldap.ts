import fs from 'fs';
import ldap from 'ldapjs';
import * as ldapRepo from '../repositories/ldapRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { computeAvatarInitials } from '../utils/initials.ts';
import { buildUserLookupFilter, buildUserSyncFilter } from '../utils/ldap-filter.ts';
import { createChildLogger, serializeError } from '../utils/logger.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';

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

class LDAPService {
  config: ldapRepo.LdapConfig | null;

  constructor() {
    this.config = null;
  }

  async loadConfig() {
    this.config = await ldapRepo.get();
  }

  invalidateConfig(): void {
    this.config = null;
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

    // CA precedence: DB-stored PEM wins; otherwise fall back to LDAP_TLS_CA_FILE.
    // Node's TLS layer accepts a single Buffer with one or more concatenated
    // PEM blocks, so chain certs in the textarea work without extra parsing.
    if (this.config.tlsCaCertificate) {
      tlsOptions.ca = Buffer.from(this.config.tlsCaCertificate, 'utf8');
    } else if (process.env.LDAP_TLS_CA_FILE && fs.existsSync(process.env.LDAP_TLS_CA_FILE)) {
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

  async authenticate(username: string, password: string): Promise<boolean> {
    let client: LdapClient | null = null;
    try {
      client = await this.getClient();
      if (!client) {
        return false;
      }
      const ldapClient = client;
      const config = this.config;
      if (!config) {
        return false;
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
        return false;
      }

      // Try to bind as the user
      // We need a new client for this to verify credentials safely without messing up the service connection state
      // or we can just re-bind. Re-binding on the same client is standard.
      await new Promise<void>((resolve, reject) => {
        ldapClient.bind(userDn, password, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return true;
    } catch (err) {
      logger.error({ err: serializeError(err), username }, 'LDAP auth error');
      return false;
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
            entries.push(entry.object as unknown as LdapEntry);
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

        if (existing) {
          await usersRepo.updateNameByUsername(username, name);
          syncedCount++;
        } else {
          await usersRepo.createUser({
            id: generatePrefixedId('u'),
            name,
            username,
            passwordHash: usersRepo.LDAP_PLACEHOLDER_PASSWORD_HASH,
            role: 'user',
            avatarInitials: computeAvatarInitials(name),
          });
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
