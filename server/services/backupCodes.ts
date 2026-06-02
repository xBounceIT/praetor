import { type DbExecutor, db } from '../db/drizzle.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { verifyBackupCode } from '../utils/totp.ts';

// Attempts to redeem a submitted backup code against the caller's stored (hashed) codes: reads the
// codes, finds the first unused match, stamps its `usedAt`, and persists the mutated array — all
// on the passed executor. Callers MUST invoke this inside a `withDbTransaction` so the
// read-verify-write is atomic and a single code cannot be spent twice by concurrent requests.
// Returns whether a code was consumed.
export const redeemBackupCode = async (
  userId: string,
  submitted: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const state = await usersRepo.getTotpState(userId, exec);
  const codes = state?.totpBackupCodes;
  if (!codes || codes.length === 0) return false;

  for (let i = 0; i < codes.length; i++) {
    const entry = codes[i];
    if (entry.usedAt !== null) continue;
    if (await verifyBackupCode(submitted, entry.hash)) {
      const updated = codes.map((c, idx) =>
        idx === i ? { ...c, usedAt: new Date().toISOString() } : c,
      );
      await usersRepo.markBackupCodeUsed(userId, updated, exec);
      return true;
    }
  }
  return false;
};
