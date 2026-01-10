
import pool from './db/index.js';
import bcrypt from 'bcryptjs';

async function fixPassword() {
    try {
        console.log('Generating new hash for "password"...');
        const newHash = await bcrypt.hash('password', 10);
        console.log('New Hash:', newHash);

        console.log('Updating admin user...');
        const result = await pool.query(
            'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING *',
            [newHash, 'admin']
        );

        if (result.rowCount === 0) {
            console.log('Error: Admin user not found to update!');
        } else {
            console.log('Successfully updated admin password.');

            // Verify immediately
            const user = result.rows[0];
            const isMatch = await bcrypt.compare('password', user.password_hash);
            console.log(`Immediate verification match: ${isMatch}`);
        }
    } catch (err) {
        console.error('Error fixing password:', err);
    } finally {
        await pool.end();
    }
}

fixPassword();
