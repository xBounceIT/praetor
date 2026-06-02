import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import { type StoredRilWeekdayTransferDefaults, settings } from '../db/schema/settings.ts';

export const LANGUAGES = ['en', 'it', 'auto'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'auto';

// Lowercase English weekday names used as keys for the per-day default RIL transfer preference.
// Only weekdays are configurable — weekend/holiday RIL rows are never filled in.
export const RIL_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
export type RilWeekday = (typeof RIL_WEEKDAYS)[number];
export type RilWeekdayTransferDefaults = StoredRilWeekdayTransferDefaults;

export type Settings = {
  fullName: string | null;
  email: string | null;
  language: Language;
  rilWeekdayTransferDefaults: RilWeekdayTransferDefaults;
};

const SETTINGS_PROJECTION = {
  fullName: settings.fullName,
  email: settings.email,
  language: settings.language,
  rilWeekdayTransferDefaults: settings.rilWeekdayTransferDefaults,
} as const;

type SettingsRow = {
  fullName: string | null;
  email: string | null;
  language: string | null;
  rilWeekdayTransferDefaults: RilWeekdayTransferDefaults | null;
};

const mapRow = (row: SettingsRow): Settings => ({
  fullName: row.fullName,
  email: row.email,
  language: (row.language as Language | null) ?? DEFAULT_LANGUAGE,
  rilWeekdayTransferDefaults: row.rilWeekdayTransferDefaults ?? {},
});

const findByUserId = async (userId: string, exec: DbExecutor): Promise<Settings | undefined> => {
  const [row] = await exec
    .select(SETTINGS_PROJECTION)
    .from(settings)
    .where(eq(settings.userId, userId));
  return row ? mapRow(row) : undefined;
};

export const getOrCreateForUser = async (
  userId: string,
  defaults: { fullName: string | null; email: string | null },
  exec: DbExecutor = db,
): Promise<Settings> => {
  // Hot path (called on every authenticated /api/settings GET): the row almost always exists,
  // so stay outside a transaction and avoid the BEGIN/COMMIT round-trips runAtomically adds.
  const existing = await findByUserId(userId, exec);
  if (existing) return existing;

  // First-access path: two concurrent calls can both miss the SELECT, so wrap the INSERT and
  // race-loser re-SELECT in a single snapshot.
  return runAtomically(exec, async (tx) => {
    const inserted = await tx
      .insert(settings)
      .values({ userId, fullName: defaults.fullName, email: defaults.email })
      .onConflictDoNothing({ target: settings.userId })
      .returning(SETTINGS_PROJECTION);
    if (inserted[0]) return mapRow(inserted[0]);

    const winner = await findByUserId(userId, tx);
    if (!winner) {
      throw new Error('settingsRepo.getOrCreateForUser: row missing after insert');
    }
    return winner;
  });
};

export const upsertForUser = async (
  userId: string,
  patch: {
    fullName: string | null;
    email: string | null;
    language: Language | null;
    // Optional so the many identity-sync callers (auth/LDAP/SSO) keep working unchanged; when
    // omitted the existing column is preserved via COALESCE.
    rilWeekdayTransferDefaults?: RilWeekdayTransferDefaults | null;
  },
  exec: DbExecutor = db,
): Promise<Settings> => {
  // jsonb COALESCE needs the patch bound as a stringified ::jsonb param (mirrors
  // generalSettingsRepo); a null param leaves the existing row value untouched.
  const rilWeekdayParam =
    patch.rilWeekdayTransferDefaults == null
      ? null
      : JSON.stringify(patch.rilWeekdayTransferDefaults);
  const result = await exec
    .insert(settings)
    .values({
      userId,
      fullName: patch.fullName,
      email: patch.email,
      language: patch.language ?? DEFAULT_LANGUAGE,
      rilWeekdayTransferDefaults: patch.rilWeekdayTransferDefaults ?? {},
    })
    .onConflictDoUpdate({
      target: settings.userId,
      set: {
        fullName: sql`COALESCE(${patch.fullName}, ${settings.fullName})`,
        email: sql`COALESCE(${patch.email}, ${settings.email})`,
        language: sql`COALESCE(${patch.language}, ${settings.language})`,
        rilWeekdayTransferDefaults: sql`COALESCE(${rilWeekdayParam}::jsonb, ${settings.rilWeekdayTransferDefaults})`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    })
    .returning(SETTINGS_PROJECTION);
  return mapRow(result[0]);
};
