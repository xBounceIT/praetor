import { query } from './index.ts';

export async function migrate() {
  console.log('Starting sale status migration...');

  try {
    // Map 'pending' -> 'draft'
    const pendingResult = await query("UPDATE sales SET status = 'draft' WHERE status = 'pending'");
    console.log(`Migrated ${pendingResult.rowCount} sales from 'pending' to 'draft'`);

    // Map 'completed' -> 'confirmed'
    const completedResult = await query(
      "UPDATE sales SET status = 'confirmed' WHERE status = 'completed'",
    );
    console.log(`Migrated ${completedResult.rowCount} sales from 'completed' to 'confirmed'`);

    // Map 'cancelled' -> 'denied'
    const cancelledResult = await query(
      "UPDATE sales SET status = 'denied' WHERE status = 'cancelled'",
    );
    console.log(`Migrated ${cancelledResult.rowCount} sales from 'cancelled' to 'denied'`);

    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}
