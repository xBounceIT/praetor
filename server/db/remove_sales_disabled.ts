import { query } from './index.ts';

const migration = `
UPDATE sales SET status = 'cancelled' WHERE is_disabled = TRUE;
ALTER TABLE sales DROP COLUMN IF EXISTS is_disabled;
`;

async function runMigration() {
  try {
    console.log('Running migration to remove sales is_disabled column...');
    await query(migration);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
