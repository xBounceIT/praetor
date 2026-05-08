import bcrypt from 'bcryptjs';
import * as usersRepo from '../repositories/usersRepo.ts';
import { createChildLogger } from '../utils/logger.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import {
  INSECURE_DEFAULT_ADMIN_PASSWORD,
  readRequiredNonDefaultEnv,
} from '../utils/runtimeConfig.ts';
import { query } from './index.ts';

export const ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_USER_ID = 'u1';

const logger = createChildLogger({ module: 'db:bootstrap-admin' });

const resolveBootstrapAdminPassword = () =>
  readRequiredNonDefaultEnv('ADMIN_DEFAULT_PASSWORD', INSECURE_DEFAULT_ADMIN_PASSWORD, {
    missing: 'ADMIN_DEFAULT_PASSWORD must be set before creating the bootstrap admin',
    defaultValue: 'ADMIN_DEFAULT_PASSWORD must not use the default password',
  });

export const ensureBootstrapAdmin = async () => {
  const existingAdmin = await query('SELECT id FROM users WHERE username = $1 LIMIT 1', [
    ADMIN_USERNAME,
  ]);

  let adminId: string;
  if (existingAdmin.rows.length > 0) {
    adminId = existingAdmin.rows[0].id as string;
    logger.info('Bootstrap admin already exists. Skipping admin creation');
  } else {
    const defaultIdCheck = await query('SELECT 1 FROM users WHERE id = $1 LIMIT 1', [
      DEFAULT_ADMIN_USER_ID,
    ]);
    adminId = defaultIdCheck.rows.length === 0 ? DEFAULT_ADMIN_USER_ID : generatePrefixedId('u');

    const adminPassword = resolveBootstrapAdminPassword();
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    await usersRepo.createUser({
      id: adminId,
      name: 'Admin User',
      username: ADMIN_USERNAME,
      passwordHash,
      role: 'admin',
      avatarInitials: 'AD',
    });
    logger.info(
      {
        passwordSource: 'ADMIN_DEFAULT_PASSWORD',
      },
      'Bootstrap admin created',
    );
  }

  await query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    adminId,
    'admin',
  ]);

  return adminId;
};
