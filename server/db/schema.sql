-- Tempo Time Tracking Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'user')),
    avatar_initials VARCHAR(5) NOT NULL,
    cost_per_hour DECIMAL(10, 2) DEFAULT 0,
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure cost_per_hour column exists for existing installations
ALTER TABLE users ADD COLUMN IF NOT EXISTS cost_per_hour DECIMAL(10, 2) DEFAULT 0;

-- Ensure is_disabled column exists for existing installations
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure is_disabled column exists for existing installations
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    color VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
    description TEXT,
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure is_disabled column exists for existing installations
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    description TEXT,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_pattern VARCHAR(20) CHECK (recurrence_pattern IN ('daily', 'weekly', 'monthly')),
    recurrence_start DATE,
    recurrence_end DATE,
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure is_disabled column exists for existing installations
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

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

-- Time entries table
CREATE TABLE IF NOT EXISTS time_entries (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    project_name VARCHAR(255) NOT NULL,
    task VARCHAR(255) NOT NULL,
    notes TEXT,
    duration DECIMAL(10, 2) NOT NULL DEFAULT 0,
    hourly_cost DECIMAL(10, 2) DEFAULT 0,
    is_placeholder BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure hourly_cost column exists for existing installations
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hourly_cost DECIMAL(10, 2) DEFAULT 0;

-- User settings table
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    email VARCHAR(255),
    daily_goal DECIMAL(4, 2) DEFAULT 8.00,
    start_of_week VARCHAR(10) DEFAULT 'Monday' CHECK (start_of_week IN ('Monday', 'Sunday')),
    enable_ai_insights BOOLEAN DEFAULT TRUE,
    compact_view BOOLEAN DEFAULT FALSE,
    treat_saturday_as_holiday BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LDAP configuration table (single row)
CREATE TABLE IF NOT EXISTS ldap_config (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled BOOLEAN DEFAULT FALSE,
    server_url VARCHAR(500) DEFAULT 'ldap://ldap.example.com:389',
    base_dn VARCHAR(500) DEFAULT 'dc=example,dc=com',
    bind_dn VARCHAR(500) DEFAULT 'cn=read-only-admin,dc=example,dc=com',
    bind_password VARCHAR(255) DEFAULT '',
    user_filter VARCHAR(255) DEFAULT '(uid={0})',
    group_base_dn VARCHAR(500) DEFAULT 'ou=groups,dc=example,dc=com',
    group_filter VARCHAR(255) DEFAULT '(member={0})',
    role_mappings JSONB DEFAULT '[]',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- General settings table (single row)
CREATE TABLE IF NOT EXISTS general_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    currency VARCHAR(10) DEFAULT 'USD',
    daily_limit DECIMAL(4, 2) DEFAULT 8.00,
    start_of_week VARCHAR(10) DEFAULT 'Monday' CHECK (start_of_week IN ('Monday', 'Sunday')),
    treat_saturday_as_holiday BOOLEAN DEFAULT TRUE,
    enable_ai_insights BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure columns exist for existing installations
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS daily_limit DECIMAL(4, 2) DEFAULT 8.00;
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS start_of_week VARCHAR(10) DEFAULT 'Monday';
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS treat_saturday_as_holiday BOOLEAN DEFAULT TRUE;
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS enable_ai_insights BOOLEAN DEFAULT TRUE;

-- Insert default general settings room
INSERT INTO general_settings (id, currency) VALUES (1, 'USD') ON CONFLICT (id) DO NOTHING;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);
CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);

-- Insert default LDAP config row
INSERT INTO ldap_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
