
import { query } from './index.js';

const migration = `
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_duration NUMERIC DEFAULT 0;
`;

async function runMigration() {
    try {
        console.log('Running migration to add recurrence_duration column...');
        await query(migration);
        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
