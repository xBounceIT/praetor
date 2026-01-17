
import { query } from './index.js';

const migration = `
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS daily_limit DECIMAL(4, 2) DEFAULT 8.00;
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS start_of_week VARCHAR(10) DEFAULT 'Monday';
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS treat_saturday_as_holiday BOOLEAN DEFAULT TRUE;
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS enable_ai_insights BOOLEAN DEFAULT FALSE;
`;

async function runMigration() {
    try {
        console.log('Running migration to add global settings to general_settings...');
        await query(migration);
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
