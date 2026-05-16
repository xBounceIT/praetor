import crypto from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { type McpTokenScope, mcpTokens } from '../db/schema/mcpTokens.ts';
import { getHmacKey } from '../utils/crypto.ts';
import { currentTokenVersionSubquery } from './usersRepo.ts';

export const MCP_TOKEN_PREFIX = 'praetor_mcp_';

export const MCP_TOKEN_SCOPES: readonly McpTokenScope[] = ['read_only', 'full'] as const;
export type { McpTokenScope };

export type McpTokenSummary = {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: McpTokenScope;
  createdAt: number;
  lastUsedAt: number | null;
};

export type ActiveMcpToken = {
  id: string;
  userId: string;
  name: string;
  scope: McpTokenScope;
  createdAt: Date | null;
  lastUsedAt: Date | null;
  tokenVersionAtIssue: number;
};

export const generateRawToken = (): string =>
  `${MCP_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;

export const hashToken = (rawToken: string): string =>
  crypto.createHmac('sha256', getHmacKey()).update(rawToken).digest('hex');

const displayPrefix = (rawToken: string): string => rawToken.slice(0, 24);

const mapSummary = (row: typeof mcpTokens.$inferSelect): McpTokenSummary => ({
  id: row.id,
  name: row.name,
  tokenPrefix: row.tokenPrefix,
  scope: row.scope,
  createdAt: row.createdAt?.getTime() ?? 0,
  lastUsedAt: row.lastUsedAt?.getTime() ?? null,
});

export const listForUser = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<McpTokenSummary[]> => {
  const rows = await exec
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)))
    .orderBy(desc(mcpTokens.createdAt));
  return rows.map(mapSummary);
};

export const createForUser = async (
  input: {
    id: string;
    userId: string;
    name: string;
    rawToken: string;
    scope?: McpTokenScope;
  },
  exec: DbExecutor = db,
): Promise<McpTokenSummary> => {
  const [row] = await exec
    .insert(mcpTokens)
    .values({
      id: input.id,
      userId: input.userId,
      name: input.name,
      tokenPrefix: displayPrefix(input.rawToken),
      tokenHash: hashToken(input.rawToken),
      scope: input.scope ?? 'full',
      tokenVersionAtIssue: currentTokenVersionSubquery(input.userId),
    })
    .returning();
  return mapSummary(row);
};

export const findActiveByRawToken = async (
  rawToken: string,
  exec: DbExecutor = db,
): Promise<ActiveMcpToken | null> => {
  if (!rawToken.startsWith(MCP_TOKEN_PREFIX)) return null;
  const rows = await exec
    .select({
      id: mcpTokens.id,
      userId: mcpTokens.userId,
      name: mcpTokens.name,
      scope: mcpTokens.scope,
      createdAt: mcpTokens.createdAt,
      lastUsedAt: mcpTokens.lastUsedAt,
      tokenVersionAtIssue: mcpTokens.tokenVersionAtIssue,
    })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.tokenHash, hashToken(rawToken)), isNull(mcpTokens.revokedAt)))
    .limit(1);
  return rows[0] ?? null;
};

export const touchLastUsed = async (id: string, exec: DbExecutor = db): Promise<void> => {
  await exec
    .update(mcpTokens)
    .set({ lastUsedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(mcpTokens.id, id));
};

export const revokeForUser = async (
  id: string,
  userId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const result = await exec
    .update(mcpTokens)
    .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)));
  return (result.rowCount ?? 0) > 0;
};
