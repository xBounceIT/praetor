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
            ADD COLUMN IF NOT EXISTS description TEXT,
            ADD COLUMN IF NOT EXISTS ateco_code VARCHAR(50),
            ADD COLUMN IF NOT EXISTS website VARCHAR(255),
            ADD COLUMN IF NOT EXISTS sector VARCHAR(120),
            ADD COLUMN IF NOT EXISTS number_of_employees VARCHAR(120),
            ADD COLUMN IF NOT EXISTS revenue VARCHAR(120),
            ADD COLUMN IF NOT EXISTS fiscal_code VARCHAR(50),
            ADD COLUMN IF NOT EXISTS office_count_range VARCHAR(120),
            ADD COLUMN IF NOT EXISTS billing_code VARCHAR(50);
        `);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

migrate();
