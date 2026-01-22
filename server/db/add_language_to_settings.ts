import { query } from './index';

const migration = `
ALTER TABLE settings ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en' CHECK (language IN ('en', 'it'));
`;


export async function migrate() {
  try {
    console.log('Running migration to add language column to settings table...');
    await query(migration, []);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    // Do not exit process here, let the caller handle it or shorter logging
    throw err;
  }
}
