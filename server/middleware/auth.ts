import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import * as personalAccessTokensRepo from '../repositories/personalAccessTokensRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import {
  equivalentPermissionsFor,
  getRolePermissions,
  type PermissionAction,
  type PermissionResource,
} from '../utils/permissions.ts';
import { hashPersonalAccessToken, isPersonalAccessToken } from '../utils/personal-access-token.ts';
import {
  INSECURE_DEFAULT_JWT_SECRETS,
  isInsecureEnvValue,
  readRequiredNonDefaultEnv,
  TEST_JWT_SECRET,
} from '../utils/runtimeConfig.ts';

const resolveJwtSecret = () => {
  const configured = process.env.JWT_SECRET?.trim();
  if (
    process.env.NODE_ENV === 'test' &&
    (!configured || isInsecureEnvValue(configured, INSECURE_DEFAULT_JWT_SECRETS))
  ) {
    return TEST_JWT_SECRET;
  }
  return readRequiredNonDefaultEnv('JWT_SECRET', INSECURE_DEFAULT_JWT_SECRETS);
};

const JWT_SECRET = resolveJwtSecret();

// JWT signing algorithm. `jwt.sign` (see generateToken below) defaults to HS256, so we pin
// verification to the same algorithm to prevent algorithm-confusion attacks (e.g. forged
// tokens using `alg: 'none'` or asymmetric algorithms abusing the HMAC secret as a public key).
const JWT_ALGORITHM = 'HS256' as const;

const DEFAULT_SESSION_MAX_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

const resolveSessionMaxDurationMs = (): number => {
  const raw = process.env.SESSION_MAX_DURATION_MS?.trim();
  if (!raw) return DEFAULT_SESSION_MAX_DURATION_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SESSION_MAX_DURATION_MS;
  }
  return parsed;
};

// Resolved lazily on the first authenticated request and cached for the lifetime of the
// process, so we avoid re-parsing env on every request without forcing tests to set
// SESSION_MAX_DURATION_MS before the very first `import './middleware/auth.ts'` runs.
let cachedSessionMaxDurationMs: number | null = null;
const getSessionMaxDurationMs = (): number => {
  if (cachedSessionMaxDurationMs === null) {
    cachedSessionMaxDurationMs = resolveSessionMaxDurationMs();
  }
  return cachedSessionMaxDurationMs;
};

// Test-only escape hatch: forces re-reading SESSION_MAX_DURATION_MS from env on the next
// authenticated request. Not part of the public production API.
export const __resetSessionMaxDurationCacheForTests = () => {
  cachedSessionMaxDurationMs = null;
};

type SessionJwtPayload = JwtPayload & {
  userId: string;
  sessionStart?: number;
  activeRole?: string;
};

const loadAuthenticatedUserContext = async (
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  activeRole?: string,
) => {
  const user = await usersRepo.findAuthUserById(userId);

  if (!user) {
    reply.code(401).send({ error: 'User not found' });
    return null;
  }

  if (user.isDisabled) {
    reply.code(403).send({ error: 'Account disabled', errorCode: 'account_disabled' });
    return null;
  }

  const effectiveRole = activeRole ?? user.role;

  // Run in parallel: this middleware fires on every authenticated request and the success path
  // (user has the role) is the hot case. The wasted permissions lookup on a 403 is cheap
  // compared to the latency saved on the 99%+ success path.
  const [hasRole, permissions] = await Promise.all([
    rolesRepo.userHasRole(user.id, effectiveRole),
    getRolePermissions(effectiveRole),
  ]);
  if (!hasRole) {
    reply.code(403).send({ error: 'Invalid or expired token' });
    return null;
  }

  request.user = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: effectiveRole,
    avatarInitials: user.avatarInitials,
    permissions,
  };

  return { effectiveRole };
};

export const authenticateToken = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return reply.code(401).send({ error: 'Access token required' });
  }

  if (isPersonalAccessToken(token)) {
    return authenticatePersonalAccessToken(request, reply, token);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    }) as SessionJwtPayload;
    const sessionStart = decoded.sessionStart ?? Date.now();

    // Check for max session duration (configurable via SESSION_MAX_DURATION_MS env var,
    // default 8 hours). Resolved once per process — see getSessionMaxDurationMs above.
    const now = Date.now();

    if (now - sessionStart > getSessionMaxDurationMs()) {
      return reply.code(401).send({ error: 'Session expired (max duration exceeded)' });
    }

    request.auth = { userId: decoded.userId, sessionStart, source: 'session' };

    const userContext = await loadAuthenticatedUserContext(
      request,
      reply,
      decoded.userId,
      decoded.activeRole,
    );
    if (!userContext) return;

    // Sliding window: Issue new token with same sessionStart
    // This resets the 30m idle timer but keeps the 8h max session limit
    const newToken = generateToken(decoded.userId, sessionStart, userContext.effectiveRole);
    reply.header('x-auth-token', newToken);
  } catch {
    return reply.code(403).send({ error: 'Invalid or expired token' });
  }
};

const authenticatePersonalAccessToken = async (
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
) => {
  try {
    const tokenHash = hashPersonalAccessToken(token);
    const tokenRecord = await personalAccessTokensRepo.findByTokenHash(tokenHash);
    if (!tokenRecord) {
      return reply.code(403).send({ error: 'Invalid or expired token' });
    }

    request.auth = { userId: tokenRecord.userId, source: 'personalAccessToken' };

    const userContext = await loadAuthenticatedUserContext(request, reply, tokenRecord.userId);
    if (!userContext) return;

    try {
      await personalAccessTokensRepo.markUsed(tokenHash);
    } catch (err) {
      request.log?.warn({ err }, 'Failed to update personal access token last-used timestamp');
    }
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

export const requireScopedPermission = (resource: PermissionResource, action: PermissionAction) =>
  requireAnyPermission(...equivalentPermissionsFor(resource, action));

export const generateToken = (
  userId: string,
  sessionStart: number = Date.now(),
  activeRole?: string,
) => {
  // Token expires in 30 minutes (idle timeout)
  // sessionStart tracks the absolute start of the session (SESSION_MAX_DURATION_MS, default 8h)
  return jwt.sign({ userId, sessionStart, activeRole }, JWT_SECRET, {
    expiresIn: '30m',
    algorithm: JWT_ALGORITHM,
  });
};

export default {
  authenticateToken,
  requireRole,
  requirePermission,
  requireAnyPermission,
  requireScopedPermission,
  generateToken,
};
