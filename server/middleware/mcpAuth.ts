import type { AuthInfo } from '@modelcontextprotocol/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import * as mcpTokensRepo from '../repositories/mcpTokensRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { getRolePermissions } from '../utils/permissions.ts';

export type McpAuthenticatedUser = {
  id: string;
  name: string;
  username: string;
  role: string;
  avatarInitials: string;
  permissions: string[];
};

export type McpAuthInfoExtra = {
  user: McpAuthenticatedUser;
  tokenId: string;
  tokenName: string;
};

const parseBearerToken = (request: FastifyRequest): string | null => {
  const authHeader = request.headers.authorization;
  const [scheme, token] = String(authHeader || '').split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
};

export const authenticateMcpToken = async (request: FastifyRequest, reply: FastifyReply) => {
  const rawToken = parseBearerToken(request);
  if (!rawToken?.startsWith(mcpTokensRepo.MCP_TOKEN_PREFIX)) {
    return reply.code(401).send({ error: 'MCP token required' });
  }

  const token = await mcpTokensRepo.findActiveByRawToken(rawToken);
  if (!token) {
    return reply.code(403).send({ error: 'Invalid or revoked MCP token' });
  }

  const user = await usersRepo.findAuthUserById(token.userId);
  if (!user || user.isDisabled) {
    return reply.code(403).send({ error: 'Invalid or revoked MCP token' });
  }

  const [hasRole, permissions] = await Promise.all([
    rolesRepo.userHasRole(user.id, user.role),
    getRolePermissions(user.role),
  ]);
  if (!hasRole) {
    return reply.code(403).send({ error: 'Invalid or revoked MCP token' });
  }

  const mcpUser: McpAuthenticatedUser = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    avatarInitials: user.avatarInitials,
    permissions,
  };

  request.user = mcpUser;
  request.auth = { userId: user.id, sessionStart: Date.now() };
  await mcpTokensRepo.touchLastUsed(token.id);

  const authInfo: AuthInfo = {
    token: rawToken,
    clientId: user.id,
    scopes: permissions,
    extra: {
      user: mcpUser,
      tokenId: token.id,
      tokenName: token.name,
    } satisfies McpAuthInfoExtra,
  };

  (request.raw as typeof request.raw & { auth?: AuthInfo }).auth = authInfo;
};
