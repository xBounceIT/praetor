-- Praetor Database Schema

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_system BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO roles (id, name, is_system, is_admin)
VALUES
    ('admin', 'Admin', TRUE, TRUE),
    ('top_manager', 'Top Manager', TRUE, FALSE),
    ('manager', 'Manager', TRUE, FALSE),
    ('user', 'User', TRUE, FALSE)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id VARCHAR(50) REFERENCES roles(id) ON DELETE CASCADE,
    permission VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission)
);

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM role_permissions) = 0 THEN
        INSERT INTO role_permissions (role_id, permission) VALUES
            ('manager', 'timesheets.tracker.view'),
            ('manager', 'timesheets.tracker.create'),
            ('manager', 'timesheets.tracker.update'),
            ('manager', 'timesheets.tracker.delete'),
            ('manager', 'timesheets.recurring.view'),
            ('manager', 'timesheets.recurring.create'),
            ('manager', 'timesheets.recurring.update'),
            ('manager', 'timesheets.recurring.delete'),
            ('manager', 'crm.clients.view'),
            ('manager', 'crm.clients.create'),
            ('manager', 'crm.clients.update'),
            ('manager', 'crm.clients.delete'),
            ('manager', 'crm.suppliers.view'),
            ('manager', 'crm.suppliers.create'),
            ('manager', 'crm.suppliers.update'),
            ('manager', 'crm.suppliers.delete'),
            ('manager', 'crm.suppliers_all.view'),
            ('manager', 'sales.client_quotes.view'),
            ('manager', 'sales.client_quotes.create'),
            ('manager', 'sales.client_quotes.update'),
            ('manager', 'sales.client_quotes.delete'),
            ('manager', 'catalog.internal_listing.view'),
            ('manager', 'catalog.internal_listing.create'),
            ('manager', 'catalog.internal_listing.update'),
            ('manager', 'catalog.internal_listing.delete'),
            ('manager', 'accounting.clients_orders.view'),
            ('manager', 'accounting.clients_orders.create'),
            ('manager', 'accounting.clients_orders.update'),
            ('manager', 'accounting.clients_orders.delete'),
            ('manager', 'accounting.clients_invoices.view'),
            ('manager', 'accounting.clients_invoices.create'),
            ('manager', 'accounting.clients_invoices.update'),
            ('manager', 'accounting.clients_invoices.delete'),
            ('manager', 'projects.manage.view'),
            ('manager', 'projects.manage.create'),
            ('manager', 'projects.manage.update'),
            ('manager', 'projects.manage.delete'),
            ('manager', 'projects.manage_all.view'),
            ('manager', 'projects.tasks.view'),
            ('manager', 'projects.tasks.create'),
            ('manager', 'projects.tasks.update'),
            ('manager', 'projects.tasks.delete'),
            ('manager', 'projects.tasks_all.view'),
            ('manager', 'suppliers.quotes.view'),
            ('manager', 'suppliers.quotes.create'),
            ('manager', 'suppliers.quotes.update'),
            ('manager', 'suppliers.quotes.delete'),
            ('manager', 'hr.internal.view'),
            ('manager', 'hr.internal.create'),
            ('manager', 'hr.internal.update'),
            ('manager', 'hr.internal.delete'),
            ('manager', 'hr.external.view'),
            ('manager', 'hr.external.create'),
            ('manager', 'hr.external.update'),
            ('manager', 'hr.external.delete'),
            ('manager', 'settings.view'),
            ('manager', 'settings.update'),
            ('manager', 'docs.api.view'),
            ('manager', 'docs.frontend.view'),
            ('manager', 'notifications.view'),
            ('manager', 'notifications.update'),
            ('manager', 'notifications.delete'),
            ('user', 'timesheets.tracker.view'),
            ('user', 'timesheets.tracker.create'),
            ('user', 'timesheets.tracker.update'),
            ('user', 'timesheets.tracker.delete'),
            ('user', 'timesheets.recurring.view'),
            ('user', 'timesheets.recurring.create'),
            ('user', 'timesheets.recurring.update'),
            ('user', 'timesheets.recurring.delete'),
            ('user', 'projects.manage.view'),
            ('user', 'projects.tasks.view'),
            ('user', 'settings.view'),
            ('user', 'settings.update'),
            ('user', 'docs.api.view'),
            ('user', 'docs.frontend.view'),
            ('user', 'notifications.view'),
            ('user', 'notifications.update'),
            ('user', 'notifications.delete');
    END IF;
END $$;

-- Seed workflow permissions for manager role and migrate supplier quote permissions

ALTER TABLE IF EXISTS quote_items DROP COLUMN IF EXISTS special_bid_id;
ALTER TABLE IF EXISTS quote_items DROP COLUMN IF EXISTS special_bid_unit_price;
ALTER TABLE IF EXISTS quote_items DROP COLUMN IF EXISTS special_bid_mol_percentage;
ALTER TABLE IF EXISTS customer_offer_items DROP COLUMN IF EXISTS special_bid_id;
ALTER TABLE IF EXISTS customer_offer_items DROP COLUMN IF EXISTS special_bid_unit_price;
ALTER TABLE IF EXISTS customer_offer_items DROP COLUMN IF EXISTS special_bid_mol_percentage;
ALTER TABLE IF EXISTS sale_items DROP COLUMN IF EXISTS special_bid_id;
ALTER TABLE IF EXISTS sale_items DROP COLUMN IF EXISTS special_bid_unit_price;
ALTER TABLE IF EXISTS sale_items DROP COLUMN IF EXISTS special_bid_mol_percentage;
ALTER TABLE IF EXISTS invoice_items DROP COLUMN IF EXISTS special_bid_id;
DROP TABLE IF EXISTS special_bids;
INSERT INTO role_permissions (role_id, permission)
VALUES
    ('manager', 'sales.client_offers.view'),
    ('manager', 'sales.client_offers.create'),
    ('manager', 'sales.client_offers.update'),
    ('manager', 'sales.client_offers.delete'),
    ('manager', 'sales.supplier_quotes.view'),
    ('manager', 'sales.supplier_quotes.create'),
    ('manager', 'sales.supplier_quotes.update'),
    ('manager', 'sales.supplier_quotes.delete'),
    ('manager', 'accounting.supplier_orders.view'),
    ('manager', 'accounting.supplier_orders.create'),
    ('manager', 'accounting.supplier_orders.update'),
    ('manager', 'accounting.supplier_orders.delete'),
    ('manager', 'accounting.supplier_invoices.view'),
    ('manager', 'accounting.supplier_invoices.create'),
    ('manager', 'accounting.supplier_invoices.update'),
    ('manager', 'accounting.supplier_invoices.delete')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT role_id, REPLACE(permission, 'suppliers.quotes', 'sales.supplier_quotes')
FROM role_permissions
WHERE permission LIKE 'suppliers.quotes.%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT role_id, permission
FROM (
    SELECT role_id, 'sales.supplier_quotes.view' AS permission
    FROM role_permissions
    WHERE permission LIKE 'sales.supplier_offers.%'
    UNION
    SELECT role_id, 'accounting.supplier_orders.view' AS permission
    FROM role_permissions
    WHERE permission LIKE 'sales.supplier_offers.%'
    UNION
    SELECT role_id, 'accounting.supplier_orders.create' AS permission
    FROM role_permissions
    WHERE permission = 'sales.supplier_offers.create'
    UNION
    SELECT role_id, 'accounting.supplier_orders.update' AS permission
    FROM role_permissions
    WHERE permission = 'sales.supplier_offers.update'
    UNION
    SELECT role_id, 'accounting.supplier_orders.delete' AS permission
    FROM role_permissions
    WHERE permission = 'sales.supplier_offers.delete'
) remapped_permissions
ON CONFLICT DO NOTHING;

DELETE FROM role_permissions
WHERE permission IN (
    'sales.supplier_offers.view',
    'sales.supplier_offers.create',
    'sales.supplier_offers.update',
    'sales.supplier_offers.delete'
);

-- Migration: Remove previously-seeded admin permissions so admin only has
-- Administration access (from is_admin flag). Other modules must be added
-- explicitly via the permissions UI.
DELETE FROM role_permissions WHERE role_id = 'admin';

-- Migration: Enforce admin-only access to Administration permissions.
-- Remove any administration/configuration permissions from non-admin roles.
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND r.is_admin = FALSE
  AND (
    rp.permission LIKE 'administration.%'
    OR rp.permission LIKE 'configuration.%'
  );

-- Migration: Remove deprecated Finances module permissions.
DELETE FROM role_permissions WHERE permission LIKE 'finances.%';

