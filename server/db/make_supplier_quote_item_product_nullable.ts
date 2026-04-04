/**
 * Migration: Make product_id nullable on supplier_quote_items
 * The supplier quotes rework removed the product picker — users type product names freely.
 * This allows items to exist without a linked product.
 */

import { query } from './index.js';

export async function makeSupplierQuoteItemProductNullable() {
  console.log('Running migration: make_supplier_quote_item_product_nullable');

  try {
    await query(`ALTER TABLE supplier_quote_items ALTER COLUMN product_id DROP NOT NULL`);
    console.log('Migration complete: product_id is now nullable on supplier_quote_items');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}
