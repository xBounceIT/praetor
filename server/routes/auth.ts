import bcrypt from 'bcryptjs';
import { query } from '../db/index.ts';
import { generateToken, authenticateToken } from '../middleware/auth.ts';
import { requireNonEmptyString, badRequest } from '../utils/validation.ts';

export default async function (fastify, _opts) {
  // POST /login
  fastify.post('/login', async (request, reply) => {
    const { username, password } = request.body;

    const usernameResult = requireNonEmptyString(username, 'username');
    if (!usernameResult.ok) {
      return badRequest(reply, usernameResult.message);
    }

    const passwordResult = requireNonEmptyString(password, 'password');
    if (!passwordResult.ok) {
      return badRequest(reply, passwordResult.message);
    }

    const result = await query(
      'SELECT id, name, username, password_hash, role, avatar_initials, is_disabled FROM users WHERE username = $1',
      [usernameResult.value],
    );

    if (result.rows.length === 0) {
      return reply.code(401).send({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];

    if (user.is_disabled) {
      return reply.code(401).send({ error: 'Invalid username or password' });
    }

    // LDAP Authentication
    let ldapAuthSuccess = false;
    try {
      const ldapService = (await import('../services/ldap.ts')).default;
      ldapAuthSuccess = await ldapService.authenticate(usernameResult.value, passwordResult.value);
    } catch (err) {
      console.error('LDAP Auth Attempt Failed:', err.message);
    }

    let validPassword = false;
    if (ldapAuthSuccess) {
      validPassword = true;
    } else {
      validPassword = await bcrypt.compare(passwordResult.value, user.password_hash);
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
        avatarInitials: user.avatar_initials,
      },
    };
  });

  // GET /me - Get current user
  fastify.get(
    '/me',
    {
      onRequest: [authenticateToken],
    },
    async (request, _reply) => {
      return {
        id: request.user.id,
        name: request.user.name,
        username: request.user.username,
        role: request.user.role,
        avatarInitials: request.user.avatar_initials,
      };
    },
  );
}
