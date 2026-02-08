import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { query } from '../db/index.ts';
import { cacheGetSetJson, TTL_AUTH_USER_SECONDS } from '../services/cache.ts';
import { getRolePermissions } from '../utils/permissions.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'praetor-secret-key-change-in-production';

type SessionJwtPayload = JwtPayload & {
  userId: string;
  sessionStart?: number;
  activeRole?: string;
};

export const authenticateToken = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return reply.code(401).send({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionJwtPayload;
    const sessionStart = decoded.sessionStart ?? Date.now();

    // Check for max session duration (8 hours)
    const SESSION_MAX_DURATION = 8 * 60 * 60 * 1000; // 8 hours in ms
    const now = Date.now();

    if (now - sessionStart > SESSION_MAX_DURATION) {
      return reply.code(401).send({ error: 'Session expired (max duration exceeded)' });
    }

    request.auth = { userId: decoded.userId, sessionStart };

    // Fetch user data (cached briefly in Redis to avoid hitting Postgres on every request)
    type AuthUserRow = {
      id: string;
      name: string;
      username: string;
      role: string;
      avatar_initials: string | null;
      is_disabled: boolean;
    };

    const { value: user } = await cacheGetSetJson<AuthUserRow | null>(
      'users',
      `auth:user:${decoded.userId}`,
      TTL_AUTH_USER_SECONDS,
      async () => {
        const result = await query(
          `SELECT u.id, u.name, u.username, u.role, u.avatar_initials, u.is_disabled
           FROM users u
           WHERE u.id = $1`,
          [decoded.userId],
        );
        if (result.rows.length === 0) return null;
        return result.rows[0] as AuthUserRow;
      },
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    if (user.is_disabled) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    const effectiveRole = decoded.activeRole ?? user.role;

    // Validate role membership via user_roles if the table exists.
    // During startup migrations, user_roles may not exist yet; skip validation in that case.
    try {
      const membership = await query(
        'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 LIMIT 1',
        [user.id, effectiveRole],
      );
      if (membership.rows.length === 0) {
        return reply.code(403).send({ error: 'Invalid or expired token' });
      }
    } catch (err) {
      const e = err as { code?: string };
      if (e.code !== '42P01') throw err; // undefined_table
    }

    const permissions = await getRolePermissions(effectiveRole);
    request.user = { ...user, role: effectiveRole, permissions };

    // Sliding window: Issue new token with same sessionStart
    // This resets the 30m idle timer but keeps the 8h max session limit
    const newToken = generateToken(decoded.userId, sessionStart, effectiveRole);
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

export const requirePermission = (...permissions: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const userPermissions = request.user.permissions || [];
    const hasAll = permissions.every((permission) => userPermissions.includes(permission));
    if (!hasAll) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }
  };
};

export const requireAnyPermission = (...permissions: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const userPermissions = request.user.permissions || [];
    const hasAny = permissions.some((permission) => userPermissions.includes(permission));
    if (!hasAny) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }
  };
};

export const generateToken = (
  userId: string,
  sessionStart: number = Date.now(),
  activeRole?: string,
) => {
  // Token expires in 30 minutes (idle timeout)
  // sessionStart tracks the absolute start of the session (max 8 hours)
  return jwt.sign({ userId, sessionStart, activeRole }, JWT_SECRET, { expiresIn: '30m' });
};

export default {
  authenticateToken,
  requireRole,
  requirePermission,
  requireAnyPermission,
  generateToken,
};
