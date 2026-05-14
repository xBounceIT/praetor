import bcrypt from 'bcryptjs';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { createChildLogger } from '../utils/logger.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { query } from './index.ts';

export const ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_USER_ID = 'u1';
export const DEFAULT_BOOTSTRAP_ADMIN_PASSWORD = 'password';
const INSECURE_BOOTSTRAP_ADMIN_PASSWORDS = [
  DEFAULT_BOOTSTRAP_ADMIN_PASSWORD,
  'change-me-strong-admin-password',
] as const;

const logger = createChildLogger({ module: 'db:bootstrap-admin' });

const resolveBootstrapAdminPassword = (): string => {
  const fromEnv = process.env.ADMIN_DEFAULT_PASSWORD?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BOOTSTRAP_ADMIN_PASSWORD;
};

const matchesInsecureBootstrapPassword = async (passwordHash: string): Promise<boolean> => {
  for (const candidate of INSECURE_BOOTSTRAP_ADMIN_PASSWORDS) {
    if (await bcrypt.compare(candidate, passwordHash)) return true;
  }
  return false;
};

export const syncDefaultAdminPasswordWarning = async (
  adminId: string,
  passwordHash: string | null | undefined,
) => {
  const usesInsecurePassword =
    typeof passwordHash === 'string' && (await matchesInsecureBootstrapPassword(passwordHash));

  if (usesInsecurePassword) {
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

    adminPasswordHash = await bcrypt.hash(resolveBootstrapAdminPassword(), 12);

    await usersRepo.createUser({
      id: adminId,
      name: 'Admin User',
      username: ADMIN_USERNAME,
      passwordHash: adminPasswordHash,
      role: 'admin',
      avatarInitials: 'AD',
    });
    logger.info('Bootstrap admin created');
  }

  await query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    adminId,
    'admin',
  ]);

  await syncDefaultAdminPasswordWarning(adminId, adminPasswordHash);

  return adminId;
};
