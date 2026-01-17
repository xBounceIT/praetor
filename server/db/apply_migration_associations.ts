
import { query } from './index.js';

const migration = `
-- User-Client associations
CREATE TABLE IF NOT EXISTS user_clients (
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    client_id VARCHAR(50) REFERENCES clients(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, client_id)
);

-- User-Project associations
CREATE TABLE IF NOT EXISTS user_projects (
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    project_id VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, project_id)
);

-- User-Task associations
CREATE TABLE IF NOT EXISTS user_tasks (
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    task_id VARCHAR(50) REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, task_id)
);
`;

async function runMigration() {
    try {
        console.log('Running migration...');
        await query(migration);
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    }
}

runMigration();
