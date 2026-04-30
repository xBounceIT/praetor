import { query } from './index.ts';

const migration = `
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS task_id VARCHAR(50) REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON time_entries(task_id);

UPDATE time_entries te
   SET task_id = sub.id
  FROM (
    SELECT DISTINCT ON (project_id, name) project_id, name, id
      FROM tasks
     ORDER BY project_id, name, id
  ) sub
 WHERE te.task_id IS NULL
   AND te.project_id = sub.project_id
   AND te.task = sub.name;
`;

async function runMigration() {
  try {
    console.log('Running migration to add task_id to time_entries...');
    await query(migration);
    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
