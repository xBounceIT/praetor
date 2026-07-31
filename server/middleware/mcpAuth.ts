import type { AuthInfo } from '@modelcontextprotocol/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { McpTokenScope } from '../db/schema/mcpTokens.ts';
import * as mcpTokensRepo from '../repositories/mcpTokensRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { getRolePermissions } from '../utils/permissions.ts';
import { resolvePositiveDurationMs } from '../utils/runtimeConfig.ts';

export type McpAuthenticatedUser = {
  id: string;
  name: string;
  username: string;
  role: string;
  avatarInitials: string;
  permissions: string[];
};

export type McpAuthInfoExtra = {
  clientIp: string;
  user: McpAuthenticatedUser;
  tokenId: string;
  tokenName: string;
  tokenScope: McpTokenScope;
};

const DEFAULT_MCP_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let cachedMcpIdleTimeoutMs: number | null = null;
const getMcpIdleTimeoutMs = (): number => {
  if (cachedMcpIdleTimeoutMs === null) {
    cachedMcpIdleTimeoutMs = resolvePositiveDurationMs(
      'MCP_IDLE_TIMEOUT_MS',
      DEFAULT_MCP_IDLE_TIMEOUT_MS,
    );
  }
  return cachedMcpIdleTimeoutMs;
};

export const __resetMcpIdleTimeoutCacheForTests = () => {
  cachedMcpIdleTimeoutMs = null;
};

const parseBearerToken = (request: FastifyRequest): string | null => {
  const authHeader = request.headers.authorization;
  const [scheme, token] = String(authHeader || '').split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
};

export const isMcpToken = (token: string): boolean =>
  token.startsWith(mcpTokensRepo.MCP_TOKEN_PREFIX);

const applyScope = (permissions: string[], scope: McpTokenScope): string[] =>
  scope === 'read_only' ? permissions.filter((p) => p.endsWith('.view')) : permissions;

const isMcpProtocolRequest = (request: FastifyRequest): boolean =>
  request.url.split('?', 1)[0]?.replace(/\/+$/, '') === '/api/mcp';

const isReadOnlyHttpMethod = (method: string): boolean =>
  ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

export const authenticateMcpToken = async (request: FastifyRequest, reply: FastifyReply) => {
  const rawToken = parseBearerToken(request);
  if (!rawToken || !isMcpToken(rawToken)) {
    return reply.code(401).send({ error: 'MCP token required' });
  }

  const token = await mcpTokensRepo.findActiveByRawToken(rawToken);
  if (!token) {
    return reply.code(403).send({ error: 'Invalid or revoked MCP token' });
  }

  // Fall back to createdAt so a freshly-issued token isn't compared against epoch 0.
  // Fail closed if neither timestamp is set: that row must have been written outside
  // createForUser (which always supplies createdAt) and shouldn't be trusted.
  const idleReference = token.lastUsedAt ?? token.createdAt;
  if (!idleReference || Date.now() - idleReference.getTime() > getMcpIdleTimeoutMs()) {
    return reply.code(403).send({ error: 'MCP token expired due to inactivity' });
  }

  const user = await usersRepo.findAuthUserById(token.userId);
  if (!user || user.isDisabled) {
    return reply.code(403).send({ error: 'Invalid or revoked MCP token' });
  }

  if (user.tokenVersion !== token.tokenVersionAtIssue) {
    return reply
      .code(403)
      .send({ error: 'Invalid or revoked MCP token', errorCode: 'token_revoked' });
  }

  // Re-assert tokenVersion atomically with the final role-membership query so a
  // password rotation that commits between the initial user load and this check
  // still revokes the request.
  const [rolePermissions, hasRole] = await Promise.all([
    getRolePermissions(token.roleId),
    rolesRepo.userHasRole(user.id, token.roleId, {
      requireEnabledUser: true,
      expectedTokenVersion: token.tokenVersionAtIssue,
    }),
  ]);
  if (!hasRole) {
    return reply.code(403).send({ error: 'Invalid or revoked MCP token' });
  }

  // MCP itself always uses POST, so scope enforcement for tool calls remains in each tool.
  // When the same credential is forwarded to a REST route by the generic MCP gateway (or used
  // directly), fail closed for every unsafe HTTP method before an authenticate-only route can
  // mutate data without a verb-specific permission guard.
  if (
    token.scope === 'read_only' &&
    !isMcpProtocolRequest(request) &&
    !isReadOnlyHttpMethod(request.method)
  ) {
    return reply.code(403).send({ error: 'MCP token is read-only' });
  }

  const permissions = applyScope(rolePermissions, token.scope);

  const mcpUser: McpAuthenticatedUser = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: token.roleId,
    avatarInitials: user.avatarInitials,
    permissions,
  };

  request.user = mcpUser;
  request.auth = {
    userId: user.id,
    source: 'mcpToken',
    tokenScope: token.scope,
  };
  try {
    await mcpTokensRepo.touchLastUsed(token.id);
  } catch (err) {
    request.log?.warn({ err }, 'Failed to update MCP token last-used timestamp');
  }

  const authInfo: AuthInfo = {
    token: rawToken,
    clientId: user.id,
    scopes: permissions,
    extra: {
      clientIp: request.ip,
      user: mcpUser,
      tokenId: token.id,
      tokenName: token.name,
      tokenScope: token.scope,
    } satisfies McpAuthInfoExtra,
  };

  (request.raw as typeof request.raw & { auth?: AuthInfo }).auth = authInfo;
};
