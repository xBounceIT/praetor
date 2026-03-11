import { query } from './index.ts';

/**
 * Migration: Add bid_code column to special_bids table
 * - Adds bid_code VARCHAR(50) column (nullable initially)
 * - Generates codes for existing bids (BID-YYYY-0001, BID-YYYY-0002, etc.)
 * - Makes column NOT NULL after migration
 * - Creates unique index on bid_code
 */
export async function addBidCode() {
  console.log('Starting migration: add_bid_code');

  try {
    // Step 1: Add bid_code column (nullable initially)
    await query(`
      ALTER TABLE special_bids 
      ADD COLUMN IF NOT EXISTS bid_code VARCHAR(50);
    `);
    console.log('✓ Added bid_code column');

    // Step 2: Generate codes for existing bids using year-based sequential pattern
    const year = new Date().getFullYear();
    const existingBids = await query(`
      SELECT id FROM special_bids WHERE bid_code IS NULL ORDER BY created_at ASC
    `);

    if (existingBids.rows.length > 0) {
      console.log(`Found ${existingBids.rows.length} special bids without codes`);

      for (let i = 0; i < existingBids.rows.length; i++) {
        const bidId = existingBids.rows[i].id;
        // Format: BID-YYYY-0001 (year-based sequential)
        const code = `BID-${year}-${String(i + 1).padStart(4, '0')}`;

        await query(`UPDATE special_bids SET bid_code = $1 WHERE id = $2`, [code, bidId]);
      }
      console.log('✓ Generated bid codes');
    }

    // Step 3: Make column NOT NULL
    await query(`
      ALTER TABLE special_bids 
      ALTER COLUMN bid_code SET NOT NULL;
    `);
    console.log('✓ Set bid_code to NOT NULL');

    // Step 4: Create unique index
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_special_bids_bid_code_unique 
      ON special_bids(bid_code);
    `);
    console.log('✓ Created unique index on bid_code');

    console.log('Migration completed successfully: add_bid_code');
  } catch (error) {
    console.error('Migration failed: add_bid_code', error);
    throw error;
  }
}

// Run migration if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addBidCode()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
