import { query } from './index';

/**
 * Migration: Add quote_code column to quotes table
 * - Adds quote_code VARCHAR(20) column (nullable initially)
 * - Generates codes for existing quotes (Q0001, Q0002, etc.)
 * - Makes column NOT NULL after migration
 * - Creates unique index on quote_code
 */
export async function addQuoteCode() {
  console.log('Starting migration: add_quote_code');

  try {
    // Step 1: Add quote_code column (nullable initially)
    await query(`
      ALTER TABLE quotes 
      ADD COLUMN IF NOT EXISTS quote_code VARCHAR(20);
    `);
    console.log('✓ Added quote_code column');

    // Step 2: Generate codes for existing quotes
    const existingQuotes = await query(`
      SELECT id FROM quotes WHERE quote_code IS NULL ORDER BY created_at ASC
    `);

    if (existingQuotes.rows.length > 0) {
      console.log(`Found ${existingQuotes.rows.length} quotes without codes`);

      for (let i = 0; i < existingQuotes.rows.length; i++) {
        const quoteId = existingQuotes.rows[i].id;
        // Format: Q + 4 digits (e.g. Q0001)
        const code = `Q${(i + 1).toString().padStart(4, '0')}`;

        await query(`UPDATE quotes SET quote_code = $1 WHERE id = $2`, [code, quoteId]);
      }
      console.log('✓ Generated quote codes');
    }

    // Step 3: Make column NOT NULL
    await query(`
      ALTER TABLE quotes 
      ALTER COLUMN quote_code SET NOT NULL;
    `);
    console.log('✓ Set quote_code to NOT NULL');

    // Step 4: Create unique index
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_quote_code_unique 
      ON quotes(quote_code);
    `);
    console.log('✓ Created unique index on quote_code');

    console.log('Migration completed successfully: add_quote_code');
  } catch (error) {
    console.error('Migration failed: add_quote_code', error);
    throw error;
  }
}

// Run migration if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addQuoteCode()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
