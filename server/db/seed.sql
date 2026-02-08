-- Seed data for Praetor

-- Default users (password is 'password' for all, hashed with bcrypt cost 10)
-- To generate: require('bcrypt').hashSync('password', 10)
INSERT INTO users (id, name, username, password_hash, role, avatar_initials) VALUES
    ('u1', 'Admin User', 'admin', '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy', 'admin', 'AD'),
    ('u2', 'Manager User', 'manager', '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy', 'manager', 'MG'),
    ('u3', 'Standard User', 'user', '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy', 'user', 'US')
ON CONFLICT (id) DO NOTHING;

-- Ensure default users have matching rows in user_roles
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, u.role
FROM users u
WHERE u.id IN ('u1', 'u2', 'u3')
ON CONFLICT DO NOTHING;

-- Default clients
INSERT INTO clients (id, name) VALUES
    ('c1', 'Acme Corp'),
    ('c2', 'Global Tech')
ON CONFLICT (id) DO NOTHING;

-- Default projects
INSERT INTO projects (id, name, client_id, color, description) VALUES
    ('p1', 'Website Redesign', 'c1', '#3b82f6', 'Complete overhaul of the main marketing site.'),
    ('p2', 'Mobile App', 'c1', '#10b981', 'Native iOS and Android application development.'),
    ('p3', 'Internal Research', 'c2', '#8b5cf6', 'Ongoing research into new market trends.')
ON CONFLICT (id) DO NOTHING;

-- Default tasks
INSERT INTO tasks (id, name, project_id, description) VALUES
    ('t1', 'Initial Design', 'p1', 'Lo-fi wireframes and moodboards.'),
    ('t2', 'Frontend Dev', 'p1', 'React component implementation.'),
    ('t3', 'API Integration', 'p2', 'Connecting the app to the backend services.'),
    ('t4', 'General Support', 'p3', 'Misc administrative tasks and support.')
ON CONFLICT (id) DO NOTHING;

-- Default settings for each user
INSERT INTO settings (user_id, full_name, email) VALUES
    ('u1', 'Admin User', 'admin@example.com'),
    ('u2', 'Manager User', 'manager@example.com'),
    ('u3', 'Standard User', 'user@example.com')
ON CONFLICT (user_id) DO NOTHING;

-- Default quotes
INSERT INTO quotes (id, quote_code, client_id, client_name, expiration_date, status, discount, payment_terms) VALUES
    ('q1', 'Q9001', 'c1', 'Acme Corp', '2026-12-31', 'sent', 0, '30gg'),
    ('q2', 'Q9002', 'c2', 'Global Tech', '2026-11-30', 'draft', 5, 'immediate')
ON CONFLICT (id) DO NOTHING;
