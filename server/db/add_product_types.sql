-- Migration: Add internal_product_types table and remove fixed type constraints
-- This migration creates a user-managed product types system

-- ============================================
-- 1. Create the product_types table
-- ============================================
CREATE TABLE IF NOT EXISTS product_types (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    cost_unit VARCHAR(20) NOT NULL DEFAULT 'unit' CHECK (cost_unit IN ('unit', 'hours')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed the default product types matching the legacy hardcoded values
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM product_types WHERE name = 'supply') THEN
        INSERT INTO product_types (id, name, cost_unit)
        VALUES ('pt-supply', 'supply', 'unit');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM product_types WHERE name = 'service') THEN
        INSERT INTO product_types (id, name, cost_unit)
        VALUES ('pt-service', 'service', 'hours');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM product_types WHERE name = 'consulting') THEN
        INSERT INTO product_types (id, name, cost_unit)
        VALUES ('pt-consulting', 'consulting', 'hours');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM product_types WHERE name = 'item') THEN
        INSERT INTO product_types (id, name, cost_unit)
        VALUES ('pt-item', 'item', 'unit');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_types_name ON product_types(name);

-- ============================================
-- 2. Remove fixed type constraints from internal_product_categories
-- ============================================
-- Drop the check constraint that enforces fixed types
ALTER TABLE internal_product_categories
DROP CONSTRAINT IF EXISTS internal_product_categories_type_check;

-- Add a foreign key to product_types (or keep as string for flexibility)
-- For now, we'll keep it as string but add validation in the API layer

-- ============================================
-- 3. Migrate legacy 'item' products to 'supply'
-- ============================================
UPDATE products
SET type = 'supply'
WHERE type = 'item' AND supplier_id IS NULL;

-- ============================================
-- 4. Remove the legacy 'item' type after migration
-- ============================================
DELETE FROM product_types WHERE name = 'item';

-- ============================================
-- 5. Create indexes for faster type lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