-- Migration: Manager is scoped to assigned clients, projects, and tasks.
DELETE FROM role_permissions
WHERE role_id = 'manager'
  AND permission IN (
    'crm.clients_all.view',
    'projects.manage_all.view',
    'projects.tasks_all.view'
  );

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL REFERENCES roles(id),
    avatar_initials VARCHAR(5) NOT NULL,
    cost_per_hour DECIMAL(10, 2) DEFAULT 0,
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User roles table (Many-to-Many)
-- users.role remains the primary/default role, while user_roles stores all assigned roles.
CREATE TABLE IF NOT EXISTS user_roles (
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    role_id VARCHAR(50) REFERENCES roles(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);

-- Backfill: ensure every user has at least their primary role in user_roles.
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, u.role
FROM users u
ON CONFLICT DO NOTHING;

-- Ensure cost_per_hour column exists for existing installations
ALTER TABLE users ADD COLUMN IF NOT EXISTS cost_per_hour DECIMAL(10, 2) DEFAULT 0;

-- Ensure is_disabled column exists for existing installations
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

-- Employee type column (app_user = can login, internal/external = no login)
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_type VARCHAR(20) DEFAULT 'app_user';

-- Expand role column length for existing installations
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(50);

-- Add check constraint for employee_type (safe for existing installations)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_employee_type_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_employee_type_check
            CHECK (employee_type IN ('app_user', 'internal', 'external'));
    END IF;
END $$;

-- Drop legacy role check constraint if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
    END IF;
END $$;

-- Ensure foreign key exists for users.role
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_role_fkey'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_role_fkey FOREIGN KEY (role) REFERENCES roles(id) ON UPDATE CASCADE;
    END IF;
END $$;


-- Audit logs table (system access and operation tracking)
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL DEFAULT 'user.login',
    entity_type VARCHAR(50),
    entity_id VARCHAR(100),
    ip_address VARCHAR(255) NOT NULL,
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Work Units table
CREATE TABLE IF NOT EXISTS work_units (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure is_disabled column exists for existing installations
ALTER TABLE work_units ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

-- Work Unit Managers table (Many-to-Many)
CREATE TABLE IF NOT EXISTS work_unit_managers (
    work_unit_id VARCHAR(50) REFERENCES work_units(id) ON DELETE CASCADE,
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (work_unit_id, user_id)
);

-- Migration: Move existing managers to junction table and drop column
DO $$
BEGIN
    -- Check if manager_id column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_units' AND column_name='manager_id') THEN
        -- Migrate data
        INSERT INTO work_unit_managers (work_unit_id, user_id)
        SELECT id, manager_id FROM work_units WHERE manager_id IS NOT NULL
        ON CONFLICT DO NOTHING;

        -- Drop the column constraint first if strictly needed, though dropping column usually handles it.
        -- We just drop the column.
        ALTER TABLE work_units DROP COLUMN manager_id;
    END IF;
END $$;

-- User-Work Unit associations
CREATE TABLE IF NOT EXISTS user_work_units (
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    work_unit_id VARCHAR(50) REFERENCES work_units(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, work_unit_id)
);

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure is_disabled column exists for existing installations
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

-- Ensure new client details columns exist (Migration for Clients Improvements)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'company';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_code VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ateco_code VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sector VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS number_of_employees VARCHAR(20);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS revenue VARCHAR(20);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS fiscal_code VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS office_count_range VARCHAR(10);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contacts JSONB DEFAULT '[]'::jsonb;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_country VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_state VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_cap VARCHAR(20);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_province VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_civic_number VARCHAR(30);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_line TEXT;
ALTER TABLE clients ALTER COLUMN sector TYPE VARCHAR(120);
ALTER TABLE clients ALTER COLUMN number_of_employees TYPE VARCHAR(120);
ALTER TABLE clients ALTER COLUMN revenue TYPE VARCHAR(120);
ALTER TABLE clients ALTER COLUMN office_count_range TYPE VARCHAR(120);
-- Ensure office count range is limited to supported values
ALTER TABLE clients DROP CONSTRAINT IF EXISTS chk_clients_office_count_range;

-- Ensure sector is limited to supported values
ALTER TABLE clients DROP CONSTRAINT IF EXISTS chk_clients_sector;

-- Ensure number of employees range is limited to supported values
ALTER TABLE clients DROP CONSTRAINT IF EXISTS chk_clients_number_of_employees;

-- Ensure revenue range is limited to supported values
ALTER TABLE clients DROP CONSTRAINT IF EXISTS chk_clients_revenue;

-- Ensure fiscal code is unique (case-insensitive, non-empty)
DROP INDEX IF EXISTS idx_clients_vat_number_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_fiscal_code_unique
    ON clients (LOWER(fiscal_code))
    WHERE fiscal_code IS NOT NULL AND fiscal_code <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_client_code_unique
    ON clients (client_code)
    WHERE client_code IS NOT NULL AND client_code <> '';

CREATE TABLE IF NOT EXISTS client_profile_options (
    id VARCHAR(50) PRIMARY KEY,
    category VARCHAR(50) NOT NULL CHECK (category IN ('sector', 'numberOfEmployees', 'revenue', 'officeCountRange')),
    value VARCHAR(120) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_profile_options_category_value_unique
    ON client_profile_options (category, LOWER(value));

CREATE INDEX IF NOT EXISTS idx_client_profile_options_category_sort
    ON client_profile_options (category, sort_order, value);

INSERT INTO client_profile_options (id, category, value, sort_order)
VALUES
    ('cpo-sector-finance', 'sector', 'FINANCE', 1),
    ('cpo-sector-telco', 'sector', 'TELCO', 2),
    ('cpo-sector-utilities', 'sector', 'UTILITIES', 3),
    ('cpo-sector-energy', 'sector', 'ENERGY', 4),
    ('cpo-sector-services', 'sector', 'SERVICES', 5),
    ('cpo-sector-gdo', 'sector', 'GDO', 6),
    ('cpo-sector-health', 'sector', 'HEALTH', 7),
    ('cpo-sector-industry', 'sector', 'INDUSTRY', 8),
    ('cpo-sector-pa', 'sector', 'PA', 9),
    ('cpo-sector-trasporti', 'sector', 'TRASPORTI', 10),
    ('cpo-sector-altro', 'sector', 'ALTRO', 11),
    ('cpo-employees-under50', 'numberOfEmployees', '< 50', 1),
    ('cpo-employees-50-250', 'numberOfEmployees', '50..250', 2),
    ('cpo-employees-251-1000', 'numberOfEmployees', '251..1000', 3),
    ('cpo-employees-over1000', 'numberOfEmployees', '> 1000', 4),
    ('cpo-revenue-under10', 'revenue', '< 10', 1),
    ('cpo-revenue-11-50', 'revenue', '11..50', 2),
    ('cpo-revenue-51-1000', 'revenue', '51..1000', 3),
    ('cpo-revenue-over1000', 'revenue', '> 1000', 4),
    ('cpo-office-1', 'officeCountRange', '1', 1),
    ('cpo-office-2-5', 'officeCountRange', '2...5', 2),
    ('cpo-office-6-10', 'officeCountRange', '6...10', 3),
    ('cpo-office-over10', 'officeCountRange', '>10', 4)
ON CONFLICT DO NOTHING;

INSERT INTO client_profile_options (id, category, value, sort_order)
SELECT 'cpo-s-' || gen_random_uuid(), 'sector', sector, 1000 + ROW_NUMBER() OVER (ORDER BY sector)
FROM (
    SELECT DISTINCT sector
    FROM clients
    WHERE sector IS NOT NULL AND BTRIM(sector) <> ''
) existing_sector_values
ON CONFLICT DO NOTHING;

INSERT INTO client_profile_options (id, category, value, sort_order)
SELECT 'cpo-ne-' || gen_random_uuid(), 'numberOfEmployees', number_of_employees,
       1000 + ROW_NUMBER() OVER (ORDER BY number_of_employees)
FROM (
    SELECT DISTINCT number_of_employees
    FROM clients
    WHERE number_of_employees IS NOT NULL AND BTRIM(number_of_employees) <> ''
) existing_number_of_employees_values
ON CONFLICT DO NOTHING;

INSERT INTO client_profile_options (id, category, value, sort_order)
SELECT 'cpo-r-' || gen_random_uuid(), 'revenue', revenue,
       1000 + ROW_NUMBER() OVER (ORDER BY revenue)
FROM (
    SELECT DISTINCT revenue
    FROM clients
    WHERE revenue IS NOT NULL AND BTRIM(revenue) <> ''
) existing_revenue_values
ON CONFLICT DO NOTHING;

INSERT INTO client_profile_options (id, category, value, sort_order)
SELECT 'cpo-oc-' || gen_random_uuid(), 'officeCountRange', office_count_range,
       1000 + ROW_NUMBER() OVER (ORDER BY office_count_range)
FROM (
    SELECT DISTINCT office_count_range
    FROM clients
    WHERE office_count_range IS NOT NULL AND BTRIM(office_count_range) <> ''
) existing_office_count_values
ON CONFLICT DO NOTHING;

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
    recurrence_pattern VARCHAR(50),
    recurrence_start DATE,
    recurrence_end DATE,
    recurrence_duration DECIMAL(10, 2) DEFAULT 0,
    expected_effort DECIMAL(10, 2) DEFAULT 0,
    revenue DECIMAL(15, 2) DEFAULT 0,
    notes TEXT,
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Safe migration for existing installations to allow custom patterns
DO $$
BEGIN
    -- Drop the check constraint if it exists (default name usually tasks_recurrence_pattern_check)
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tasks_recurrence_pattern_check'
    ) THEN
        ALTER TABLE tasks DROP CONSTRAINT tasks_recurrence_pattern_check;
    END IF;
END $$;

-- Ensure is_disabled column exists for existing installations
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

-- Ensure recurrence_duration column exists for existing installations
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_duration DECIMAL(10, 2) DEFAULT 0;

-- User-Client associations
CREATE TABLE IF NOT EXISTS user_clients (
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    client_id VARCHAR(50) REFERENCES clients(id) ON DELETE CASCADE,
    assignment_source VARCHAR(20) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, client_id)
);

ALTER TABLE user_clients ADD COLUMN IF NOT EXISTS assignment_source VARCHAR(20) DEFAULT 'manual';
UPDATE user_clients SET assignment_source = 'manual' WHERE assignment_source IS NULL;
ALTER TABLE user_clients ALTER COLUMN assignment_source SET NOT NULL;
DO $$
BEGIN
    ALTER TABLE user_clients DROP CONSTRAINT IF EXISTS user_clients_assignment_source_check;
    ALTER TABLE user_clients ADD CONSTRAINT user_clients_assignment_source_check
        CHECK (assignment_source IN ('manual', 'top_manager_auto', 'project_cascade'));
END $$;

-- User-Project associations
CREATE TABLE IF NOT EXISTS user_projects (
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    project_id VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
    assignment_source VARCHAR(20) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, project_id)
);

