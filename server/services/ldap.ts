import fs from 'fs';
import ldap from 'ldapjs';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index.ts';

type LdapConfig = {
  enabled: boolean;
  server_url: string;
  bind_dn: string;
  bind_password: string;
  base_dn: string;
  user_filter: string;
};

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
    options: { scope: string; filter: string; attributes?: string[] },
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
  config: LdapConfig | null;

  constructor() {
    this.config = null;
  }

  async loadConfig() {
    const result = await query('SELECT * FROM ldap_config WHERE id = 1');
    if (result.rows.length > 0) {
      this.config = result.rows[0];
    }
  }

  async getClient(): Promise<LdapClient | null> {
    if (!this.config) {
      await this.loadConfig();
    }

    if (!this.config || !this.config.enabled) {
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
      url: this.config.server_url,
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

      // Bind with service account first to find the user's DN
      await new Promise<void>((resolve, reject) => {
        client!.bind(this.config!.bind_dn, this.config!.bind_password, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Find user DN
      const userDn = await this.findUserDn(client, username);
      if (!userDn) {
        return false;
      }

      // Try to bind as the user
      // We need a new client for this to verify credentials safely without messing up the service connection state
      // or we can just re-bind. Re-binding on the same client is standard.
      await new Promise<void>((resolve, reject) => {
        if (!client) return reject(new Error('Client not available'));
        client.bind(userDn, password, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return true;
    } catch (err) {
      console.error('LDAP Auth Error:', err);
      return false;
    } finally {
      if (client) {
        client.unbind((err) => {
          if (err) console.error('Error unbinding LDAP client:', err);
        });
      }
    }
  }

  async findUserDn(client: LdapClient, username: string): Promise<string | null> {
    const filter = this.config!.user_filter.replace('{0}', username);
    const searchOptions = {
      scope: 'sub',
      filter: filter,
    };

    return new Promise((resolve, reject) => {
      client.search(this.config!.base_dn, searchOptions, (err, res) => {
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
      console.log('Starting LDAP Sync...');
      client = await this.getClient();
      if (!client) {
        console.log('LDAP Sync skipped: LDAP is disabled.');
        return { skipped: true, reason: 'LDAP is disabled' };
      }

      await new Promise<void>((resolve, reject) => {
        client!.bind(this.config!.bind_dn, this.config!.bind_password, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Search for all users
      if (!this.config) {
        return { skipped: true, reason: 'LDAP config not loaded' };
      }
      const filter = this.config.user_filter.replace('{0}', '*'); // Assumption: filter can handle * wildcard for all
      // If user_filter is strictly (uid={0}), then (uid=*) should work.

      const searchOptions = {
        scope: 'sub',
        filter: filter,
        attributes: ['uid', 'cn', 'sn', 'givenName', 'mail'], // Request common attributes
      };

      const entries: LdapEntry[] = [];

      await new Promise<void>((resolve, reject) => {
        if (!client || !this.config) return reject(new Error('Client or config missing'));
        client.search(this.config.base_dn, searchOptions, (err, res) => {
          if (err) return reject(err);

          res.on('searchEntry', (entry: LdapSearchEntry) => {
            entries.push(entry.object as unknown as LdapEntry);
          });

          res.on('error', (err: Error) => {
            console.error('LDAP Search Error:', err);
          });

          res.on('end', () => {
            resolve();
          });
        });
      });

      console.log(`Found ${entries.length} users in LDAP.`);

      let syncedCount = 0;
      let createdCount = 0;

      for (const entry of entries) {
        // Extract username. Depending on schema it might be 'uid' or 'sAMAccountName' (AD).
        // We'll try common fields or rely on what mapped to 'uid' in the object based on filter.
        // But usually 'uid' is the attribute.
        let username = entry.uid;
        if (Array.isArray(username)) username = username[0];

        // Fallback for AD
        if (!username && entry.sAMAccountName) {
          username = entry.sAMAccountName;
          if (Array.isArray(username)) username = username[0];
        }

        if (!username) {
          console.warn('Skipping LDAP entry without username');
          continue;
        }

        // Name
        const nameValue: string | string[] | undefined = entry.cn || entry.displayName;
        let name: string;
        if (nameValue) {
          name = Array.isArray(nameValue) ? nameValue[0] : nameValue;
        } else {
          name = username;
        }

        // Check dependencies
        // We matched local users by username
        const res = await query('SELECT * FROM users WHERE username = $1', [username]);

        if (res.rows.length > 0) {
          // Update existing
          await query('UPDATE users SET name = $1 WHERE username = $2', [name, username]);
          syncedCount++;
        } else {
          // Create new
          // We need a dummy password hash or maybe handle it.
          // Since we don't have their password, we can set a random unguessable hash
          // or flag them. But for now invalid hash is fine?
          // Or let's just leave it empty string?
          // The 'users' table has `password_hash` NOT NULL.
          // We'll set a placeholder that bcrypt won't match.

          // Initials
          const initials = name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();

          const newId = uuidv4();
          await query(
            `INSERT INTO users (id, name, username, password_hash, role, avatar_initials)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              newId,
              name,
              username,
              '$2a$10$invalidpasswordhashforldapuser00000000000000',
              'user',
              initials,
            ],
          );
          createdCount++;
        }
      }

      console.log(`LDAP Sync Complete. Sycned: ${syncedCount}, Created: ${createdCount}`);
      return { synced: syncedCount, created: createdCount };
    } catch (err) {
      console.error('LDAP Sync Failed:', err);
      throw err;
    } finally {
      if (client) {
        client.unbind(() => {});
      }
    }
  }
}

export default new LDAPService();
