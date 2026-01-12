
import { query } from './index.js';

const migration = `
-- Add hourly_cost column to time_entries
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hourly_cost DECIMAL(10, 2) DEFAULT 0;

-- Update existing entries with the current cost of the user who created them
UPDATE time_entries 
SET hourly_cost = users.cost_per_hour
FROM users
WHERE time_entries.user_id = users.id AND time_entries.hourly_cost = 0;
`;

async function runMigration() {
    try {
        console.log('Running migration to add hourly_cost column to time_entries...');
        await query(migration);
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