ALTER TABLE user_projects ADD COLUMN IF NOT EXISTS assignment_source VARCHAR(20) DEFAULT 'manual';
UPDATE user_projects SET assignment_source = 'manual' WHERE assignment_source IS NULL;
ALTER TABLE user_projects ALTER COLUMN assignment_source SET NOT NULL;
DO $$
BEGIN
    ALTER TABLE user_projects DROP CONSTRAINT IF EXISTS user_projects_assignment_source_check;
    ALTER TABLE user_projects ADD CONSTRAINT user_projects_assignment_source_check
        CHECK (assignment_source IN ('manual', 'top_manager_auto', 'project_cascade'));
END $$;

-- User-Task associations
CREATE TABLE IF NOT EXISTS user_tasks (
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    task_id VARCHAR(50) REFERENCES tasks(id) ON DELETE CASCADE,
    assignment_source VARCHAR(20) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, task_id)
);

ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS assignment_source VARCHAR(20) DEFAULT 'manual';
UPDATE user_tasks SET assignment_source = 'manual' WHERE assignment_source IS NULL;
ALTER TABLE user_tasks ALTER COLUMN assignment_source SET NOT NULL;
DO $$
BEGIN
    ALTER TABLE user_tasks DROP CONSTRAINT IF EXISTS user_tasks_assignment_source_check;
    ALTER TABLE user_tasks ADD CONSTRAINT user_tasks_assignment_source_check
        CHECK (assignment_source IN ('manual', 'top_manager_auto', 'project_cascade'));
END $$;

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

-- Ensure location column exists for existing installations
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS location VARCHAR(20) DEFAULT 'remote';

-- Location field migration: update constraint for new values
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_location_check') THEN
        ALTER TABLE time_entries DROP CONSTRAINT time_entries_location_check;
    END IF;
END $$;

ALTER TABLE time_entries ADD CONSTRAINT time_entries_location_check
    CHECK (location IN ('remote', 'office', 'customer_premise', 'transfer'));

-- Migrate old 'client' values to 'customer_premise'
UPDATE time_entries SET location = 'customer_premise' WHERE location = 'client';

-- User settings table
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    email VARCHAR(255),
    language VARCHAR(10) DEFAULT 'auto' NOT NULL CHECK (language IN ('en', 'it', 'auto')),
    daily_goal DECIMAL(4, 2) DEFAULT 8.00,
    start_of_week VARCHAR(10) DEFAULT 'Monday' CHECK (start_of_week IN ('Monday', 'Sunday')),
    compact_view BOOLEAN DEFAULT FALSE,
    treat_saturday_as_holiday BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE settings ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'auto';

DO $$
BEGIN
    UPDATE settings SET language = 'auto' WHERE language IS NULL;
    ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_language_check;
    ALTER TABLE settings ADD CONSTRAINT settings_language_check
        CHECK (language IN ('en', 'it', 'auto'));
    ALTER TABLE settings ALTER COLUMN language SET DEFAULT 'auto';
    ALTER TABLE settings ALTER COLUMN language SET NOT NULL;
END $$;

-- LDAP administration table (single row)
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
    currency VARCHAR(10) DEFAULT '€',
    daily_limit DECIMAL(4, 2) DEFAULT 8.00,
    start_of_week VARCHAR(10) DEFAULT 'Monday' CHECK (start_of_week IN ('Monday', 'Sunday')),
    treat_saturday_as_holiday BOOLEAN DEFAULT TRUE,
    enable_ai_reporting BOOLEAN DEFAULT FALSE,
    allow_weekend_selection BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure columns exist for existing installations
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS daily_limit DECIMAL(4, 2) DEFAULT 8.00;
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS start_of_week VARCHAR(10) DEFAULT 'Monday';
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS treat_saturday_as_holiday BOOLEAN DEFAULT TRUE;
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS enable_ai_reporting BOOLEAN DEFAULT FALSE;
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS allow_weekend_selection BOOLEAN DEFAULT TRUE;

-- Migration: Remove deprecated AI features (AI Coach + Smart Entry)
ALTER TABLE general_settings DROP COLUMN IF EXISTS enable_ai_insights;
ALTER TABLE general_settings DROP COLUMN IF EXISTS enable_ai_smart_entry;
ALTER TABLE settings DROP COLUMN IF EXISTS enable_ai_insights;

-- Insert default general settings room
INSERT INTO general_settings (id, currency) VALUES (1, '€') ON CONFLICT (id) DO NOTHING;

-- Migration: Update existing 'USD' currency to '$'
UPDATE general_settings SET currency = '$' WHERE currency = 'USD';

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);
CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);

-- Insert default LDAP config row
INSERT INTO ldap_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Suppliers table (must be created before products due to FK reference)
CREATE TABLE IF NOT EXISTS suppliers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_disabled BOOLEAN DEFAULT FALSE,
    supplier_code VARCHAR(50),
    contact_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    vat_number VARCHAR(50),
    tax_code VARCHAR(50),
    payment_terms TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_number VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_code VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

-- Products table
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    product_code VARCHAR(50) UNIQUE NOT NULL,
    costo DECIMAL(15, 2) NOT NULL DEFAULT 0,
    mol_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    cost_unit VARCHAR(20) NOT NULL DEFAULT 'unit',
    category VARCHAR(100),
    type VARCHAR(20) NOT NULL DEFAULT 'item',
    description TEXT,
    subcategory VARCHAR(100),
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure type column exists for existing installations
ALTER TABLE products ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'item';
-- Update default to supply for new products if we changed the code, but schema standard stays generic string often.
-- But let's reflect the description/subcategory existence:
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100);

-- Ensure product_code column exists for existing installations
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_code VARCHAR(50);

-- Ensure supplier_id column exists for existing installations
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id VARCHAR(50) REFERENCES suppliers(id) ON DELETE SET NULL;

-- Migration: Add mol_percentage column and migrate from sale_price/cost
ALTER TABLE products ADD COLUMN IF NOT EXISTS mol_percentage DECIMAL(5, 2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS costo DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE products DROP COLUMN IF EXISTS tax_rate;

-- Migrate existing data: copy cost to costo, calculate mol_percentage from sale_price
DO $$
BEGIN
    -- Copy cost to costo if cost column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='cost') THEN
        UPDATE products SET costo = cost WHERE costo = 0 OR costo IS NULL;
    END IF;

    -- Calculate mol_percentage from sale_price if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='sale_price') THEN
        UPDATE products
        SET mol_percentage = CASE
            WHEN sale_price > 0 THEN ROUND((1 - (costo / sale_price)) * 100, 2)
            ELSE 0
        END
        WHERE mol_percentage = 0 OR mol_percentage IS NULL;
    END IF;
