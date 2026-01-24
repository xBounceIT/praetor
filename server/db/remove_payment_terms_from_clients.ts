import { query } from './index.ts';

/**
 * Migration: Remove payment_terms column from clients table
 * This migration removes the payment_terms field that is no longer used.
 */
export async function up() {
  try {
    await query(
      `
      ALTER TABLE clients DROP COLUMN IF EXISTS payment_terms
    `,
      [],
    );
    console.log('Migration: Removed payment_terms column from clients table');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  }
}

export async function down() {
  try {
    await query(
      `
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_terms TEXT
    `,
      [],
    );
    console.log('Rollback: Added back payment_terms column to clients table');
  } catch (err) {
    console.error('Rollback failed:', err);
    throw err;
  }
}
