import pool, { type QueryExecutor } from '../db/index.ts';

export const LANGUAGES = ['en', 'it', 'auto'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'auto';

export type Settings = {
  fullName: string | null;
  email: string | null;
  language: Language;
};

type SettingsRow = {
  fullName: string | null;
  email: string | null;
  language: Language | null;
};

const SELECT_COLUMNS = `full_name as "fullName", email, language`;

const mapRow = (row: SettingsRow): Settings => ({
  fullName: row.fullName,
  email: row.email,
  language: row.language ?? DEFAULT_LANGUAGE,
});

export const getOrCreateForUser = async (
  userId: string,
  defaults: { fullName: string | null; email: string | null },
  exec: QueryExecutor = pool,
): Promise<Settings> => {
  const existing = await exec.query<SettingsRow>(
    `SELECT ${SELECT_COLUMNS} FROM settings WHERE user_id = $1`,
    [userId],
  );
  if (existing.rows.length > 0) return mapRow(existing.rows[0]);

  const inserted = await exec.query<SettingsRow>(
    `INSERT INTO settings (user_id, full_name, email)
     VALUES ($1, $2, $3)
     RETURNING ${SELECT_COLUMNS}`,
    [userId, defaults.fullName, defaults.email],
  );
  return mapRow(inserted.rows[0]);
};

export const upsertForUser = async (
  userId: string,
  patch: { fullName: string | null; email: string | null; language: Language | null },
  exec: QueryExecutor = pool,
): Promise<Settings> => {
  const { rows } = await exec.query<SettingsRow>(
    `INSERT INTO settings (user_id, full_name, email, language)
     VALUES ($1, $2, $3, COALESCE($4, $5))
     ON CONFLICT (user_id) DO UPDATE SET
       full_name = COALESCE($2, settings.full_name),
       email = COALESCE($3, settings.email),
       language = COALESCE($4, settings.language),
       updated_at = CURRENT_TIMESTAMP
     RETURNING ${SELECT_COLUMNS}`,
    [userId, patch.fullName, patch.email, patch.language, DEFAULT_LANGUAGE],
  );
  return mapRow(rows[0]);
};
