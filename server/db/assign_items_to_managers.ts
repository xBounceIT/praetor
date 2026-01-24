import { query } from './index.ts';

/**
 * Migration to assign all existing clients, projects, and tasks to all manager users.
 * This ensures managers have the same visibility in assignment modals as they do in data views.
 */
const migrationSql = `
-- Assign all existing clients to all manager users
INSERT INTO user_clients (user_id, client_id)
SELECT u.id, c.id
FROM users u
CROSS JOIN clients c
WHERE u.role = 'manager'
ON CONFLICT (user_id, client_id) DO NOTHING;

-- Assign all existing projects to all manager users
INSERT INTO user_projects (user_id, project_id)
SELECT u.id, p.id
FROM users u
CROSS JOIN projects p
WHERE u.role = 'manager'
ON CONFLICT (user_id, project_id) DO NOTHING;

-- Assign all existing tasks to all manager users
INSERT INTO user_tasks (user_id, task_id)
SELECT u.id, t.id
FROM users u
CROSS JOIN tasks t
WHERE u.role = 'manager'
ON CONFLICT (user_id, task_id) DO NOTHING;
`;

export async function migrate(): Promise<void> {
  try {
    console.log('Running migration to assign all items to manager users...');
    await query(migrationSql);
    console.log('Manager assignments migration completed.');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err; // Re-throw the error so the caller can handle it
  }
}
