import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { createChildLogger } from '../utils/logger.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { withDbTransaction } from './drizzle.ts';

export const ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_USER_ID = 'u1';
export const DEFAULT_BOOTSTRAP_ADMIN_PASSWORD = 'password';
const INSECURE_BOOTSTRAP_ADMIN_PASSWORDS = [
  DEFAULT_BOOTSTRAP_ADMIN_PASSWORD,
  'change-me-strong-admin-password',
] as const;

// Dedicated two-key namespace for the transaction-level startup lock. Every replica uses the
// same keys, so the existence check and possible creation cannot overlap across processes.
const BOOTSTRAP_ADMIN_LOCK_CLASS = 0x50524145; // "PRAE"
const BOOTSTRAP_ADMIN_LOCK_OBJECT = 1;

const logger = createChildLogger({ module: 'db:bootstrap-admin' });

const resolveBootstrapAdminPassword = (): string => {
  const fromEnv = process.env.ADMIN_DEFAULT_PASSWORD?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BOOTSTRAP_ADMIN_PASSWORD;
};

const matchesInsecureBootstrapPassword = async (passwordHash: string): Promise<boolean> => {
  const matches = await Promise.all(
    INSECURE_BOOTSTRAP_ADMIN_PASSWORDS.map((candidate) => bcrypt.compare(candidate, passwordHash)),
  );
  return matches.some(Boolean);
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
    await notificationsRepo.deleteAdminPasswordWarning(adminId);
  }
};

export const ensureBootstrapAdmin = async () => {
  const { adminId, adminPasswordHash, created } = await withDbTransaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_ADMIN_LOCK_CLASS}, ${BOOTSTRAP_ADMIN_LOCK_OBJECT})`,
    );

    const existingAdmin = await usersRepo.findLoginUserByExactUsername(ADMIN_USERNAME, tx);
    let adminId: string;
    let adminPasswordHash: string | null;
    let created = false;
    if (existingAdmin) {
      adminId = existingAdmin.id;
      adminPasswordHash = existingAdmin.passwordHash;
    } else {
      const defaultIdUser = await usersRepo.findLoginUserById(DEFAULT_ADMIN_USER_ID, tx);
      adminId = defaultIdUser === null ? DEFAULT_ADMIN_USER_ID : generatePrefixedId('u');
      adminPasswordHash = await bcrypt.hash(resolveBootstrapAdminPassword(), 12);

      await usersRepo.createUser(
        {
          id: adminId,
          name: 'Admin User',
          username: ADMIN_USERNAME,
          passwordHash: adminPasswordHash,
          role: 'admin',
          avatarInitials: 'AD',
        },
        tx,
      );
      created = true;
    }

    await usersRepo.addUserRole(adminId, 'admin', tx);
    return { adminId, adminPasswordHash, created };
  });

  logger.info(
    created ? 'Bootstrap admin created' : 'Bootstrap admin already exists. Skipping admin creation',
  );

  await syncDefaultAdminPasswordWarning(adminId, adminPasswordHash);

  return adminId;
};
