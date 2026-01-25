import { query } from './index.ts';

/**
 * Migration: Add unique constraint to client_code
 * - Checks for duplicates and resolves them by appending a suffix
 * - Adds UNIQUE index to client_code
 */
export async function addUniqueClientCode() {
  console.log('Starting migration: add_unique_client_code');

  try {
    // Step 1: Find duplicates
    const duplicates = await query(`
      SELECT client_code, COUNT(*) 
      FROM clients 
      WHERE client_code IS NOT NULL AND client_code <> ''
      GROUP BY client_code 
      HAVING COUNT(*) > 1
    `);

    if (duplicates.rows.length > 0) {
      console.log(`Found ${duplicates.rows.length} duplicate client codes. Resolving...`);

      for (const row of duplicates.rows) {
        const code = row.client_code;
        // Get all clients with this code, ordered by creation time (keep the oldest one as is)
        const clientsWithCode = await query(
          `SELECT id FROM clients WHERE client_code = $1 ORDER BY created_at ASC`,
          [code],
        );

        // Skip the first one (keep original)
        for (let i = 1; i < clientsWithCode.rows.length; i++) {
          const client = clientsWithCode.rows[i];
          const newCode = `${code}_${i}`; // e.g., CODE_1, CODE_2
          await query(`UPDATE clients SET client_code = $1 WHERE id = $2`, [newCode, client.id]);
          console.log(`Updated client ${client.id}: ${code} -> ${newCode}`);
        }
      }
    } else {
      console.log('No duplicate client codes found.');
    }

    // Step 2: Add UNIQUE constraint (using index)
    // We use a unique index where client_code is not null/empty
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_client_code_unique 
      ON clients (client_code)
      WHERE client_code IS NOT NULL AND client_code <> '';
    `);
    console.log('✓ Created unique index on client_code');

    console.log('Migration completed successfully: add_unique_client_code');
  } catch (error) {
    console.error('Migration failed: add_unique_client_code', error);
    throw error;
  }
}

// Run migration if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addUniqueClientCode()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