END $$;

-- Drop old columns after migration
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='sale_price') THEN
        ALTER TABLE products DROP COLUMN sale_price;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='sale_unit') THEN
        ALTER TABLE products DROP COLUMN sale_unit;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='cost') THEN
        ALTER TABLE products DROP COLUMN cost;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_unique ON products(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_product_code_unique ON products(product_code);
CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);

-- Migration: Ensure costo uses DECIMAL(15, 2)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products'
          AND column_name = 'costo' AND numeric_scale != 2
    ) THEN
        ALTER TABLE products ALTER COLUMN costo TYPE DECIMAL(15, 2);
    END IF;
END $$;

-- Quotes table
CREATE TABLE IF NOT EXISTS quotes (
    id VARCHAR(100) PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    payment_terms VARCHAR(20) NOT NULL DEFAULT 'immediate',
    discount DECIMAL(5, 2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('quoted', 'confirmed', 'draft', 'sent', 'accepted', 'denied')),
    expiration_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quotes_client_id ON quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at);

-- Migration: Update quotes status check constraint to allow new statuses
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'quotes_status_check'
    ) THEN
        ALTER TABLE quotes DROP CONSTRAINT quotes_status_check;
        ALTER TABLE quotes ADD CONSTRAINT quotes_status_check CHECK (status IN ('quoted', 'confirmed', 'draft', 'sent', 'accepted', 'denied'));
    END IF;
END $$;

-- Quote items table
CREATE TABLE IF NOT EXISTS quote_items (
    id VARCHAR(50) PRIMARY KEY,
    quote_id VARCHAR(100) NOT NULL REFERENCES quotes(id) ON DELETE CASCADE ON UPDATE CASCADE,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    product_cost DECIMAL(15, 2) NOT NULL DEFAULT 0,
    product_mol_percentage DECIMAL(5, 2),
    discount DECIMAL(5, 2) DEFAULT 0,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS product_cost DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS product_mol_percentage DECIMAL(5, 2);
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS note TEXT;
-- Supplier quote source tracking columns
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS supplier_quote_id VARCHAR(100);
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS supplier_quote_item_id VARCHAR(50);
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS supplier_quote_supplier_name VARCHAR(255);
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS supplier_quote_unit_price DECIMAL(15, 2);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'quote_items'
          AND column_name = 'product_tax_rate'
    ) THEN
        UPDATE quote_items
        SET unit_price = ROUND(unit_price * (1 + COALESCE(product_tax_rate, 0) / 100.0), 2);
    END IF;
END $$;
ALTER TABLE quote_items DROP COLUMN IF EXISTS product_tax_rate;
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS unit_type VARCHAR(10) DEFAULT 'hours';

CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id ON quote_items(quote_id);

-- Migration: Ensure quote_items prices use DECIMAL(15, 2)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'quote_items'
          AND column_name IN ('unit_price', 'product_cost', 'supplier_quote_unit_price')
          AND numeric_scale != 2
    ) THEN
        ALTER TABLE quote_items ALTER COLUMN unit_price TYPE DECIMAL(15, 2);
        ALTER TABLE quote_items ALTER COLUMN product_cost TYPE DECIMAL(15, 2);
        ALTER TABLE quote_items ALTER COLUMN supplier_quote_unit_price TYPE DECIMAL(15, 2);
    END IF;
END $$;

-- Migration: Allow quote_items.product_id to be NULL for supplier-quote-sourced items
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'quote_items'
          AND column_name = 'product_id' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE quote_items ALTER COLUMN product_id DROP NOT NULL;
    END IF;
END $$;

-- Customer offers
CREATE TABLE IF NOT EXISTS customer_offers (
    id VARCHAR(100) PRIMARY KEY,
    linked_quote_id VARCHAR(100) NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    payment_terms VARCHAR(20) NOT NULL DEFAULT 'immediate',
    discount DECIMAL(5, 2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'denied')),
    expiration_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_offers_linked_quote_id
    ON customer_offers(linked_quote_id);
CREATE INDEX IF NOT EXISTS idx_customer_offers_client_id ON customer_offers(client_id);
CREATE INDEX IF NOT EXISTS idx_customer_offers_status ON customer_offers(status);
CREATE INDEX IF NOT EXISTS idx_customer_offers_created_at ON customer_offers(created_at);

CREATE TABLE IF NOT EXISTS customer_offer_items (
    id VARCHAR(50) PRIMARY KEY,
    offer_id VARCHAR(100) NOT NULL REFERENCES customer_offers(id) ON DELETE CASCADE ON UPDATE CASCADE,
    product_id VARCHAR(50) REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    product_cost DECIMAL(15, 2) NOT NULL DEFAULT 0,
    product_mol_percentage DECIMAL(5, 2),
    discount DECIMAL(5, 2) DEFAULT 0,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_offer_items_offer_id ON customer_offer_items(offer_id);
ALTER TABLE customer_offer_items ADD COLUMN IF NOT EXISTS unit_type VARCHAR(10) DEFAULT 'hours';

-- Supplier quote source tracking columns for customer_offer_items
ALTER TABLE customer_offer_items ADD COLUMN IF NOT EXISTS supplier_quote_id VARCHAR(100);
ALTER TABLE customer_offer_items ADD COLUMN IF NOT EXISTS supplier_quote_item_id VARCHAR(50);
ALTER TABLE customer_offer_items ADD COLUMN IF NOT EXISTS supplier_quote_supplier_name VARCHAR(255);
ALTER TABLE customer_offer_items ADD COLUMN IF NOT EXISTS supplier_quote_unit_price DECIMAL(15, 2);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'customer_offer_items'
          AND column_name = 'product_tax_rate'
    ) THEN
        UPDATE customer_offer_items
        SET unit_price = ROUND(unit_price * (1 + COALESCE(product_tax_rate, 0) / 100.0), 2);
    END IF;
END $$;
ALTER TABLE customer_offer_items DROP COLUMN IF EXISTS product_tax_rate;

-- Migration: Ensure customer_offer_items prices use DECIMAL(15, 2)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customer_offer_items'
          AND column_name IN ('unit_price', 'product_cost', 'supplier_quote_unit_price')
          AND numeric_scale != 2
    ) THEN
        ALTER TABLE customer_offer_items ALTER COLUMN unit_price TYPE DECIMAL(15, 2);
        ALTER TABLE customer_offer_items ALTER COLUMN product_cost TYPE DECIMAL(15, 2);
        ALTER TABLE customer_offer_items ALTER COLUMN supplier_quote_unit_price TYPE DECIMAL(15, 2);
    END IF;
END $$;

-- Migration: Add gemini_api_key to general_settings
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS gemini_api_key VARCHAR(255);

-- Migration: Add AI provider + OpenRouter support
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS ai_provider VARCHAR(20) DEFAULT 'gemini';
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS openrouter_api_key VARCHAR(255);
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS gemini_model_id VARCHAR(255);
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS openrouter_model_id VARCHAR(255);

-- Migration: Ensure AI Reporting is off by default for existing installations
ALTER TABLE general_settings ALTER COLUMN enable_ai_reporting SET DEFAULT FALSE;
UPDATE general_settings SET enable_ai_reporting = FALSE WHERE enable_ai_reporting IS NULL;

-- Migration: Ensure ai_provider values are restricted (safe for existing installations)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'general_settings_ai_provider_check') THEN
        ALTER TABLE general_settings DROP CONSTRAINT general_settings_ai_provider_check;
    END IF;
END $$;

ALTER TABLE general_settings ADD CONSTRAINT general_settings_ai_provider_check
    CHECK (ai_provider IN ('gemini', 'openrouter'));

-- Sales table (safe for existing installations)
CREATE TABLE IF NOT EXISTS sales (
    id VARCHAR(100) PRIMARY KEY,
    linked_quote_id VARCHAR(100) REFERENCES quotes(id) ON DELETE SET NULL ON UPDATE CASCADE,
    linked_offer_id VARCHAR(100) REFERENCES customer_offers(id) ON DELETE SET NULL ON UPDATE CASCADE,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    payment_terms VARCHAR(20) NOT NULL DEFAULT 'immediate',
    discount DECIMAL(5, 2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'denied')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration: Update sales status check constraint to allow new statuses
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sales_status_check'
    ) THEN
        ALTER TABLE sales DROP CONSTRAINT sales_status_check;
        ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN ('draft', 'confirmed', 'denied'));
    END IF;
