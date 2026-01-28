-- Praetor Database Schema

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
ALTER TABLE clients ADD COLUMN IF NOT EXISTS vat_number VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_code VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_code VARCHAR(50);

-- Ensure VAT number is unique (case-insensitive, non-empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_vat_number_unique
    ON clients (LOWER(vat_number))
    WHERE vat_number IS NOT NULL AND vat_number <> '';

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

-- Ensure location column exists for existing installations
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS location VARCHAR(20) DEFAULT 'remote' CHECK (location IN ('remote', 'office', 'client'));

-- User settings table
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    email VARCHAR(255),
    daily_goal DECIMAL(4, 2) DEFAULT 8.00,
    start_of_week VARCHAR(10) DEFAULT 'Monday' CHECK (start_of_week IN ('Monday', 'Sunday')),
    enable_ai_insights BOOLEAN DEFAULT FALSE,
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
    currency VARCHAR(10) DEFAULT '€',
    daily_limit DECIMAL(4, 2) DEFAULT 8.00,
    start_of_week VARCHAR(10) DEFAULT 'Monday' CHECK (start_of_week IN ('Monday', 'Sunday')),
    treat_saturday_as_holiday BOOLEAN DEFAULT TRUE,
    enable_ai_insights BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure columns exist for existing installations
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS daily_limit DECIMAL(4, 2) DEFAULT 8.00;
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS start_of_week VARCHAR(10) DEFAULT 'Monday';
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS treat_saturday_as_holiday BOOLEAN DEFAULT TRUE;
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS enable_ai_insights BOOLEAN DEFAULT FALSE;

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
    costo DECIMAL(15, 6) NOT NULL DEFAULT 0,
    mol_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    cost_unit VARCHAR(20) NOT NULL DEFAULT 'unit',
    category VARCHAR(100),
    tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 0,
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

-- Quotes table
CREATE TABLE IF NOT EXISTS quotes (
    id VARCHAR(50) PRIMARY KEY,
    quote_code VARCHAR(20) UNIQUE NOT NULL,
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
    quote_id VARCHAR(50) NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    special_bid_id VARCHAR(50),
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 6) NOT NULL DEFAULT 0,
    product_cost DECIMAL(15, 6) NOT NULL DEFAULT 0,
    product_mol_percentage DECIMAL(5, 2),
    special_bid_unit_price DECIMAL(15, 6),
    special_bid_mol_percentage DECIMAL(5, 2),
    discount DECIMAL(5, 2) DEFAULT 0,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS special_bid_id VARCHAR(50);
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS product_cost DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS product_mol_percentage DECIMAL(5, 2);
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS special_bid_unit_price DECIMAL(10, 2);
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS special_bid_mol_percentage DECIMAL(5, 2);
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS note TEXT;

CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id ON quote_items(quote_id);

-- Special bids table
CREATE TABLE IF NOT EXISTS special_bids (
    id VARCHAR(50) PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    unit_price DECIMAL(15, 6) NOT NULL DEFAULT 0,
    mol_percentage DECIMAL(5, 2),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration: Rename expiration_date to end_date and add start_date for existing installations
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='special_bids' AND column_name='expiration_date') THEN
        ALTER TABLE special_bids RENAME COLUMN expiration_date TO end_date;
    END IF;
END $$;
ALTER TABLE special_bids ADD COLUMN IF NOT EXISTS start_date DATE;
UPDATE special_bids SET start_date = CURRENT_DATE WHERE start_date IS NULL;
ALTER TABLE special_bids ALTER COLUMN start_date SET NOT NULL;

ALTER TABLE special_bids ADD COLUMN IF NOT EXISTS mol_percentage DECIMAL(5, 2);

DROP INDEX IF EXISTS idx_special_bids_unique;
CREATE INDEX IF NOT EXISTS idx_special_bids_client_product ON special_bids(client_id, product_id);
CREATE INDEX IF NOT EXISTS idx_special_bids_client_id ON special_bids(client_id);
CREATE INDEX IF NOT EXISTS idx_special_bids_product_id ON special_bids(product_id);

-- Migration: Ensure AI capabilities are off by default for existing installations that relied on default
ALTER TABLE general_settings ALTER COLUMN enable_ai_insights SET DEFAULT FALSE;
ALTER TABLE settings ALTER COLUMN enable_ai_insights SET DEFAULT FALSE;

-- Migration: Add gemini_api_key to general_settings
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS gemini_api_key VARCHAR(255);

-- Sales table (safe for existing installations)
CREATE TABLE IF NOT EXISTS sales (
    id VARCHAR(50) PRIMARY KEY,
    linked_quote_id VARCHAR(50) REFERENCES quotes(id) ON DELETE SET NULL,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    payment_terms VARCHAR(20) NOT NULL DEFAULT 'immediate',
    discount DECIMAL(5, 2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'confirmed', 'denied')),
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
        ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN ('draft', 'sent', 'confirmed', 'denied', 'pending', 'completed', 'cancelled'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_client_id ON sales(client_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_linked_quote_id ON sales(linked_quote_id);

-- Sale items table (safe for existing installations)
CREATE TABLE IF NOT EXISTS sale_items (
    id VARCHAR(50) PRIMARY KEY,
    sale_id VARCHAR(50) NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    special_bid_id VARCHAR(50),
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 6) NOT NULL DEFAULT 0,
    product_cost DECIMAL(15, 6) NOT NULL DEFAULT 0,
    product_mol_percentage DECIMAL(5, 2),
    special_bid_unit_price DECIMAL(15, 6),
    special_bid_mol_percentage DECIMAL(5, 2),
    discount DECIMAL(5, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS special_bid_id VARCHAR(50);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS product_cost DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS product_mol_percentage DECIMAL(5, 2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS special_bid_unit_price DECIMAL(10, 2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS special_bid_mol_percentage DECIMAL(5, 2);

-- Ensure note column exists for sale items (mirrors quote_items structure)
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS note TEXT;

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);

-- Supplier Quotes table
CREATE TABLE IF NOT EXISTS supplier_quotes (
    id VARCHAR(50) PRIMARY KEY,
    supplier_id VARCHAR(50) NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    supplier_name VARCHAR(255) NOT NULL,
    purchase_order_number VARCHAR(100) NOT NULL,
    payment_terms VARCHAR(20) NOT NULL DEFAULT 'immediate',
    discount DECIMAL(5, 2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'approved', 'rejected')),
    expiration_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_supplier_id ON supplier_quotes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_status ON supplier_quotes(status);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_po ON supplier_quotes(purchase_order_number);

-- Supplier Quote Items table
CREATE TABLE IF NOT EXISTS supplier_quote_items (
    id VARCHAR(50) PRIMARY KEY,
    quote_id VARCHAR(50) NOT NULL REFERENCES supplier_quotes(id) ON DELETE CASCADE,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 6) NOT NULL DEFAULT 0,
    discount DECIMAL(5, 2) DEFAULT 0,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_quote_items_quote_id ON supplier_quote_items(quote_id);

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
    id VARCHAR(50) PRIMARY KEY,
    linked_sale_id VARCHAR(50) REFERENCES sales(id) ON DELETE SET NULL,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(12, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);

-- Invoice items table
CREATE TABLE IF NOT EXISTS invoice_items (
    id VARCHAR(50) PRIMARY KEY,
    invoice_id VARCHAR(50) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id VARCHAR(50) REFERENCES products(id) ON DELETE SET NULL,
    description VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 6) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(5, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- Payments table (tracks payments for invoices)
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(50) PRIMARY KEY,
    invoice_id VARCHAR(50) REFERENCES invoices(id) ON DELETE CASCADE,
    client_id VARCHAR(50) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method VARCHAR(50) NOT NULL DEFAULT 'bank_transfer',
    reference VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_client_id ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id VARCHAR(50) PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    expense_date DATE NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'other',
    vendor VARCHAR(255),
    receipt_reference VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

-- Migration: Ensure payments foreign key has ON DELETE CASCADE
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'payments'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'invoice_id'
        AND ccu.table_name = 'invoices'
    )
    LOOP
        EXECUTE 'ALTER TABLE payments DROP CONSTRAINT ' || quote_ident(r.constraint_name);
        EXECUTE 'ALTER TABLE payments ADD CONSTRAINT ' || quote_ident(r.constraint_name) || ' FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE';
    END LOOP;
END $$;

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
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;

