import bcrypt from 'bcryptjs';
import pool from '../db/index.ts';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run debug-auth.ts against a production database.');
  process.exit(1);
}

async function checkAuth() {
  try {
    console.log('Connecting to database...');
    const result = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);

    if (result.rows.length === 0) {
      console.log('User "admin" NOT FOUND in database.');
    } else {
      console.log('User "admin" FOUND.');
      const user = result.rows[0];
      // Don't echo the bcrypt hash to stdout — it's offline-attackable. A presence + length
      // check is enough to confirm the column is populated.
      const hashPresent = typeof user.password_hash === 'string' && user.password_hash.length > 0;
      console.log(
        `Password hash present: ${hashPresent} (length: ${user.password_hash?.length ?? 0})`,
      );

      if (hashPresent) {
        const isMatch = await bcrypt.compare('password', user.password_hash);
        console.log(`Password "password" match: ${isMatch}`);
      } else {
        console.log('Skipping bcrypt.compare: password_hash is missing or empty.');
      }
    }
  } catch (err) {
    console.error('Database connection error:', err);
  } finally {
    await pool.end();
  }
}

checkAuth();
