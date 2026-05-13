import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import { personalAccessTokens } from '../db/schema/personalAccessTokens.ts';

export type PersonalAccessTokenRecord = {
  userId: string;
  tokenHash: string;
  tokenPrefix: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
};

const TOKEN_PROJECTION = {
  userId: personalAccessTokens.userId,
  tokenHash: personalAccessTokens.tokenHash,
  tokenPrefix: personalAccessTokens.tokenPrefix,
  createdAt: personalAccessTokens.createdAt,
  updatedAt: personalAccessTokens.updatedAt,
  lastUsedAt: personalAccessTokens.lastUsedAt,
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
      .values({ userId, tokenHash, tokenPrefix })
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
  const rows = await exec
    .insert(personalAccessTokens)
    .values({ userId, tokenHash, tokenPrefix })
    .onConflictDoUpdate({
      target: personalAccessTokens.userId,
      set: {
        tokenHash,
        tokenPrefix,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        lastUsedAt: null,
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
