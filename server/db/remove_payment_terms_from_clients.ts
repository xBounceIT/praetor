import { query } from './index';

/**
 * Migration: Remove payment_terms column from clients table
 * This migration removes the payment_terms field that is no longer used.
 */
export async function up() {
  await query(`
    ALTER TABLE clients DROP COLUMN IF EXISTS payment_terms
  `);
  console.log('Migration: Removed payment_terms column from clients table');
}

export async function down() {
  await query(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_terms TEXT
  `);
  console.log('Rollback: Added back payment_terms column to clients table');
}
