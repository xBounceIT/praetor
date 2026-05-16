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
  applyExternalRolesForUserIfMatched,
  type ExternalRoleMapping,
  filterExistingRoleIds,
  mapExternalGroupsToMatchedRoleIds,
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
  // ldapjs v3 emits a DN object here; legacy/mocked shapes use a string. Both have toString().
  objectName: string | { toString(): string };
  // Legacy ldapjs v2 (and existing test mocks) expose a pre-flattened attribute map.
  object?: Record<string, unknown>;
  // ldapjs v3 exposes parsed attributes as { type, values: string[] } pairs.
  attributes?: Array<{ type: string; values: string[] }>;
}

const flattenSearchEntryAttributes = (entry: LdapSearchEntry): Record<string, unknown> => {
  if (entry.object && typeof entry.object === 'object') {
    return entry.object;
  }
  const flat: Record<string, unknown> = {};
  for (const attr of entry.attributes ?? []) {
    flat[attr.type] = attr.values;
  }
  return flat;
};

export type LdapAuthResult = {
  authenticated: boolean;
  userDn?: string;
  groups: string[];
  matchedRoleIds: string[];
  canonicalUsername?: string;
  displayName?: string;
};

export type LdapUserEntry = {
  dn: string;
  attributes: Record<string, unknown>;
};

type LdapClientOptions = {
  allowDisabledConfig?: boolean;
  reloadConfig?: boolean;
};

const warnRoleMappingNoMatch = (
  phase: string,
  user: { id: string; username: string; role: string },
  groups: string[],
): void => {
  logger.warn(
    { userId: user.id, username: user.username, groups, currentRole: user.role },
    `${phase}: no LDAP group matched a role mapping — preserving existing role`,
  );
};

const pickFirstString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed.length > 0) return trimmed;
      }
    }
  }
  return undefined;
};

const getAttributeValues = (attributes: Record<string, unknown>, name: string): string[] => {
  const normalizedName = name.toLowerCase();
  const values: string[] = [];

  for (const [key, value] of Object.entries(attributes)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey !== normalizedName && !normalizedKey.startsWith(`${normalizedName};`)) {
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) values.push(trimmed);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== 'string') continue;
        const trimmed = item.trim();
        if (trimmed) values.push(trimmed);
      }
    }
  }

  return values;
};

const addGroupEntryAliases = (
  groups: Set<string>,
  attributes: Record<string, unknown>,
  objectName?: string,
): void => {
  if (objectName) groups.add(objectName);
  for (const value of getAttributeValues(attributes, 'dn')) {
    groups.add(value);
  }
  for (const value of getAttributeValues(attributes, 'distinguishedName')) {
    groups.add(value);
  }
  for (const value of getAttributeValues(attributes, 'cn')) {
    groups.add(value);
  }
};

const deriveCanonicalUsername = (
  attributes: Record<string, unknown>,
  typedUsername: string,
): string =>
  pickFirstString(attributes.uid) ?? pickFirstString(attributes.sAMAccountName) ?? typedUsername;

const deriveDisplayName = (attributes: Record<string, unknown>, fallback: string): string =>
  pickFirstString(attributes.cn) ?? pickFirstString(attributes.displayName) ?? fallback;

