import { query } from './index.ts';

const migration = `
-- Add location column to time_entries
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS location VARCHAR(20) DEFAULT 'remote' CHECK (location IN ('remote', 'office', 'client'));

-- Update existing entries with default location
UPDATE time_entries 
SET location = 'remote'
WHERE location IS NULL;
`;

async function runMigration() {
  try {
    console.log('Running migration to add location column to time_entries...');
    await query(migration);
    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
