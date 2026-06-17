import { type DbExecutor, db } from '../db/drizzle.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { verifyBackupCode } from '../utils/totp.ts';

// Attempts to redeem a submitted backup code against the caller's stored (hashed) codes: reads the
// codes, finds the first unused match, stamps its `usedAt`, and persists the mutated array — all
// on the passed executor. Callers MUST invoke this inside a `withDbTransaction`: the read takes a
// `FOR UPDATE` row lock so a concurrent submission of the same code blocks until this transaction
// commits and then sees the stamped `usedAt`, so a single code cannot be spent twice.
// Returns whether a code was consumed.
export const redeemBackupCode = async (
  userId: string,
  submitted: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const state = await usersRepo.getTotpState(userId, exec, { forUpdate: true });
  const codes = state?.totpBackupCodes;
  if (!codes || codes.length === 0) return false;

  const unusedCodes = codes
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.usedAt === null);
  const verificationResults = await Promise.all(
    unusedCodes.map(({ entry }) => verifyBackupCode(submitted, entry.hash)),
  );
  const matchIndex = verificationResults.findIndex(Boolean);
  if (matchIndex < 0) return false;

  const usedCodeIndex = unusedCodes[matchIndex].index;
  const updated = codes.map((c, idx) =>
    idx === usedCodeIndex ? { ...c, usedAt: new Date().toISOString() } : c,
  );
  await usersRepo.markBackupCodeUsed(userId, updated, exec);
  return true;
};