const isUniqueViolationError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === '23505';
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

  async getClient(options: LdapClientOptions = {}): Promise<LdapClient | null> {
    if (!this.config || options.reloadConfig) {
      await this.loadConfig();
    }

    if (!this.config || (!options.allowDisabledConfig && !this.config.enabled)) {
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

  private getRoleMappings(): ExternalRoleMapping[] {
    return (this.config?.roleMappings ?? []).map((mapping) => ({
      externalGroup: mapping.ldapGroup,
      role: mapping.role,
    }));
  }

  async authenticateWithProfile(
    username: string,
    password: string,
    options: LdapClientOptions = {},
  ): Promise<LdapAuthResult> {
    let client: LdapClient | null = null;
    try {
      client = await this.getClient(options);
      if (!client) {
        return { authenticated: false, groups: [], matchedRoleIds: [] };
      }
      const ldapClient = client;
      const config = this.config;
      if (!config) {
        return { authenticated: false, groups: [], matchedRoleIds: [] };
      }

      // Bind with service account first to find the user's DN. A failure here is a system
      // problem (bad service creds, network), not a user-credential issue — propagate.
      await new Promise<void>((resolve, reject) => {
        ldapClient.bind(config.bindDn, config.bindPassword, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Find user entry (DN + attributes for canonical username/display name)
      const userEntry = await this.findUserEntry(ldapClient, username);
      if (!userEntry) {
        return { authenticated: false, groups: [], matchedRoleIds: [] };
      }
      const userDn = userEntry.dn;
      const canonicalUsername = deriveCanonicalUsername(userEntry.attributes, username);

      // Re-bind as the user to verify the supplied password before doing any further
      // (potentially N+1) work. A failure here means wrong credentials — return
      // `authenticated: false` and let the caller surface 401. We do NOT widen this to
      // swallow other errors above: an LDAP outage must propagate so the route can
      // return 503 instead of misreporting "Invalid username or password".
      try {
        await new Promise<void>((resolve, reject) => {
          ldapClient.bind(userDn, password, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (err) {
        logger.warn(
          { err: serializeError(err), username },
          'LDAP user bind failed (treated as invalid credentials)',
        );
        return { authenticated: false, groups: [], matchedRoleIds: [] };
      }

      // The user bind above is only a credential check. Directory reads should use the
      // configured bind DN so group lookup follows the operator's configured search account.
      await new Promise<void>((resolve, reject) => {
        ldapClient.bind(config.bindDn, config.bindPassword, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Search groups under both the canonical and typed identifiers so configs whose
      // groupFilter expects e.g. `memberUid={0}` work even when the user typed an alias
      // (email/UPN) that userFilter accepted.
      const groups = await this.findUserGroups(ldapClient, userDn, [canonicalUsername, username]);

      return {
        authenticated: true,
        userDn,
        groups,
        matchedRoleIds: mapExternalGroupsToMatchedRoleIds(groups, this.getRoleMappings()),
        canonicalUsername,
        displayName: deriveDisplayName(userEntry.attributes, canonicalUsername),
      };
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

  async authenticateAndProvision(
    username: string,
    password: string,
  ): Promise<{
    authenticated: boolean;
    userId?: string;
    created?: boolean;
    canonicalUsername?: string;
  }> {
    const result = await this.authenticateWithProfile(username, password);
    if (!result.authenticated) {
      return { authenticated: false };
    }
    const canonicalUsername = result.canonicalUsername ?? username;
    const roleMappings = this.getRoleMappings();

    const existingByCanonical = await usersRepo.findLoginUserByUsername(canonicalUsername);
    if (existingByCanonical) {
      if (
        existingByCanonical.employeeType !== 'app_user' ||
        existingByCanonical.authMethod !== 'ldap'
      ) {
        logger.warn(
          { username: canonicalUsername },
          'LDAP login matched a local Praetor user not bound to LDAP; refusing auto-provision',
        );
        return { authenticated: false };
      }
      const applied = await applyExternalRolesForUserIfMatched(
        existingByCanonical.id,
        result.groups,
        roleMappings,
      );
      if (!applied.applied) {
        warnRoleMappingNoMatch(
          'LDAP login',
          {
            id: existingByCanonical.id,
            username: canonicalUsername,
            role: existingByCanonical.role,
          },
          result.groups,
        );
      }
      return {
        authenticated: true,
        userId: existingByCanonical.id,
        created: false,
        canonicalUsername,
      };
    }

    // Gate placement is load-bearing: it sits after the existing-user branch so already
    // provisioned LDAP users still authenticate and refresh roles when the flag is off.
    // The explicit DEFAULT_CONFIG fallback handles a `this.config === null` race after
    // `invalidateConfig()` — fail safe by allowing provisioning rather than locking out.
    if (!(this.config?.provisionOnLogin ?? ldapRepo.DEFAULT_CONFIG.provisionOnLogin)) {
      logger.warn(
        { username: canonicalUsername },
        'LDAP login authenticated for unknown user but provisionOnLogin is disabled; refusing login',
      );
      return { authenticated: false };
    }

    const name = result.displayName ?? canonicalUsername;
    const id = generatePrefixedId('u');
    // Filter against existing role rows so a mapping referencing a deleted role doesn't
    // violate the users.role FK; applyExternalRolesForUser below will replace the primary
    // role and user_roles set anyway, but the initial insert still needs a valid row.
    const filteredRoleIds = await filterExistingRoleIds(
      mapExternalGroupsToRoleIds(result.groups, roleMappings),
    );
    const primaryRole = filteredRoleIds[0];

    try {
      await usersRepo.createUser({
        id,
        name,
        username: canonicalUsername,
        passwordHash: usersRepo.EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
        role: primaryRole,
        avatarInitials: computeAvatarInitials(name),
        authMethod: 'ldap',
        authProviderId: null,
      });
    } catch (err) {
      if (isUniqueViolationError(err)) {
        const racedUser = await usersRepo.findLoginUserByUsername(canonicalUsername);
        if (racedUser && racedUser.employeeType === 'app_user' && racedUser.authMethod === 'ldap') {
          const applied = await applyExternalRolesForUserIfMatched(
            racedUser.id,
            result.groups,
            roleMappings,
          );
          if (!applied.applied) {
            warnRoleMappingNoMatch(
              'LDAP login (race recovery)',
              { id: racedUser.id, username: canonicalUsername, role: racedUser.role },
              result.groups,
            );
          }
          return {
            authenticated: true,
            userId: racedUser.id,
            created: false,
            canonicalUsername,
          };
        }
        logger.warn(
          { username: canonicalUsername },
          'LDAP auto-provision raced with a non-LDAP row; refusing login',
        );
        return { authenticated: false };
      }
      throw err;
    }

    await applyExternalRolesForUser(id, result.groups, roleMappings);
    return { authenticated: true, userId: id, created: true, canonicalUsername };
  }

  async authenticate(username: string, password: string): Promise<boolean> {
    const result = await this.authenticateWithProfile(username, password);
    return result.authenticated;
  }

  async lookupUserGroups(
    username: string,
  ): Promise<{ groups: string[]; roleMappings: ExternalRoleMapping[] } | null> {
    let client: LdapClient | null = null;
    try {
      client = await this.getClient();
      if (!client) {
        return null;
      }
      const ldapClient = client;
      const config = this.config;
      if (!config) {
        return null;
      }

      await new Promise<void>((resolve, reject) => {
        ldapClient.bind(config.bindDn, config.bindPassword, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const userEntry = await this.findUserEntry(ldapClient, username);
      if (!userEntry) {
        return null;
      }

      // Use throwOnError so a transient group-search failure surfaces here as null
      // (keep existing role) instead of falling through to applyExternalRolesForUser with
      // an empty group list, which would demote the user to the default 'user' role.
      const groups = await this.findUserGroups(ldapClient, userEntry.dn, username, {
        throwOnError: true,
      });
      return { groups, roleMappings: this.getRoleMappings() };
    } catch (err) {
      logger.warn({ err: serializeError(err), username }, 'LDAP user lookup failed');
      return null;
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
    const entry = await this.findUserEntry(client, username);
    return entry?.dn ?? null;
  }

  async findUserEntry(client: LdapClient, username: string): Promise<LdapUserEntry | null> {
    const config = this.config;
    if (!config) {
      return null;
    }
    const searchOptions = {
      scope: 'sub',
      filter: buildUserLookupFilter(config.userFilter, username),
      attributes: ['uid', 'sAMAccountName', 'cn', 'displayName'],
    };

    return new Promise((resolve, reject) => {
      client.search(config.baseDn, searchOptions, (err, res) => {
        if (err) return reject(err);

        let found: LdapUserEntry | null = null;

        res.on('searchEntry', (entry: LdapSearchEntry) => {
          // v3 emits a DN object; bind serializes via writeString which throws on non-strings.
          const dn = entry.objectName?.toString() ?? null;
          if (!dn) return;
          found = { dn, attributes: flattenSearchEntryAttributes(entry) };
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

  async findUserGroups(
    client: LdapClient,
    userDn: string,
    usernames: string | string[],
    options: { throwOnError?: boolean } = {},
  ): Promise<string[]> {
    const config = this.config;
    if (!config?.groupBaseDn || !config.groupFilter) {
      return [];
    }

    const usernameList = (Array.isArray(usernames) ? usernames : [usernames]).filter(Boolean);
    const searchValues = [userDn, ...usernameList].filter(
      (value, idx, arr) => value && arr.indexOf(value) === idx,
    );
    const groups = new Set<string>();
    const username = usernameList[0] ?? userDn;

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
        if (options.throwOnError) throw err;
        if (groups.size > 0) return [...groups];
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
              const objectName = entry.objectName?.toString();
              const attributes = flattenSearchEntryAttributes(entry);
              addGroupEntryAliases(groups, attributes, objectName);
            });

            res.on('error', (err: Error) => reject(err));
            res.on('end', () => resolve());
          });
        });
      } catch (err) {
        if (options.throwOnError) throw err;
        if (groups.size > 0) return [...groups];
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
              ...flattenSearchEntryAttributes(entry),
              objectName: entry.objectName?.toString() ?? '',
            });
          });

          // Reject (rather than swallow) so partial syncs fail loudly instead of being
          // reported as success with a truncated count. The outer catch handles logging.
          res.on('error', (err: Error) => reject(err));

          res.on('end', (result: { status: number }) => {
            if (result.status !== 0) {
              reject(new Error(`LDAP search failed status: ${result.status}`));
            } else {
              resolve();
            }
          });
        });
      });

      logger.info({ count: entries.length }, 'Found LDAP users');

      let syncedCount = 0;
      let createdCount = 0;
      const roleMappings = this.getRoleMappings();

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
          if (existing.employeeType !== 'app_user' || existing.authMethod !== 'ldap') {
            logger.warn(
              { username },
              'Skipping LDAP sync for a matching Praetor user not bound to LDAP',
            );
            continue;
          }
          const groups = await this.findUserGroups(ldapClient, entry.objectName, username);
          await usersRepo.updateNameByUsername(username, name);
          const applied = await applyExternalRolesForUserIfMatched(
            existing.id,
            groups,
            roleMappings,
          );
          if (!applied.applied) {
            warnRoleMappingNoMatch(
              'LDAP sync',
              { id: existing.id, username, role: existing.role },
              groups,
            );
          }
          syncedCount++;
        } else if (config.autoProvisionAll) {
          const groups = await this.findUserGroups(ldapClient, entry.objectName, username);
          const roleIds = mapExternalGroupsToRoleIds(groups, roleMappings);
          const id = generatePrefixedId('u');
          await usersRepo.createUser({
            id,
            name,
            username,
            passwordHash: usersRepo.EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
            role: roleIds[0],
            avatarInitials: computeAvatarInitials(name),
            authMethod: 'ldap',
            authProviderId: null,
          });
          await applyExternalRolesForUser(id, groups, roleMappings);
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
