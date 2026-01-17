
import { query } from './index.js';

const migration = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;
`;

async function runMigration() {
    try {
        console.log('Running migration to add is_disabled column...');
        await query(migration);
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
