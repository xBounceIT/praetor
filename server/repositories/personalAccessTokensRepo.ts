import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import { personalAccessTokens } from '../db/schema/personalAccessTokens.ts';
import { currentTokenVersionSubquery } from './usersRepo.ts';

export type PersonalAccessTokenRecord = {
  userId: string;
  tokenHash: string;
  tokenPrefix: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
  tokenVersionAtIssue: number;
};

const TOKEN_PROJECTION = {
  userId: personalAccessTokens.userId,
  tokenHash: personalAccessTokens.tokenHash,
  tokenPrefix: personalAccessTokens.tokenPrefix,
  createdAt: personalAccessTokens.createdAt,
  updatedAt: personalAccessTokens.updatedAt,
  lastUsedAt: personalAccessTokens.lastUsedAt,
  tokenVersionAtIssue: personalAccessTokens.tokenVersionAtIssue,
} as const;

export const findByUserId = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<PersonalAccessTokenRecord | null> => {
  const rows = await exec
    .select(TOKEN_PROJECTION)
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, userId));
  return rows[0] ?? null;
};

export const findByTokenHash = async (
  tokenHash: string,
  exec: DbExecutor = db,
): Promise<PersonalAccessTokenRecord | null> => {
  const rows = await exec
    .select(TOKEN_PROJECTION)
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.tokenHash, tokenHash));
  return rows[0] ?? null;
};

export const createForUserIfMissing = async (
  userId: string,
  tokenHash: string,
  tokenPrefix: string,
  exec: DbExecutor = db,
): Promise<{ record: PersonalAccessTokenRecord; created: boolean }> =>
  // SELECT-then-INSERT must observe a consistent snapshot so the caller never receives a
  // (record, created=true) pair whose tokenHash isn't the one the caller passed in.
  runAtomically(exec, async (tx) => {
    const existing = await findByUserId(userId, tx);
    if (existing) return { record: existing, created: false };

    const inserted = await tx
      .insert(personalAccessTokens)
      .values({
        userId,
        tokenHash,
        tokenPrefix,
        tokenVersionAtIssue: currentTokenVersionSubquery(userId),
      })
      .onConflictDoNothing({ target: personalAccessTokens.userId })
      .returning(TOKEN_PROJECTION);

    if (inserted[0]) return { record: inserted[0], created: true };

    // Another concurrent transaction inserted between our SELECT and INSERT. Re-fetch so the
    // caller sees the winning row and knows it didn't create it (so it won't return its
    // own raw token to the client).
    const winner = await findByUserId(userId, tx);
    if (!winner) {
      throw new Error('Failed to create personal access token');
    }
    return { record: winner, created: false };
  });

export const renewForUser = async (
  userId: string,
  tokenHash: string,
  tokenPrefix: string,
  exec: DbExecutor = db,
): Promise<PersonalAccessTokenRecord> => {
  // Re-snapshot the user's current token_version in both branches so a renewed
  // PAT survives any prior bumps — the old PAT is being thrown away anyway.
  const currentVersion = currentTokenVersionSubquery(userId);
  const rows = await exec
    .insert(personalAccessTokens)
    .values({ userId, tokenHash, tokenPrefix, tokenVersionAtIssue: currentVersion })
    .onConflictDoUpdate({
      target: personalAccessTokens.userId,
      set: {
        tokenHash,
        tokenPrefix,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        lastUsedAt: null,
        tokenVersionAtIssue: currentVersion,
      },
    })
    .returning(TOKEN_PROJECTION);
  return rows[0];
};

export const markUsed = async (tokenHash: string, exec: DbExecutor = db): Promise<void> => {
  await exec
    .update(personalAccessTokens)
    .set({ lastUsedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(personalAccessTokens.tokenHash, tokenHash));
};
