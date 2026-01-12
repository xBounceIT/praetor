
import { query } from './index.js';

const migration = `
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS daily_limit DECIMAL(4, 2) DEFAULT 8.00;
`;

async function runMigration() {
    try {
        console.log('Running migration to add daily_limit to general_settings...');
        await query(migration);
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
