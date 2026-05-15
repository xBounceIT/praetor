import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import * as personalAccessTokensRepo from '../repositories/personalAccessTokensRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { logAudit } from '../utils/audit.ts';
import {
  equivalentPermissionsFor,
  getRolePermissions,
  hasAnyPermission,
  hasPermission,
  type PermissionAction,
  type PermissionResource,
} from '../utils/permissions.ts';
import { hashPersonalAccessToken, isPersonalAccessToken } from '../utils/personal-access-token.ts';
import {
  INSECURE_DEFAULT_JWT_SECRETS,
  isInsecureEnvValue,
  readRequiredNonDefaultEnv,
  resolvePositiveDurationMs,
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
const DEFAULT_PAT_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Resolved lazily on the first authenticated request and cached for the lifetime of the
// process, so we avoid re-parsing env on every request without forcing tests to set
// SESSION_MAX_DURATION_MS before the very first `import './middleware/auth.ts'` runs.
let cachedSessionMaxDurationMs: number | null = null;
const getSessionMaxDurationMs = (): number => {
  if (cachedSessionMaxDurationMs === null) {
    cachedSessionMaxDurationMs = resolvePositiveDurationMs(
      'SESSION_MAX_DURATION_MS',
      DEFAULT_SESSION_MAX_DURATION_MS,
    );
  }
  return cachedSessionMaxDurationMs;
};

// Test-only escape hatch: forces re-reading SESSION_MAX_DURATION_MS from env on the next
// authenticated request. Not part of the public production API.
export const __resetSessionMaxDurationCacheForTests = () => {
  cachedSessionMaxDurationMs = null;
};

let cachedPatIdleTimeoutMs: number | null = null;
const getPatIdleTimeoutMs = (): number => {
  if (cachedPatIdleTimeoutMs === null) {
    cachedPatIdleTimeoutMs = resolvePositiveDurationMs(
      'PAT_IDLE_TIMEOUT_MS',
      DEFAULT_PAT_IDLE_TIMEOUT_MS,
    );
  }
  return cachedPatIdleTimeoutMs;
};

export const __resetPatIdleTimeoutCacheForTests = () => {
  cachedPatIdleTimeoutMs = null;
};

type SessionJwtPayload = JwtPayload & {
  userId: string;
  sessionStart?: number;
  activeRole?: string;
  sessionVersion?: number;
};

type NonEmptyGuardArgs = [string, ...string[]];

const loadAuthenticatedUserContext = async (
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  activeRole?: string,
  expectedSessionVersion?: number,
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

  // Session version mismatch means the token was issued before a logout (or other
  // forced revocation) bumped the user's session version. Reject without rotating.
  if (expectedSessionVersion !== undefined && user.sessionVersion !== expectedSessionVersion) {
    reply.code(401).send({ error: 'Session revoked', errorCode: 'session_revoked' });
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

    // Tokens issued before the session-version revocation feature lack this claim.
    // Refuse them — clients must re-authenticate to pick up the new token format.
    if (typeof decoded.sessionVersion !== 'number') {
      return reply.code(401).send({
        error: 'Session token outdated, please log in again',
        errorCode: 'session_outdated',
      });
    }

    request.auth = {
      userId: decoded.userId,
      sessionStart,
      sessionVersion: decoded.sessionVersion,
      source: 'session',
    };

    const userContext = await loadAuthenticatedUserContext(
      request,
      reply,
      decoded.userId,
      decoded.activeRole,
      decoded.sessionVersion,
    );
    if (!userContext) return;

    // Sliding window: reset the 30m idle timer while preserving sessionStart (8h cap)
    // and sessionVersion (so the rotated token survives until logout bumps it).
    const newToken = generateToken(
      decoded.userId,
      sessionStart,
      userContext.effectiveRole,
      decoded.sessionVersion,
    );
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

    // Idle timeout: fall back to updatedAt for tokens that haven't been used yet, so a
    // freshly-issued PAT isn't compared against epoch 0. updatedAt — not createdAt — is the
    // correct anchor because renewForUser bumps updatedAt and clears lastUsedAt while leaving
    // createdAt alone, so a renewed token with an old createdAt would otherwise 403 instantly.
    const idleReference = tokenRecord.lastUsedAt ?? tokenRecord.updatedAt;
    if (Date.now() - idleReference.getTime() > getPatIdleTimeoutMs()) {
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

// Emits an `auth.permission_denied` audit row for an authenticated request that fails a
// role/permission guard, then sends the standard 403. `authenticateToken` runs first and sets
// `request.user`, so the audit entry always has a userId in this path. The 401 branches above
// do not audit (no user identity).
const denyForbidden = async (
  request: FastifyRequest,
  reply: FastifyReply,
  reason: 'role' | 'permission',
  required: string[],
) => {
  const routeLabel = `${request.method} ${(request as { routeOptions?: { url?: string } }).routeOptions?.url ?? request.url}`;
  await logAudit({
    request,
    action: 'auth.permission_denied',
    entityType: 'route',
    entityId: routeLabel,
    details: {
      targetLabel: routeLabel,
      secondaryLabel: reason,
      changedFields: [...required].sort(),
    },
  });
  return reply.code(403).send({ error: 'Insufficient permissions' });
};

export const requireRole = (...roles: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    if (!roles.includes(request.user.role)) {
      return denyForbidden(request, reply, 'role', roles);
    }
  };
};

export const requirePermission = (...permissions: NonEmptyGuardArgs) => {
  if (permissions.length === 0) {
    throw new Error('requirePermission requires at least one permission');
  }

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const userPermissions = request.user.permissions || [];
    const hasAll = permissions.every((permission) => hasPermission(userPermissions, permission));
    if (!hasAll) {
      return denyForbidden(request, reply, 'permission', permissions);
    }
  };
};

export const requireAnyPermission = (...permissions: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const userPermissions = request.user.permissions || [];
    const hasAny = hasAnyPermission(userPermissions, permissions);
    if (!hasAny) {
      return denyForbidden(request, reply, 'permission', permissions);
    }
  };
};

export const requireScopedPermission = (resource: PermissionResource, action: PermissionAction) =>
  requireAnyPermission(...equivalentPermissionsFor(resource, action));

// Narrow `request.auth` to a session-sourced context for endpoints that must not be
// callable with a personal access token (logout, role switch). Returns null after sending
// a response if the caller doesn't have a valid session.
export const requireSessionAuth = (
  request: FastifyRequest,
  reply: FastifyReply,
): { userId: string; sessionStart: number; sessionVersion: number } | null => {
  if (request.auth?.source !== 'session') {
    reply.code(403).send({ error: 'Session authentication required' });
    return null;
  }
  return {
    userId: request.auth.userId,
    sessionStart: request.auth.sessionStart ?? Date.now(),
    sessionVersion: request.auth.sessionVersion as number,
  };
};

export const generateToken = (
  userId: string,
  sessionStart: number,
  activeRole: string | undefined,
  sessionVersion: number,
) =>
  jwt.sign({ userId, sessionStart, activeRole, sessionVersion }, JWT_SECRET, {
    expiresIn: '30m',
    algorithm: JWT_ALGORITHM,
  });

export default {
  authenticateToken,
  requireRole,
  requirePermission,
  requireAnyPermission,
  requireScopedPermission,
  generateToken,
};