END $$;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS linked_offer_id VARCHAR(100);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sales_linked_offer_id_fkey'
    ) THEN
        ALTER TABLE sales
            ADD CONSTRAINT sales_linked_offer_id_fkey
            FOREIGN KEY (linked_offer_id) REFERENCES customer_offers(id) ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_client_id ON sales(client_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_linked_quote_id ON sales(linked_quote_id);
CREATE INDEX IF NOT EXISTS idx_sales_linked_offer_id ON sales(linked_offer_id);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_sales_linked_offer_id_unique'
    ) AND NOT EXISTS (
        SELECT linked_offer_id
        FROM sales
        WHERE linked_offer_id IS NOT NULL
        GROUP BY linked_offer_id
        HAVING COUNT(*) > 1
    ) THEN
        EXECUTE 'CREATE UNIQUE INDEX idx_sales_linked_offer_id_unique
            ON sales(linked_offer_id)
            WHERE linked_offer_id IS NOT NULL';
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);

-- Ensure order_id column exists for projects (added after sales table is created)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS order_id VARCHAR(100) REFERENCES sales(id) ON DELETE SET NULL;

-- Sale items table (safe for existing installations)
CREATE TABLE IF NOT EXISTS sale_items (
    id VARCHAR(50) PRIMARY KEY,
    sale_id VARCHAR(100) NOT NULL REFERENCES sales(id) ON DELETE CASCADE ON UPDATE CASCADE,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    product_cost DECIMAL(15, 2) NOT NULL DEFAULT 0,
    product_mol_percentage DECIMAL(5, 2),
    discount DECIMAL(5, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS product_cost DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS product_mol_percentage DECIMAL(5, 2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_type VARCHAR(10) DEFAULT 'hours';
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sale_items'
          AND column_name = 'product_tax_rate'
    ) THEN
        UPDATE sale_items
        SET unit_price = ROUND(unit_price * (1 + COALESCE(product_tax_rate, 0) / 100.0), 2);
    END IF;
END $$;
ALTER TABLE sale_items DROP COLUMN IF EXISTS product_tax_rate;

-- Ensure note column exists for sale items (mirrors quote_items structure)
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS note TEXT;

-- Supplier quote source tracking columns for sale_items
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS supplier_quote_id VARCHAR(100);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS supplier_quote_item_id VARCHAR(50);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS supplier_quote_supplier_name VARCHAR(255);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS supplier_quote_unit_price DECIMAL(15, 2);

-- Supplier-sale-order linkage columns for sale_items
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS supplier_sale_id VARCHAR(100);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS supplier_sale_item_id VARCHAR(50);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS supplier_sale_supplier_name VARCHAR(255);

-- Backfill: link existing sale_items to their auto-created supplier_sales via shared supplier_quote_id
UPDATE sale_items si
SET supplier_sale_id = ss.id,
    supplier_sale_supplier_name = ss.supplier_name
FROM supplier_sales ss
WHERE ss.linked_quote_id = si.supplier_quote_id
  AND si.supplier_sale_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_supplier_sale_id ON sale_items(supplier_sale_id);

-- Migration: Ensure sale_items prices use DECIMAL(15, 2)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'sale_items'
          AND column_name IN ('unit_price', 'product_cost', 'supplier_quote_unit_price')
          AND numeric_scale != 2
    ) THEN
        ALTER TABLE sale_items ALTER COLUMN unit_price TYPE DECIMAL(15, 2);
        ALTER TABLE sale_items ALTER COLUMN product_cost TYPE DECIMAL(15, 2);
        ALTER TABLE sale_items ALTER COLUMN supplier_quote_unit_price TYPE DECIMAL(15, 2);
    END IF;
END $$;

-- Supplier Quotes table
CREATE TABLE IF NOT EXISTS supplier_quotes (
    id VARCHAR(100) PRIMARY KEY,
    supplier_id VARCHAR(50) NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    supplier_name VARCHAR(255) NOT NULL,
    payment_terms VARCHAR(20) NOT NULL DEFAULT 'immediate',
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('received', 'approved', 'rejected', 'draft', 'sent', 'accepted', 'denied')),
    expiration_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_supplier_id ON supplier_quotes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_status ON supplier_quotes(status);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_created_at ON supplier_quotes(created_at);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'supplier_quotes_status_check'
    ) THEN
        ALTER TABLE supplier_quotes DROP CONSTRAINT supplier_quotes_status_check;
    END IF;
    ALTER TABLE supplier_quotes
        ADD CONSTRAINT supplier_quotes_status_check
        CHECK (status IN ('received', 'approved', 'rejected', 'draft', 'sent', 'accepted', 'denied'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Supplier Quote Items table
CREATE TABLE IF NOT EXISTS supplier_quote_items (
    id VARCHAR(50) PRIMARY KEY,
    quote_id VARCHAR(100) NOT NULL REFERENCES supplier_quotes(id) ON DELETE CASCADE ON UPDATE CASCADE,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_quote_items_quote_id ON supplier_quote_items(quote_id);
ALTER TABLE supplier_quote_items ADD COLUMN IF NOT EXISTS unit_type VARCHAR(10) DEFAULT 'hours';

-- Migration: Ensure supplier_quote_items prices use DECIMAL(15, 2)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'supplier_quote_items'
          AND column_name = 'unit_price' AND numeric_scale != 2
    ) THEN
        ALTER TABLE supplier_quote_items ALTER COLUMN unit_price TYPE DECIMAL(15, 2);
    END IF;
END $$;

-- Migration: Allow supplier_quote_items.product_id to be NULL (supplier quotes rework)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'supplier_quote_items'
          AND column_name = 'product_id' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE supplier_quote_items ALTER COLUMN product_id DROP NOT NULL;
    END IF;
END $$;

-- Supplier sale orders
CREATE TABLE IF NOT EXISTS supplier_sales (
    id VARCHAR(100) PRIMARY KEY,
    linked_quote_id VARCHAR(100) REFERENCES supplier_quotes(id) ON DELETE SET NULL ON UPDATE CASCADE,
    supplier_id VARCHAR(50) NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    supplier_name VARCHAR(255) NOT NULL,
    payment_terms VARCHAR(20) NOT NULL DEFAULT 'immediate',
    discount DECIMAL(5, 2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE supplier_sales ADD COLUMN IF NOT EXISTS linked_quote_id VARCHAR(100);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'supplier_sales_linked_quote_id_fkey'
    ) THEN
        ALTER TABLE supplier_sales
            ADD CONSTRAINT supplier_sales_linked_quote_id_fkey
            FOREIGN KEY (linked_quote_id) REFERENCES supplier_quotes(id) ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'supplier_offers'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'supplier_sales'
          AND column_name = 'linked_offer_id'
    ) THEN
        UPDATE supplier_sales ss
        SET linked_quote_id = COALESCE(ss.linked_quote_id, so.linked_quote_id)
        FROM supplier_offers so
        WHERE ss.linked_offer_id = so.id;

        INSERT INTO supplier_sales (
            id,
            linked_quote_id,
            linked_offer_id,
            supplier_id,
            supplier_name,
            payment_terms,
            discount,
            status,
            notes,
            created_at,
            updated_at
        )
        SELECT
            CONCAT('MIG-SORD-', so.id),
            so.linked_quote_id,
            so.id,
            so.supplier_id,
            so.supplier_name,
            so.payment_terms,
            so.discount,
            CASE so.status
                WHEN 'draft' THEN 'draft'
                WHEN 'sent' THEN 'sent'
                WHEN 'denied' THEN 'sent'
                -- Accepted offers without downstream orders become draft orders to preserve data.
                ELSE 'draft'
            END,
            so.notes,
            so.created_at,
            so.updated_at
        FROM supplier_offers so
        WHERE NOT EXISTS (
            SELECT 1
            FROM supplier_sales ss
            WHERE ss.linked_offer_id = so.id
               OR ss.linked_quote_id = so.linked_quote_id
        );

        IF EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'supplier_offer_items'
        ) AND EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'supplier_sale_items'
        ) THEN
            INSERT INTO supplier_sale_items (
                id,
                sale_id,
                product_id,
                product_name,
                quantity,
                unit_price,
                discount,
                note,
                created_at
            )
            SELECT
                CONCAT('mig-', soi.id),
                CONCAT('MIG-SORD-', soi.offer_id),
                soi.product_id,
                soi.product_name,
                soi.quantity,
                soi.unit_price,
                soi.discount,
                soi.note,
                soi.created_at
            FROM supplier_offer_items soi
            WHERE EXISTS (
                SELECT 1
                FROM supplier_sales ss
                WHERE ss.id = CONCAT('MIG-SORD-', soi.offer_id)
            ) AND NOT EXISTS (
                SELECT 1
                FROM supplier_sale_items ssi
                WHERE ssi.id = CONCAT('mig-', soi.id)
            );
        END IF;
    END IF;
END $$;

