import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { createChildLogger } from '../utils/logger.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { query } from './index.ts';

export const ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_USER_ID = 'u1';

// Legacy hardcoded default. Kept as a constant so we can keep flagging existing
// installations that still use it via the password-change notification. We no
// longer apply this to NEW installations — see `resolveAdminBootstrapPassword`.
export const DEFAULT_BOOTSTRAP_ADMIN_PASSWORD = 'password';

const ADMIN_PASSWORD_ENV = 'ADMIN_DEFAULT_PASSWORD';

const logger = createChildLogger({ module: 'db:bootstrap-admin' });

const generateRandomAdminPassword = (): string =>
  // 24 bytes -> 32 base64url chars, plenty of entropy and shell-friendly.
  randomBytes(24).toString('base64url');

type AdminBootstrapPassword = {
  password: string;
  source: 'env' | 'generated';
};

export const resolveAdminBootstrapPassword = (
  envValue: string | undefined = process.env[ADMIN_PASSWORD_ENV],
): AdminBootstrapPassword => {
  if (typeof envValue === 'string' && envValue.length > 0) {
    return { password: envValue, source: 'env' };
  }
  return { password: generateRandomAdminPassword(), source: 'generated' };
};

export const syncDefaultAdminPasswordWarning = async (
  adminId: string,
  passwordHash: string | null | undefined,
) => {
  const usesDefaultPassword =
    typeof passwordHash === 'string' &&
    (await bcrypt.compare(DEFAULT_BOOTSTRAP_ADMIN_PASSWORD, passwordHash));

  if (usesDefaultPassword) {
    await notificationsRepo.upsertAdminPasswordWarning(adminId);
  } else {
    await notificationsRepo.deleteAdminPasswordWarning();
  }
};

export const ensureBootstrapAdmin = async () => {
  const existingAdmin = await query(
    'SELECT id, password_hash FROM users WHERE username = $1 LIMIT 1',
    [ADMIN_USERNAME],
  );

  let adminId: string;
  let adminPasswordHash: string | null | undefined;
  if (existingAdmin.rows.length > 0) {
    adminId = existingAdmin.rows[0].id as string;
    adminPasswordHash = existingAdmin.rows[0].password_hash as string | null | undefined;
    logger.info('Bootstrap admin already exists. Skipping admin creation');
  } else {
    const defaultIdCheck = await query('SELECT 1 FROM users WHERE id = $1 LIMIT 1', [
      DEFAULT_ADMIN_USER_ID,
    ]);
    adminId = defaultIdCheck.rows.length === 0 ? DEFAULT_ADMIN_USER_ID : generatePrefixedId('u');

    const resolved = resolveAdminBootstrapPassword();
    adminPasswordHash = await bcrypt.hash(resolved.password, 12);

    await usersRepo.createUser({
      id: adminId,
      name: 'Admin User',
      username: ADMIN_USERNAME,
      passwordHash: adminPasswordHash,
      role: 'admin',
      avatarInitials: 'AD',
    });

    if (resolved.source === 'generated') {
      // Surface the generated credential exactly once so the operator can capture it
      // before rotating. Write directly to stderr in addition to the structured log so
      // the credential is visible even when LOG_LEVEL filters out warn (e.g. `error`).
      const banner = [
        '====================================================================',
        '  Praetor bootstrap admin created with a generated password.',
        `  Capture it now and rotate it. Set ${ADMIN_PASSWORD_ENV} to override.`,
        `  username: ${ADMIN_USERNAME}`,
        `  password: ${resolved.password}`,
        '====================================================================',
        '',
      ].join('\n');
      process.stderr.write(banner);
      logger.warn(
        {
          adminUsername: ADMIN_USERNAME,
          generatedAdminPassword: resolved.password,
        },
        `Bootstrap admin created with a generated password. Capture it now and rotate it. Set ${ADMIN_PASSWORD_ENV} to override on first run.`,
      );
    } else {
      logger.info(
        `Bootstrap admin created with password from ${ADMIN_PASSWORD_ENV} environment variable`,
      );
    }
  }

  await query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    adminId,
    'admin',
  ]);

  await syncDefaultAdminPasswordWarning(adminId, adminPasswordHash);

  return adminId;
};
