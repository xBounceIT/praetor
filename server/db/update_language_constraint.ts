import { query } from './index.ts';

const migration = `
DO $$
BEGIN
    ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_language_check;
    ALTER TABLE settings ADD CONSTRAINT settings_language_check CHECK (language IN ('en', 'it', 'auto'));
    ALTER TABLE settings ALTER COLUMN language SET DEFAULT 'auto';
END $$;
`;

export async function migrate() {
  try {
    console.log('Running migration to update language constraint in settings table...');
    await query(migration, []);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  }
}
