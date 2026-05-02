import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { settings } from '../db/schema/settings.ts';

export const LANGUAGES = ['en', 'it', 'auto'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'auto';

export type Settings = {
  fullName: string | null;
  email: string | null;
  language: Language;
};

const SETTINGS_PROJECTION = {
  fullName: settings.fullName,
  email: settings.email,
  language: settings.language,
} as const;

type SettingsRow = { fullName: string | null; email: string | null; language: string | null };

const mapRow = (row: SettingsRow): Settings => ({
  fullName: row.fullName,
  email: row.email,
  language: (row.language as Language | null) ?? DEFAULT_LANGUAGE,
});

export const getOrCreateForUser = async (
  userId: string,
  defaults: { fullName: string | null; email: string | null },
  exec: DbExecutor = db,
): Promise<Settings> => {
  const existing = await exec
    .select(SETTINGS_PROJECTION)
    .from(settings)
    .where(eq(settings.userId, userId));
  if (existing.length > 0) return mapRow(existing[0]);

  const inserted = await exec
    .insert(settings)
    .values({ userId, fullName: defaults.fullName, email: defaults.email })
    .returning(SETTINGS_PROJECTION);
  return mapRow(inserted[0]);
};

export const upsertForUser = async (
  userId: string,
  patch: { fullName: string | null; email: string | null; language: Language | null },
  exec: DbExecutor = db,
): Promise<Settings> => {
  const result = await exec
    .insert(settings)
    .values({
      userId,
      fullName: patch.fullName,
      email: patch.email,
      language: patch.language ?? DEFAULT_LANGUAGE,
    })
    .onConflictDoUpdate({
      target: settings.userId,
      set: {
        fullName: sql`COALESCE(${patch.fullName}, ${settings.fullName})`,
        email: sql`COALESCE(${patch.email}, ${settings.email})`,
        language: sql`COALESCE(${patch.language}, ${settings.language})`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    })
    .returning(SETTINGS_PROJECTION);
  return mapRow(result[0]);
};
