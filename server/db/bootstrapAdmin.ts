import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { createChildLogger } from '../utils/logger.ts';
import { query } from './index.ts';

export const ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_USER_ID = 'u1';
export const DEFAULT_ADMIN_PASSWORD = 'password';

const logger = createChildLogger({ module: 'db:bootstrap-admin' });

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
    adminId = defaultIdCheck.rows.length === 0 ? DEFAULT_ADMIN_USER_ID : randomUUID();

    const rawPassword = process.env.ADMIN_DEFAULT_PASSWORD?.trim();
    const adminPassword =
      rawPassword && rawPassword.length > 0 ? rawPassword : DEFAULT_ADMIN_PASSWORD;
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    await query(
      `INSERT INTO users (id, name, username, password_hash, role, avatar_initials)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminId, 'Admin User', ADMIN_USERNAME, passwordHash, 'admin', 'AD'],
    );
    logger.info(
      {
        passwordSource:
          rawPassword && rawPassword.length > 0 ? 'ADMIN_DEFAULT_PASSWORD' : 'fallback',
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