DROP INDEX IF EXISTS idx_supplier_sales_linked_offer_id;
DROP INDEX IF EXISTS idx_supplier_sales_linked_offer_id_unique;

DO $$
DECLARE
    supplier_sales_linked_offer_fk TEXT;
BEGIN
    SELECT tc.constraint_name
    INTO supplier_sales_linked_offer_fk
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'supplier_sales'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'linked_offer_id'
    LIMIT 1;

    IF supplier_sales_linked_offer_fk IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE supplier_sales DROP CONSTRAINT %I',
            supplier_sales_linked_offer_fk
        );
    END IF;
END $$;

ALTER TABLE supplier_sales DROP COLUMN IF EXISTS linked_offer_id;

DROP TABLE IF EXISTS supplier_offer_items;
DROP TABLE IF EXISTS supplier_offers;

DO $$
BEGIN
    UPDATE supplier_sales
    SET status = CASE
        WHEN status = 'confirmed' THEN 'sent'
        WHEN status = 'denied' THEN 'sent'
        ELSE status
    END
    WHERE status IN ('confirmed', 'denied');

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'supplier_sales_status_check'
    ) THEN
        ALTER TABLE supplier_sales DROP CONSTRAINT supplier_sales_status_check;
    END IF;

    ALTER TABLE supplier_sales
        ADD CONSTRAINT supplier_sales_status_check
        CHECK (status IN ('draft', 'sent'));
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_sales_linked_quote_id ON supplier_sales(linked_quote_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_supplier_sales_linked_quote_id_unique'
    ) AND NOT EXISTS (
        SELECT linked_quote_id
        FROM supplier_sales
        WHERE linked_quote_id IS NOT NULL
        GROUP BY linked_quote_id
        HAVING COUNT(*) > 1
    ) THEN
        EXECUTE 'CREATE UNIQUE INDEX idx_supplier_sales_linked_quote_id_unique
            ON supplier_sales(linked_quote_id)
            WHERE linked_quote_id IS NOT NULL';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_sales_supplier_id ON supplier_sales(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_sales_status ON supplier_sales(status);

CREATE TABLE IF NOT EXISTS supplier_sale_items (
    id VARCHAR(50) PRIMARY KEY,
    sale_id VARCHAR(100) NOT NULL REFERENCES supplier_sales(id) ON DELETE CASCADE ON UPDATE CASCADE,
    product_id VARCHAR(50) REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(5, 2) DEFAULT 0,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'supplier_sale_items'
          AND column_name = 'product_tax_rate'
    ) THEN
        UPDATE supplier_sale_items
        SET unit_price = ROUND(unit_price * (1 + COALESCE(product_tax_rate, 0) / 100.0), 2);
    END IF;
END $$;
ALTER TABLE supplier_sale_items DROP COLUMN IF EXISTS product_tax_rate;

CREATE INDEX IF NOT EXISTS idx_supplier_sale_items_sale_id ON supplier_sale_items(sale_id);

-- Migration: Ensure supplier_sale_items prices use DECIMAL(15, 2)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'supplier_sale_items'
          AND column_name = 'unit_price' AND numeric_scale != 2
    ) THEN
        ALTER TABLE supplier_sale_items ALTER COLUMN unit_price TYPE DECIMAL(15, 2);
    END IF;
END $$;

-- Migration: Rename 'tempoRole' to 'praetorRole' in existing LDAP role mappings
DO $$
BEGIN
    UPDATE ldap_config
    SET role_mappings = (
        SELECT jsonb_agg(
            CASE
                WHEN elem ? 'tempoRole'
                THEN (elem - 'tempoRole') || jsonb_build_object('praetorRole', elem->'tempoRole')
                ELSE elem
            END
        )
        FROM jsonb_array_elements(role_mappings) AS elem
    )
    WHERE role_mappings @> '[{"tempoRole": "user"}]'
       OR role_mappings @> '[{"tempoRole": "admin"}]'
       OR role_mappings @> '[{"tempoRole": "manager"}]';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Migration of role_mappings failed or not needed: %', SQLERRM;
END $$;

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(100) PRIMARY KEY,
    linked_sale_id VARCHAR(100) REFERENCES sales(id) ON DELETE SET NULL ON UPDATE CASCADE,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(12, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE invoices DROP COLUMN IF EXISTS tax_amount;

CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);

-- Invoice items table
CREATE TABLE IF NOT EXISTS invoice_items (
    id VARCHAR(50) PRIMARY KEY,
    invoice_id VARCHAR(100) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE ON UPDATE CASCADE,
    product_id VARCHAR(50) REFERENCES products(id) ON DELETE SET NULL,
    description VARCHAR(255) NOT NULL,
    unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'unit',
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(5, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'unit';

UPDATE invoice_items ii
SET unit_of_measure = COALESCE(p.cost_unit, 'unit')
FROM products p
WHERE ii.product_id = p.id
  AND (ii.unit_of_measure IS NULL OR ii.unit_of_measure = '' OR ii.unit_of_measure = 'unit');

UPDATE invoice_items
SET unit_of_measure = 'unit'
WHERE unit_of_measure IS NULL OR unit_of_measure = '';

ALTER TABLE invoice_items ALTER COLUMN unit_of_measure SET DEFAULT 'unit';
ALTER TABLE invoice_items ALTER COLUMN unit_of_measure SET NOT NULL;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'invoice_items'
          AND column_name = 'tax_rate'
    ) THEN
        UPDATE invoice_items
        SET unit_price = ROUND(unit_price * (1 + COALESCE(tax_rate, 0) / 100.0), 2);
    END IF;
END $$;
ALTER TABLE invoice_items DROP COLUMN IF EXISTS tax_rate;

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- Migration: Ensure invoice_items prices use DECIMAL(15, 2)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invoice_items'
          AND column_name = 'unit_price' AND numeric_scale != 2
    ) THEN
        ALTER TABLE invoice_items ALTER COLUMN unit_price TYPE DECIMAL(15, 2);
    END IF;
END $$;

-- Supplier invoices
CREATE TABLE IF NOT EXISTS supplier_invoices (
    id VARCHAR(100) PRIMARY KEY,
    linked_sale_id VARCHAR(100) REFERENCES supplier_sales(id) ON DELETE SET NULL ON UPDATE CASCADE,
    supplier_id VARCHAR(50) NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    supplier_name VARCHAR(255) NOT NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(12, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$
DECLARE
    linked_sale_constraint_definition TEXT;
BEGIN
    SELECT pg_get_constraintdef(c.oid)
    INTO linked_sale_constraint_definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'supplier_invoices'
      AND c.conname = 'supplier_invoices_linked_sale_id_fkey';

    -- Older databases can still carry the pre-refactor FK to sales(id).
    UPDATE supplier_invoices si
    SET linked_sale_id = NULL
    WHERE si.linked_sale_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM supplier_sales ss
          WHERE ss.id = si.linked_sale_id
      );

    IF linked_sale_constraint_definition IS NULL THEN
        ALTER TABLE supplier_invoices
            ADD CONSTRAINT supplier_invoices_linked_sale_id_fkey
            FOREIGN KEY (linked_sale_id) REFERENCES supplier_sales(id) ON DELETE SET NULL ON UPDATE CASCADE;
    ELSIF linked_sale_constraint_definition NOT ILIKE '%REFERENCES supplier_sales(id)%' THEN
        ALTER TABLE supplier_invoices
            DROP CONSTRAINT supplier_invoices_linked_sale_id_fkey,
            ADD CONSTRAINT supplier_invoices_linked_sale_id_fkey
            FOREIGN KEY (linked_sale_id) REFERENCES supplier_sales(id) ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE supplier_invoices DROP COLUMN IF EXISTS tax_amount;

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier_id ON supplier_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status ON supplier_invoices(status);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_issue_date ON supplier_invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_linked_sale_id ON supplier_invoices(linked_sale_id);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_supplier_invoices_linked_sale_id_unique'
    ) AND NOT EXISTS (
        SELECT linked_sale_id
        FROM supplier_invoices
        WHERE linked_sale_id IS NOT NULL
        GROUP BY linked_sale_id
        HAVING COUNT(*) > 1
    ) THEN
        EXECUTE 'CREATE UNIQUE INDEX idx_supplier_invoices_linked_sale_id_unique
            ON supplier_invoices(linked_sale_id)
            WHERE linked_sale_id IS NOT NULL';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS supplier_invoice_items (
    id VARCHAR(50) PRIMARY KEY,
    invoice_id VARCHAR(100) NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE ON UPDATE CASCADE,
    product_id VARCHAR(50) REFERENCES products(id) ON DELETE SET NULL,
    description VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(5, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'supplier_invoice_items'
          AND column_name = 'tax_rate'
    ) THEN
        UPDATE supplier_invoice_items
        SET unit_price = ROUND(unit_price * (1 + COALESCE(tax_rate, 0) / 100.0), 2);
    END IF;
