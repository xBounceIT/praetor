import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';

export type FirstInteractiveLoginOptions = {
  createRilPreferencesTip: boolean;
};

/**
 * Records the first issued app session and, for users who can access RIL, creates the related
 * onboarding tip in the same transaction. Subsequent logins are no-ops.
 */
export const recordFirstInteractiveLogin = async (
  userId: string,
  options: FirstInteractiveLoginOptions,
  exec: DbExecutor = db,
): Promise<boolean> =>
  runAtomically(exec, async (tx) => {
    const isFirstLogin = await usersRepo.claimFirstLogin(userId, tx);
    if (isFirstLogin && options.createRilPreferencesTip) {
      await notificationsRepo.createRilPreferencesTip(userId, tx);
    }
    return isFirstLogin;
  });
