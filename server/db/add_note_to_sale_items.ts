/**
 * Migration: Add note column to sale_items table
 * This mirrors the quote_items structure and allows product-level notes in sales.
 */

import { query } from './index.js';

export async function addNoteToSaleItems() {
  console.log('Running migration: add_note_to_sale_items');

  try {
    await query(`ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS note TEXT`);
    console.log('Migration complete: note column added to sale_items');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}
