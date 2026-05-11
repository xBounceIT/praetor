import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
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
): Promise<{ record: PersonalAccessTokenRecord; created: boolean }> => {
  const inserted = await exec
    .insert(personalAccessTokens)
    .values({ userId, tokenHash, tokenPrefix })
    .onConflictDoNothing({ target: personalAccessTokens.userId })
    .returning(TOKEN_PROJECTION);

  if (inserted[0]) return { record: inserted[0], created: true };

  const existing = await findByUserId(userId, exec);
  if (!existing) {
    throw new Error('Failed to create personal access token');
  }
  return { record: existing, created: false };
};

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
