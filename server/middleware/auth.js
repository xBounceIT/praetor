import jwt from 'jsonwebtoken';
import { query } from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'tempo-secret-key-change-in-production';

export const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Check for max session duration (8 hours)
        const SESSION_MAX_DURATION = 8 * 60 * 60 * 1000; // 8 hours in ms
        const now = Date.now();

        if (decoded.sessionStart && (now - decoded.sessionStart > SESSION_MAX_DURATION)) {
            return res.status(401).json({ error: 'Session expired (max duration exceeded)' });
        }

        // Fetch fresh user data from database
        const result = await query(
            'SELECT id, name, username, role, avatar_initials FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        req.user = result.rows[0];

        // Sliding window: Issue new token with same sessionStart
        // This resets the 30m idle timer but keeps the 8h max session limit
        const newToken = generateToken(decoded.userId, decoded.sessionStart);
        res.setHeader('x-auth-token', newToken);

        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

export const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
};

export const generateToken = (userId, sessionStart = Date.now()) => {
    // Token expires in 30 minutes (idle timeout)
    // sessionStart tracks the absolute start of the session (max 8 hours)
    return jwt.sign({ userId, sessionStart }, JWT_SECRET, { expiresIn: '30m' });
};

export default { authenticateToken, requireRole, generateToken };
