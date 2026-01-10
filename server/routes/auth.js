import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const result = await query(
            'SELECT id, name, username, password_hash, role, avatar_initials FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            console.log(`[AUTH-DEBUG] User not found for username: ${username}`);
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const user = result.rows[0];
        console.log(`[AUTH-DEBUG] User found: ${user.username}`);
        // Log truncated hash for security, just to verify it exists
        console.log(`[AUTH-DEBUG] Stored hash start: ${user.password_hash.substring(0, 10)}...`);

        const validPassword = await bcrypt.compare(password, user.password_hash);
        console.log(`[AUTH-DEBUG] Password valid: ${validPassword}`);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const token = generateToken(user.id);

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                role: user.role,
                avatarInitials: user.avatar_initials
            }
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/auth/me - Get current user
router.get('/me', authenticateToken, async (req, res) => {
    res.json({
        id: req.user.id,
        name: req.user.name,
        username: req.user.username,
        role: req.user.role,
        avatarInitials: req.user.avatar_initials
    });
});

export default router;
