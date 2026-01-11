import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import clientsRoutes from './routes/clients.js';
import projectsRoutes from './routes/projects.js';
import tasksRoutes from './routes/tasks.js';
import entriesRoutes from './routes/entries.js';
import settingsRoutes from './routes/settings.js';
import ldapRoutes from './routes/ldap.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/entries', entriesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/ldap', ldapRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, async () => {
  try {
    // Run automatic migration on startup
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');

    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      // Import query from db module dynamically to ensure it's loaded
      const { query } = await import('./db/index.js');
      await query(schemaSql);

      // Explicitly verify that the new tables exist
      const tableCheck = await query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN ('user_clients', 'user_projects', 'user_tasks')
      `);

      const foundTables = tableCheck.rows.map(r => r.table_name);
      console.log(`Database schema verified. Found tables: ${foundTables.join(', ')}`);

      if (!foundTables.includes('user_clients')) {
        console.error('CRITICAL: user_clients table was not created!');
      }
    } else {
      console.warn('Schema file not found at:', schemaPath);
    }
  } catch (err) {
    console.error('Failed to run auto-migration:', err);
  }

  console.log(`Tempo API server running on port ${PORT}`);
});

export default app;
