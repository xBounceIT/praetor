import { query } from './index.ts';

export async function migrate() {
    console.log('Running products structure update migration...');

    try {
        // 1. Add description and subcategory columns
        await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;`);
        await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100);`);

        // 2. Update 'item' type to 'supply'
        await query(`UPDATE products SET type = 'supply' WHERE type = 'item';`);

        // 3. Handle duplicates before adding unique constraint
        await query(`
            WITH duplicates AS (
                SELECT id, name, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at) as rn
                FROM products
            )
            UPDATE products 
            SET name = name || ' (Copy ' || (rn - 1) || ')'
            FROM duplicates 
            WHERE products.id = duplicates.id AND duplicates.rn > 1;
        `);

        // 4. Add unique constraint on name (using Unique Index)
        await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_unique ON products(name);`);

        console.log('Products structure update completed.');
    } catch (err) {
        console.error('Error running products structure update migration:', err);
        throw err;
    }
}
