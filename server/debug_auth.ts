import pool from './db/index.ts';
import bcrypt from 'bcryptjs';

async function checkAuth() {
  try {
    console.log('Connecting to database...');
    const result = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);

    if (result.rows.length === 0) {
      console.log('User "admin" NOT FOUND in database.');
    } else {
      console.log('User "admin" FOUND.');
      const user = result.rows[0];
      console.log('Hash in DB:', user.password_hash);

      const isMatch = await bcrypt.compare('password', user.password_hash);
      console.log(`Password "password" match: ${isMatch}`);
    }
  } catch (err) {
    console.error('Database connection error:', err);
  } finally {
    await pool.end();
  }
}

checkAuth();
