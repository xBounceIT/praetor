import { and, asc, desc, eq, gt, lt, lte, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { reportChatMessages } from '../db/schema/reportChatMessages.ts';
import { reportChatSessions } from '../db/schema/reportChatSessions.ts';

export const DEFAULT_CHAT_TITLE = 'AI Reporting';
export const RPT_CHAT_ID_PREFIX = 'rpt-chat';
export const RPT_MSG_ID_PREFIX = 'rpt-msg';

// Mirrors the DB-side CHECK (role IN ('user', 'assistant')) on report_chat_messages.role.
export const CHAT_ROLE = { user: 'user', assistant: 'assistant' } as const;
export type ChatRole = (typeof CHAT_ROLE)[keyof typeof CHAT_ROLE];

export type ChatSessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  thoughtContent: string | null;
  createdAt: number;
};

export type ConversationTurn = {
  role: string;
  content: string;
};

export type ChatMessageRef = {
  id: string;
  createdAt: Date;
};

export const listSessionsForUser = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<ChatSessionSummary[]> => {
  const rows = await exec
    .select({
      id: reportChatSessions.id,
      title: reportChatSessions.title,
      createdAt: reportChatSessions.createdAt,
      updatedAt: reportChatSessions.updatedAt,
    })
    .from(reportChatSessions)
    .where(and(eq(reportChatSessions.userId, userId), eq(reportChatSessions.isArchived, false)))
    .orderBy(desc(reportChatSessions.updatedAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    // `created_at`/`updated_at` are nullable in the schema but have DEFAULT
    // CURRENT_TIMESTAMP — `?? 0` is a TS-strict appeasement for the unreachable branch.
    createdAt: r.createdAt?.getTime() ?? 0,
    updatedAt: r.updatedAt?.getTime() ?? 0,
  }));
};

export const createSession = async (
  id: string,
  userId: string,
  title: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.insert(reportChatSessions).values({
    id,
    userId,
    title,
    isArchived: false,
  });
};

export const archiveSession = async (
  id: string,
  userId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const result = await exec
    .update(reportChatSessions)
    .set({ isArchived: true, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(reportChatSessions.id, id), eq(reportChatSessions.userId, userId)));
  return (result.rowCount ?? 0) > 0;
};

export const sessionExistsForUser = async (
  id: string,
  userId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const result = await exec
    .select({ exists: sql`1` })
    .from(reportChatSessions)
    .where(and(eq(reportChatSessions.id, id), eq(reportChatSessions.userId, userId)))
    .limit(1);
  return result.length > 0;
};

export const getActiveSessionForUser = async (
  id: string,
  userId: string,
  exec: DbExecutor = db,
): Promise<{ title: string } | null> => {
  const rows = await exec
    .select({ title: reportChatSessions.title })
    .from(reportChatSessions)
    .where(
      and(
        eq(reportChatSessions.id, id),
        eq(reportChatSessions.userId, userId),
        eq(reportChatSessions.isArchived, false),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { title: row.title };
};

export const updateSessionTitleAndTouch = async (
  id: string,
  userId: string,
  candidateTitle: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .update(reportChatSessions)
    .set({
      updatedAt: sql`CURRENT_TIMESTAMP`,
      // Only overwrite the title when it's blank or still the default — preserves any
      // user-edited title across re-sends.
      title: sql`CASE
        WHEN BTRIM(${reportChatSessions.title}) = '' OR ${reportChatSessions.title} = ${DEFAULT_CHAT_TITLE}
        THEN LEFT(${candidateTitle}, 80)
        ELSE ${reportChatSessions.title}
      END`,
    })
    .where(and(eq(reportChatSessions.id, id), eq(reportChatSessions.userId, userId)));
};

export const touchSession = async (
  id: string,
  userId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .update(reportChatSessions)
    .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(reportChatSessions.id, id), eq(reportChatSessions.userId, userId)));
};

