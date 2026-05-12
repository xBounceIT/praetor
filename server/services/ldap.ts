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

const flattenAttr = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
};

const pickDisplayName = (entry: Record<string, unknown> | undefined): string | undefined => {
  if (!entry) return undefined;
  return flattenAttr(entry.cn) ?? flattenAttr(entry.displayName);
};

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
    const result = await this.authenticateWithProfile(username, password);
    return result.authenticated;
  }

  async authenticateWithProfile(
    username: string,
    password: string,
  ): Promise<{ authenticated: boolean; userDn?: string; entry?: Record<string, unknown> }> {
    let client: LdapClient | null = null;
    try {
      client = await this.getClient();
      if (!client) {
        return { authenticated: false };
      }
      const ldapClient = client;
      const config = this.config;
      if (!config) {
        return { authenticated: false };
      }

      // Service-account bind to look up the user's DN, then re-bind as the user to verify creds.
      await new Promise<void>((resolve, reject) => {
        ldapClient.bind(config.bindDn, config.bindPassword, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const userEntry = await this.findUserEntry(ldapClient, username);
      if (!userEntry) {
        return { authenticated: false };
      }

      await new Promise<void>((resolve, reject) => {
        ldapClient.bind(userEntry.dn, password, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return { authenticated: true, userDn: userEntry.dn, entry: userEntry.object };
    } catch (err) {
      logger.error({ err: serializeError(err), username }, 'LDAP auth error');
      return { authenticated: false };
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

  // Authenticate against LDAP and, on success, ensure a local user row exists. Returns the
  // local userId only when authentication succeeded; the caller then re-fetches the row.
  async authenticateAndProvision(
    username: string,
    password: string,
  ): Promise<{ authenticated: boolean; userId?: string; created?: boolean }> {
    const result = await this.authenticateWithProfile(username, password);
    if (!result.authenticated) {
      return { authenticated: false };
    }

    const existing = await usersRepo.findLoginUserByUsername(username);
    if (existing) {
      return { authenticated: true, userId: existing.id, created: false };
    }

    const name = pickDisplayName(result.entry) ?? username;
    const id = generatePrefixedId('u');
    try {
      await usersRepo.createUser({
        id,
        name,
        username,
        passwordHash: usersRepo.LDAP_PLACEHOLDER_PASSWORD_HASH,
        role: 'user',
        avatarInitials: computeAvatarInitials(name),
      });
      logger.info({ username, userId: id }, 'LDAP auto-provisioned new user on first login');
      return { authenticated: true, userId: id, created: true };
    } catch (err) {
      // Race: a concurrent login may have just created the row. Re-fetch and reuse it.
      const racedExisting = await usersRepo.findLoginUserByUsername(username);
      if (racedExisting) {
        return { authenticated: true, userId: racedExisting.id, created: false };
      }
      logger.error(
        { err: serializeError(err), username },
        'Failed to auto-provision LDAP user on first login',
      );
      return { authenticated: false };
    }
  }

  async findUserDn(client: LdapClient, username: string): Promise<string | null> {
    const entry = await this.findUserEntry(client, username);
    return entry?.dn ?? null;
  }

  async findUserEntry(
    client: LdapClient,
    username: string,
  ): Promise<{ dn: string; object: Record<string, unknown> } | null> {
    const config = this.config;
    if (!config) {
      return null;
    }
    const searchOptions = {
      scope: 'sub',
      filter: buildUserLookupFilter(config.userFilter, username),
      attributes: ['uid', 'cn', 'sn', 'givenName', 'mail', 'displayName', 'sAMAccountName'],
    };

    return new Promise((resolve, reject) => {
      client.search(config.baseDn, searchOptions, (err, res) => {
        if (err) return reject(err);

        let found: { dn: string; object: Record<string, unknown> } | null = null;

        res.on('searchEntry', (entry: LdapSearchEntry) => {
          found = { dn: entry.objectName, object: entry.object ?? {} };
        });

        res.on('error', (err: Error) => {
          reject(err);
        });

        res.on('end', (result: { status: number }) => {
          if (result.status !== 0) {
            reject(new Error('LDAP search failed status: ' + result.status));
          } else {
            resolve(found);
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
        // Fall back to sAMAccountName when uid is missing (AD path).
        const username = flattenAttr(entry.uid) ?? flattenAttr(entry.sAMAccountName);

        if (!username) {
          logger.warn('Skipping LDAP entry without username');
          continue;
        }

        const name = pickDisplayName(entry as Record<string, unknown>) ?? username;

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
