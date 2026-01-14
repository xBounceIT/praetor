import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
    console.log('[Auth] Login request received');
    console.log('[Auth] Request body:', req.body);
    
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
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const user = result.rows[0];

        if (user.is_disabled) {
            return res.status(403).json({ error: 'Account is disabled. Please contact an administrator.' });
        }

        // LDAP Authentication
        let ldapAuthSuccess = false;
        try {
            // We need to dynamic import or ensure service is ready. 
            // Since we use ES modules, top level import is fine.
            // But we need to handle if LDAP is disabled in config.
            // The service handles check internally.
            const ldapService = (await import('../services/ldap.js')).default;
            ldapAuthSuccess = await ldapService.authenticate(username, password);
        } catch (err) {
            console.error('LDAP Auth Attempt Failed:', err.message); // Log but continue to local
        }

        let validPassword = false;
        if (ldapAuthSuccess) {
            validPassword = true;
        } else {
            validPassword = await bcrypt.compare(password, user.password_hash);
        }

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
