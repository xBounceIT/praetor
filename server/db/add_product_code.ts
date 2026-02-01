import { query } from './index.ts';

/**
 * Migration: Add product_code column to products table
 * - Adds product_code VARCHAR(50) column (nullable initially)
 * - Generates placeholder codes for existing products (PROD_1, PROD_2, etc.)
 * - Makes column NOT NULL after migration
 * - Creates unique index on product_code
 */
export async function addProductCode() {
  console.log('Starting migration: add_product_code');

  try {
    // Step 1: Add product_code column (nullable initially)
    await query(`
      ALTER TABLE products 
      ADD COLUMN IF NOT EXISTS product_code VARCHAR(50);
    `);
    console.log('✓ Added product_code column');

    // Step 2: Generate placeholder codes for existing products
    const existingProducts = await query(`
      SELECT id FROM products WHERE product_code IS NULL ORDER BY created_at ASC
    `);

    if (existingProducts.rows.length > 0) {
      console.log(`Found ${existingProducts.rows.length} products without product codes`);

      for (let i = 0; i < existingProducts.rows.length; i++) {
        const productId = existingProducts.rows[i].id;
        const placeholderCode = `PROD_${i + 1}`;

        await query(`UPDATE products SET product_code = $1 WHERE id = $2`, [
          placeholderCode,
          productId,
        ]);
      }
      console.log('✓ Generated placeholder product codes');
    }

    // Step 3: Make column NOT NULL
    await query(`
      ALTER TABLE products 
      ALTER COLUMN product_code SET NOT NULL;
    `);
    console.log('✓ Set product_code to NOT NULL');

    // Step 4: Create unique index
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_product_code_unique 
      ON products(product_code);
    `);
    console.log('✓ Created unique index on product_code');

    console.log('Migration completed successfully: add_product_code');
  } catch (error) {
    console.error('Migration failed: add_product_code', error);
    throw error;
  }
}

// Run migration if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addProductCode()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
