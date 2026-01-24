import { query } from './index.ts';

async function migrate() {
  console.log('Starting migration: Add client details...');
  try {
    await query(`
            ALTER TABLE clients 
            ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'company',
            ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255),
            ADD COLUMN IF NOT EXISTS client_code VARCHAR(50),
            ADD COLUMN IF NOT EXISTS email VARCHAR(255),
            ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
            ADD COLUMN IF NOT EXISTS address TEXT,
            ADD COLUMN IF NOT EXISTS vat_number VARCHAR(50),
            ADD COLUMN IF NOT EXISTS tax_code VARCHAR(50),
            ADD COLUMN IF NOT EXISTS billing_code VARCHAR(50),
            ADD COLUMN IF NOT EXISTS payment_terms TEXT;
        `);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

migrate();