END $$;
ALTER TABLE supplier_invoice_items DROP COLUMN IF EXISTS tax_rate;

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_items_invoice_id
    ON supplier_invoice_items(invoice_id);

-- Migration: Ensure supplier_invoice_items prices use DECIMAL(15, 2)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'supplier_invoice_items'
          AND column_name = 'unit_price' AND numeric_scale != 2
    ) THEN
        ALTER TABLE supplier_invoice_items ALTER COLUMN unit_price TYPE DECIMAL(15, 2);
    END IF;
END $$;

-- Migration: Remove deprecated Finances tables.
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;

-- Notifications table for in-app notifications
CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;

-- Reports: AI Reporting chat sessions (cross-device history)
CREATE TABLE IF NOT EXISTS report_chat_sessions (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'AI Reporting',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_report_chat_sessions_user_updated
    ON report_chat_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_chat_sessions_user_archived
    ON report_chat_sessions(user_id, is_archived);

CREATE TABLE IF NOT EXISTS report_chat_messages (
    id VARCHAR(50) PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL REFERENCES report_chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    thought_content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_report_chat_messages_session_created
    ON report_chat_messages(session_id, created_at ASC);

-- Email administration table (single row)
CREATE TABLE IF NOT EXISTS email_config (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled BOOLEAN DEFAULT FALSE,
    smtp_host VARCHAR(255) DEFAULT '',
    smtp_port INTEGER DEFAULT 587,
    smtp_encryption VARCHAR(20) DEFAULT 'tls',
    smtp_reject_unauthorized BOOLEAN DEFAULT TRUE,
    smtp_user VARCHAR(255) DEFAULT '',
    smtp_password VARCHAR(255) DEFAULT '',
    from_email VARCHAR(255) DEFAULT '',
    from_name VARCHAR(255) DEFAULT 'Praetor',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default email config row
INSERT INTO email_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Add default_location to general_settings
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS default_location VARCHAR(20) DEFAULT 'remote';

-- Seed hr.costs permissions for manager role
INSERT INTO role_permissions (role_id, permission)
VALUES
    ('manager', 'hr.costs.view'),
    ('manager', 'hr.costs.update')
ON CONFLICT DO NOTHING;

-- Seed employee assignment permissions for manager role
INSERT INTO role_permissions (role_id, permission)
VALUES
    ('manager', 'hr.employee_assignments.update')
ON CONFLICT DO NOTHING;

-- Seed Reports permissions for manager role (safe for existing installations)
INSERT INTO role_permissions (role_id, permission)
VALUES
    ('manager', 'reports.ai_reporting.view'),
    ('manager', 'reports.ai_reporting.create')
ON CONFLICT DO NOTHING;

-- Seed Top Manager from the scoped manager baseline, then add its extra visibility/control.
INSERT INTO role_permissions (role_id, permission)
SELECT 'top_manager', permission
FROM role_permissions
WHERE role_id = 'manager'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
VALUES
    ('top_manager', 'timesheets.tracker_all.view'),
    ('top_manager', 'crm.clients_all.view'),
    ('top_manager', 'projects.manage_all.view'),
    ('top_manager', 'projects.tasks_all.view'),
    ('top_manager', 'hr.work_units.view'),
    ('top_manager', 'hr.work_units.create'),
    ('top_manager', 'hr.work_units.update'),
    ('top_manager', 'hr.work_units.delete'),
    ('top_manager', 'hr.work_units_all.view')
ON CONFLICT DO NOTHING;

-- Migration: Merge reports.ai_reporting_ai.create into reports.ai_reporting.create
UPDATE role_permissions
SET permission = 'reports.ai_reporting.create'
WHERE permission = 'reports.ai_reporting_ai.create'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2
    WHERE rp2.role_id = role_permissions.role_id
      AND rp2.permission = 'reports.ai_reporting.create'
  );
DELETE FROM role_permissions WHERE permission = 'reports.ai_reporting_ai.create';


ALTER TABLE report_chat_messages ADD COLUMN IF NOT EXISTS thought_content TEXT;

-- Seed project assignment permissions for manager and top_manager roles
INSERT INTO role_permissions (role_id, permission)
VALUES
    ('manager', 'projects.assignments.update'),
    ('top_manager', 'projects.assignments.update')
ON CONFLICT DO NOTHING;

-- Internal product categories table
CREATE TABLE IF NOT EXISTS internal_product_categories (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('supply', 'service', 'consulting')),
    cost_unit VARCHAR(20) NOT NULL DEFAULT 'unit' CHECK (cost_unit IN ('unit', 'hours')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (name, type)
);

CREATE INDEX IF NOT EXISTS idx_internal_product_categories_type 
    ON internal_product_categories(type);

-- Migration: Backfill internal product categories from existing products
DO $$
DECLARE
    rec RECORD;
    default_unit VARCHAR(20);
    existing_id VARCHAR(50);
BEGIN
    FOR rec IN 
        SELECT DISTINCT category, type, 
               COALESCE(
                   (SELECT cost_unit FROM products WHERE category = p.category AND type = p.type AND supplier_id IS NULL LIMIT 1),
                   CASE p.type 
                       WHEN 'supply' THEN 'unit'
                       WHEN 'service' THEN 'hours'
                       WHEN 'consulting' THEN 'hours'
                       ELSE 'unit'
                   END
               ) as derived_cost_unit
        FROM products p 
        WHERE category IS NOT NULL 
          AND category != ''
          AND supplier_id IS NULL
          AND type IN ('supply', 'service', 'consulting')
    LOOP
        -- Check if this category/type already exists
        SELECT id INTO existing_id
        FROM internal_product_categories
        WHERE name = rec.category AND type = rec.type;
        
        IF existing_id IS NULL THEN
            INSERT INTO internal_product_categories (id, name, type, cost_unit)
            VALUES (
                'ipc-' || gen_random_uuid(),
                rec.category,
                rec.type,
                rec.derived_cost_unit
            );
        END IF;
    END LOOP;
END $$;

-- Migration: Seed default internal product categories if not already present
DO $$
BEGIN
    -- Supply defaults
    IF NOT EXISTS (SELECT 1 FROM internal_product_categories WHERE name = 'Hardware' AND type = 'supply') THEN
        INSERT INTO internal_product_categories (id, name, type, cost_unit)
        VALUES ('ipc-supply-hardware', 'Hardware', 'supply', 'unit');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM internal_product_categories WHERE name = 'License' AND type = 'supply') THEN
        INSERT INTO internal_product_categories (id, name, type, cost_unit)
        VALUES ('ipc-supply-license', 'License', 'supply', 'unit');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM internal_product_categories WHERE name = 'Subscription' AND type = 'supply') THEN
        INSERT INTO internal_product_categories (id, name, type, cost_unit)
        VALUES ('ipc-supply-subscription', 'Subscription', 'supply', 'unit');
    END IF;
    
    -- Consulting defaults
    IF NOT EXISTS (SELECT 1 FROM internal_product_categories WHERE name = 'Specialistic' AND type = 'consulting') THEN
        INSERT INTO internal_product_categories (id, name, type, cost_unit)
        VALUES ('ipc-consulting-specialistic', 'Specialistic', 'consulting', 'hours');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM internal_product_categories WHERE name = 'Technical' AND type = 'consulting') THEN
        INSERT INTO internal_product_categories (id, name, type, cost_unit)
        VALUES ('ipc-consulting-technical', 'Technical', 'consulting', 'hours');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM internal_product_categories WHERE name = 'Governance' AND type = 'consulting') THEN
        INSERT INTO internal_product_categories (id, name, type, cost_unit)
        VALUES ('ipc-consulting-governance', 'Governance', 'consulting', 'hours');
    END IF;
    
    -- Service defaults
    IF NOT EXISTS (SELECT 1 FROM internal_product_categories WHERE name = 'Reports' AND type = 'service') THEN
        INSERT INTO internal_product_categories (id, name, type, cost_unit)
        VALUES ('ipc-service-reports', 'Reports', 'service', 'hours');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM internal_product_categories WHERE name = 'Monitoring' AND type = 'service') THEN
        INSERT INTO internal_product_categories (id, name, type, cost_unit)
        VALUES ('ipc-service-monitoring', 'Monitoring', 'service', 'hours');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM internal_product_categories WHERE name = 'Maintenance' AND type = 'service') THEN
        INSERT INTO internal_product_categories (id, name, type, cost_unit)
        VALUES ('ipc-service-maintenance', 'Maintenance', 'service', 'hours');
    END IF;
END $$;

-- ============================================
-- Product Types Table (User-Managed)
-- ============================================

