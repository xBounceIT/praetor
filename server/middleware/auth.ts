import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'praetor-secret-key-change-in-production';

type SessionJwtPayload = JwtPayload & {
  userId: string;
  sessionStart?: number;
};

export const authenticateToken = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return reply.code(401).send({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionJwtPayload;

    // Check for max session duration (8 hours)
    const SESSION_MAX_DURATION = 8 * 60 * 60 * 1000; // 8 hours in ms
    const now = Date.now();

    if (decoded.sessionStart && now - decoded.sessionStart > SESSION_MAX_DURATION) {
      return reply.code(401).send({ error: 'Session expired (max duration exceeded)' });
    }

    // Fetch fresh user data from database
    const result = await query(
      'SELECT id, name, username, role, avatar_initials FROM users WHERE id = $1',
      [decoded.userId],
    );

    if (result.rows.length === 0) {
      return reply.code(401).send({ error: 'User not found' });
    }

    request.user = result.rows[0];

    // Sliding window: Issue new token with same sessionStart
    // This resets the 30m idle timer but keeps the 8h max session limit
    const newToken = generateToken(decoded.userId, decoded.sessionStart ?? Date.now());
    reply.header('x-auth-token', newToken);
  } catch {
    return reply.code(403).send({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (...roles: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    if (!roles.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }
  };
};

export const generateToken = (userId: string, sessionStart: number = Date.now()) => {
  // Token expires in 30 minutes (idle timeout)
  // sessionStart tracks the absolute start of the session (max 8 hours)
  return jwt.sign({ userId, sessionStart }, JWT_SECRET, { expiresIn: '30m' });
};

export default { authenticateToken, requireRole, generateToken };