export const listMessagesForSession = async (
  sessionId: string,
  options: { beforeMs: number | null; limit: number },
  exec: DbExecutor = db,
): Promise<ChatMessage[]> => {
  const { beforeMs, limit } = options;
  const where =
    beforeMs == null
      ? eq(reportChatMessages.sessionId, sessionId)
      : and(
          eq(reportChatMessages.sessionId, sessionId),
          lt(reportChatMessages.createdAt, sql`TO_TIMESTAMP(${beforeMs} / 1000.0)`),
        );
  const rows = await exec
    .select({
      id: reportChatMessages.id,
      sessionId: reportChatMessages.sessionId,
      role: reportChatMessages.role,
      content: reportChatMessages.content,
      thoughtContent: reportChatMessages.thoughtContent,
      createdAt: reportChatMessages.createdAt,
    })
    .from(reportChatMessages)
    .where(where)
    .orderBy(desc(reportChatMessages.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    role: r.role,
    content: r.content,
    thoughtContent: r.thoughtContent || null,
    // `created_at` is nullable in the schema but has DEFAULT CURRENT_TIMESTAMP —
    // `?? 0` is a TS-strict appeasement for the unreachable branch.
    createdAt: r.createdAt?.getTime() ?? 0,
  }));
};

export type RecentMessageOptions = { limit?: number; beforeOrAt?: Date };

export const listRecentMessages = async (
  sessionId: string,
  options: RecentMessageOptions = {},
  exec: DbExecutor = db,
): Promise<ConversationTurn[]> => {
  const limit = options.limit ?? 20;
  const where = options.beforeOrAt
    ? and(
        eq(reportChatMessages.sessionId, sessionId),
        lte(reportChatMessages.createdAt, options.beforeOrAt),
      )
    : eq(reportChatMessages.sessionId, sessionId);
  const rows = await exec
    .select({ role: reportChatMessages.role, content: reportChatMessages.content })
    .from(reportChatMessages)
    .where(where)
    .orderBy(desc(reportChatMessages.createdAt))
    .limit(limit);
  return rows.map((r) => ({ role: r.role, content: r.content }));
};

export const insertUserMessage = async (
  id: string,
  sessionId: string,
  content: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.insert(reportChatMessages).values({
    id,
    sessionId,
    role: CHAT_ROLE.user,
    content,
  });
};

export type InsertAssistantMessageInput = {
  id: string;
  sessionId: string;
  content: string;
  thoughtContent: string | null;
  createdAt?: Date | string;
};

export const insertAssistantMessage = async (
  input: InsertAssistantMessageInput,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.insert(reportChatMessages).values({
    id: input.id,
    sessionId: input.sessionId,
    role: CHAT_ROLE.assistant,
    content: input.content,
    thoughtContent: input.thoughtContent,
    ...(input.createdAt !== undefined ? { createdAt: new Date(input.createdAt) } : {}),
  });
};

export const findUserMessage = async (
  messageId: string,
  sessionId: string,
  exec: DbExecutor = db,
): Promise<ChatMessageRef | null> => {
  const rows = await exec
    .select({ id: reportChatMessages.id, createdAt: reportChatMessages.createdAt })
    .from(reportChatMessages)
    .where(
      and(
        eq(reportChatMessages.id, messageId),
        eq(reportChatMessages.sessionId, sessionId),
        eq(reportChatMessages.role, CHAT_ROLE.user),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row?.createdAt ? { id: row.id, createdAt: row.createdAt } : null;
};

export const findFirstAssistantAfter = async (
  sessionId: string,
  afterDate: Date,
  exec: DbExecutor = db,
): Promise<ChatMessageRef | null> => {
  const rows = await exec
    .select({ id: reportChatMessages.id, createdAt: reportChatMessages.createdAt })
    .from(reportChatMessages)
    .where(
      and(
        eq(reportChatMessages.sessionId, sessionId),
        eq(reportChatMessages.role, CHAT_ROLE.assistant),
        gt(reportChatMessages.createdAt, afterDate),
      ),
    )
    .orderBy(asc(reportChatMessages.createdAt))
    .limit(1);
  const row = rows[0];
  return row?.createdAt ? { id: row.id, createdAt: row.createdAt } : null;
};

export const deleteMessage = async (id: string, exec: DbExecutor = db): Promise<void> => {
  await exec.delete(reportChatMessages).where(eq(reportChatMessages.id, id));
};

export const updateMessageContent = async (
  id: string,
  content: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.update(reportChatMessages).set({ content }).where(eq(reportChatMessages.id, id));
};

export const getFirstUserMessageContent = async (
  sessionId: string,
  exec: DbExecutor = db,
): Promise<string> => {
  const rows = await exec
    .select({ content: reportChatMessages.content })
    .from(reportChatMessages)
    .where(
      and(eq(reportChatMessages.sessionId, sessionId), eq(reportChatMessages.role, CHAT_ROLE.user)),
    )
    .orderBy(asc(reportChatMessages.createdAt))
    .limit(1);
  return rows[0]?.content ?? '';
};