-- Create product_types table for user-managed product types
CREATE TABLE IF NOT EXISTS product_types (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    cost_unit VARCHAR(20) NOT NULL DEFAULT 'unit' CHECK (cost_unit IN ('unit', 'hours')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_types_name ON product_types(name);

-- Seed default product types (matching legacy hardcoded values)
-- These will be created on fresh installations; migrations handle existing data
DO $$
BEGIN
    -- Supply type (default for products, uses 'unit' cost unit)
    IF NOT EXISTS (SELECT 1 FROM product_types WHERE name = 'supply') THEN
        INSERT INTO product_types (id, name, cost_unit)
        VALUES ('pt-supply', 'supply', 'unit');
    END IF;
    
    -- Service type (uses 'hours' cost unit)
    IF NOT EXISTS (SELECT 1 FROM product_types WHERE name = 'service') THEN
        INSERT INTO product_types (id, name, cost_unit)
        VALUES ('pt-service', 'service', 'hours');
    END IF;
    
    -- Consulting type (uses 'hours' cost unit)
    IF NOT EXISTS (SELECT 1 FROM product_types WHERE name = 'consulting') THEN
        INSERT INTO product_types (id, name, cost_unit)
        VALUES ('pt-consulting', 'consulting', 'hours');
    END IF;
END $$;

-- ============================================
-- Migration: Relax fixed type constraints
-- ============================================

-- Drop the fixed enum constraint from internal_product_categories
-- Note: This allows any string value; validation is now done in the API layer
ALTER TABLE internal_product_categories
DROP CONSTRAINT IF EXISTS internal_product_categories_type_check;

-- Migrate legacy 'item' type products to 'supply'
UPDATE products
SET type = 'supply'
WHERE type = 'item' AND supplier_id IS NULL;

-- Create index for faster type lookups on products
CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);

-- Normalize internal category and product units to follow product type.
UPDATE internal_product_categories
SET cost_unit = CASE type
    WHEN 'service' THEN 'hours'
    WHEN 'consulting' THEN 'hours'
    ELSE 'unit'
END
WHERE cost_unit IS DISTINCT FROM CASE type
    WHEN 'service' THEN 'hours'
    WHEN 'consulting' THEN 'hours'
    ELSE 'unit'
END;

UPDATE products
SET cost_unit = CASE type
    WHEN 'service' THEN 'hours'
    WHEN 'consulting' THEN 'hours'
    ELSE 'unit'
END
WHERE supplier_id IS NULL
  AND type IN ('supply', 'service', 'consulting')
  AND cost_unit IS DISTINCT FROM CASE type
      WHEN 'service' THEN 'hours'
      WHEN 'consulting' THEN 'hours'
      ELSE 'unit'
  END;

-- Internal product subcategories table
CREATE TABLE IF NOT EXISTS internal_product_subcategories (
    id VARCHAR(50) PRIMARY KEY,
    category_id VARCHAR(50) NOT NULL REFERENCES internal_product_categories(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (category_id, name)
);

CREATE INDEX IF NOT EXISTS idx_internal_product_subcategories_category_id 
    ON internal_product_subcategories(category_id);

-- Migration: Backfill internal product subcategories from existing products
DO $$
DECLARE
    rec RECORD;
    cat_id VARCHAR(50);
BEGIN
    FOR rec IN 
        SELECT DISTINCT p.category, p.type, p.subcategory
        FROM products p
        WHERE p.category IS NOT NULL 
          AND p.category != ''
          AND p.subcategory IS NOT NULL
          AND p.subcategory != ''
          AND p.supplier_id IS NULL
          AND p.type IN ('supply', 'service', 'consulting')
    LOOP
        -- Find the category id
        SELECT id INTO cat_id
        FROM internal_product_categories
        WHERE name = rec.category AND type = rec.type;
        
        IF cat_id IS NOT NULL THEN
            -- Check if subcategory already exists
            IF NOT EXISTS (
                SELECT 1 FROM internal_product_subcategories 
                WHERE category_id = cat_id AND LOWER(name) = LOWER(rec.subcategory)
            ) THEN
                INSERT INTO internal_product_subcategories (id, category_id, name)
                VALUES (
                    'ips-' || gen_random_uuid(),
                    cat_id,
                    rec.subcategory
                );
            END IF;
        END IF;
    END LOOP;
END $$;

-- Global discount type: allow percentage or fixed currency amount per document header
ALTER TABLE quotes           ADD COLUMN IF NOT EXISTS discount_type VARCHAR(10) NOT NULL DEFAULT 'percentage';
ALTER TABLE customer_offers  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(10) NOT NULL DEFAULT 'percentage';
ALTER TABLE sales            ADD COLUMN IF NOT EXISTS discount_type VARCHAR(10) NOT NULL DEFAULT 'percentage';
ALTER TABLE supplier_sales   ADD COLUMN IF NOT EXISTS discount_type VARCHAR(10) NOT NULL DEFAULT 'percentage';
-- Widen header discount columns to DECIMAL(15,2) so currency amounts on large orders fit
ALTER TABLE quotes           ALTER COLUMN discount TYPE DECIMAL(15, 2);
ALTER TABLE customer_offers  ALTER COLUMN discount TYPE DECIMAL(15, 2);
ALTER TABLE sales            ALTER COLUMN discount TYPE DECIMAL(15, 2);
ALTER TABLE supplier_sales   ALTER COLUMN discount TYPE DECIMAL(15, 2);

-- Migration: Remove discount columns from supplier quotes
ALTER TABLE supplier_quotes DROP COLUMN IF EXISTS discount;
ALTER TABLE supplier_quotes DROP COLUMN IF EXISTS discount_type;
ALTER TABLE supplier_quote_items DROP COLUMN IF EXISTS discount;

-- Migration: Remove supplier quote discount snapshot columns from client-facing tables
ALTER TABLE quote_items DROP COLUMN IF EXISTS supplier_quote_item_discount;
ALTER TABLE quote_items DROP COLUMN IF EXISTS supplier_quote_discount;
ALTER TABLE customer_offer_items DROP COLUMN IF EXISTS supplier_quote_item_discount;
ALTER TABLE customer_offer_items DROP COLUMN IF EXISTS supplier_quote_discount;
ALTER TABLE sale_items DROP COLUMN IF EXISTS supplier_quote_item_discount;
ALTER TABLE sale_items DROP COLUMN IF EXISTS supplier_quote_discount;

-- Enforce discount_type values at DB level (idempotent)
ALTER TABLE quotes          DROP CONSTRAINT IF EXISTS chk_quotes_discount_type;
ALTER TABLE quotes          ADD  CONSTRAINT chk_quotes_discount_type          CHECK (discount_type IN ('percentage', 'currency'));
ALTER TABLE customer_offers DROP CONSTRAINT IF EXISTS chk_customer_offers_discount_type;
ALTER TABLE customer_offers ADD  CONSTRAINT chk_customer_offers_discount_type CHECK (discount_type IN ('percentage', 'currency'));
ALTER TABLE sales           DROP CONSTRAINT IF EXISTS chk_sales_discount_type;
ALTER TABLE sales           ADD  CONSTRAINT chk_sales_discount_type           CHECK (discount_type IN ('percentage', 'currency'));
ALTER TABLE supplier_sales  DROP CONSTRAINT IF EXISTS chk_supplier_sales_discount_type;
ALTER TABLE supplier_sales  ADD  CONSTRAINT chk_supplier_sales_discount_type  CHECK (discount_type IN ('percentage', 'currency'));

-- Enforce unit_type values at DB level (idempotent)
ALTER TABLE quote_items          DROP CONSTRAINT IF EXISTS chk_quote_items_unit_type;
ALTER TABLE quote_items          ADD  CONSTRAINT chk_quote_items_unit_type          CHECK (unit_type IN ('hours', 'days', 'unit'));
ALTER TABLE customer_offer_items DROP CONSTRAINT IF EXISTS chk_customer_offer_items_unit_type;
ALTER TABLE customer_offer_items ADD  CONSTRAINT chk_customer_offer_items_unit_type CHECK (unit_type IN ('hours', 'days', 'unit'));
ALTER TABLE sale_items           DROP CONSTRAINT IF EXISTS chk_sale_items_unit_type;
ALTER TABLE sale_items           ADD  CONSTRAINT chk_sale_items_unit_type           CHECK (unit_type IN ('hours', 'days', 'unit'));
ALTER TABLE supplier_quote_items DROP CONSTRAINT IF EXISTS chk_supplier_quote_items_unit_type;
ALTER TABLE supplier_quote_items ADD  CONSTRAINT chk_supplier_quote_items_unit_type CHECK (unit_type IN ('hours', 'days', 'unit'));
