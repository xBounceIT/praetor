import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // POST /login
    fastify.post('/login', async (request, reply) => {
        const { username, password } = request.body;

        if (!username || !password) {
            return reply.code(400).send({ error: 'Username and password are required' });
        }

        const result = await query(
            'SELECT id, name, username, password_hash, role, avatar_initials, is_disabled FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return reply.code(401).send({ error: 'Invalid username or password' });
        }

        const user = result.rows[0];

        if (user.is_disabled) {
            return reply.code(403).send({ error: 'Account is disabled. Please contact an administrator.' });
        }

        // LDAP Authentication
        let ldapAuthSuccess = false;
        try {
            const ldapService = (await import('../services/ldap.js')).default;
            ldapAuthSuccess = await ldapService.authenticate(username, password);
        } catch (err) {
            console.error('LDAP Auth Attempt Failed:', err.message);
        }

        let validPassword = false;
        if (ldapAuthSuccess) {
            validPassword = true;
        } else {
            validPassword = await bcrypt.compare(password, user.password_hash);
        }

        if (!validPassword) {
            return reply.code(401).send({ error: 'Invalid username or password' });
        }

        const token = generateToken(user.id);

        return {
            token,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                role: user.role,
                avatarInitials: user.avatar_initials
            }
        };
    });

    // GET /me - Get current user
    fastify.get('/me', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        return {
            id: request.user.id,
            name: request.user.name,
            username: request.user.username,
            role: request.user.role,
            avatarInitials: request.user.avatar_initials
        };
    });
}
