import pool, { type QueryExecutor } from '../db/index.ts';

export const DEFAULT_CHAT_TITLE = 'AI Reporting';
export const RPT_CHAT_ID_PREFIX = 'rpt-chat';
export const RPT_MSG_ID_PREFIX = 'rpt-msg';

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
  exec: QueryExecutor = pool,
): Promise<ChatSessionSummary[]> => {
  const { rows } = await exec.query<ChatSessionSummary>(
    `SELECT
        id,
        COALESCE(title, '') as title,
        (EXTRACT(EPOCH FROM created_at) * 1000)::float8 as "createdAt",
        (EXTRACT(EPOCH FROM updated_at) * 1000)::float8 as "updatedAt"
       FROM report_chat_sessions
      WHERE user_id = $1 AND is_archived = FALSE
      ORDER BY updated_at DESC
      LIMIT 50`,
    [userId],
  );
  return rows;
};

export const createSession = async (
  id: string,
  userId: string,
  title: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `INSERT INTO report_chat_sessions (id, user_id, title, is_archived, created_at, updated_at)
     VALUES ($1, $2, $3, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, userId, title],
  );
};

export const archiveSession = async (
  id: string,
  userId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rowCount } = await exec.query(
    `UPDATE report_chat_sessions
        SET is_archived = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
};

export const sessionExistsForUser = async (
  id: string,
  userId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rowCount } = await exec.query(
    `SELECT 1 FROM report_chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
};

export const findActiveSessionForUser = async (
  id: string,
  userId: string,
  exec: QueryExecutor = pool,
): Promise<{ title: string } | null> => {
  const { rows } = await exec.query<{ title: string }>(
    `SELECT COALESCE(title, '') as title
       FROM report_chat_sessions
      WHERE id = $1 AND user_id = $2 AND is_archived = FALSE
      LIMIT 1`,
    [id, userId],
  );
  return rows[0] ?? null;
};

export const updateSessionTitleAndTouch = async (
  id: string,
  userId: string,
  candidateTitle: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `UPDATE report_chat_sessions
        SET updated_at = CURRENT_TIMESTAMP,
            title = CASE
              WHEN BTRIM(title) = '' OR title = $4 THEN LEFT($2, 80)
              ELSE title
            END
      WHERE id = $1 AND user_id = $3`,
    [id, candidateTitle, userId, DEFAULT_CHAT_TITLE],
  );
};

export const touchSession = async (
  id: string,
  userId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `UPDATE report_chat_sessions
        SET updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
};

export const listMessagesForSession = async (
  sessionId: string,
  options: { beforeMs: number | null; limit: number },
  exec: QueryExecutor = pool,
): Promise<ChatMessage[]> => {
  const { beforeMs, limit } = options;
  const { rows } =
    beforeMs == null
      ? await exec.query<ChatMessage>(
          `SELECT
              id,
              session_id as "sessionId",
              role,
              content,
              thought_content as "thoughtContent",
              (EXTRACT(EPOCH FROM created_at) * 1000)::float8 as "createdAt"
            FROM report_chat_messages
           WHERE session_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [sessionId, limit],
        )
      : await exec.query<ChatMessage>(
          `SELECT
              id,
              session_id as "sessionId",
              role,
              content,
              thought_content as "thoughtContent",
              (EXTRACT(EPOCH FROM created_at) * 1000)::float8 as "createdAt"
            FROM report_chat_messages
           WHERE session_id = $1
             AND created_at < TO_TIMESTAMP($2 / 1000.0)
           ORDER BY created_at DESC
           LIMIT $3`,
          [sessionId, beforeMs, limit],
        );
  return rows.map((r) => ({
    id: String(r.id),
    sessionId: String(r.sessionId),
    role: String(r.role),
    content: String(r.content || ''),
    thoughtContent: r.thoughtContent ? String(r.thoughtContent) : null,
    createdAt: r.createdAt,
  }));
};

export type RecentMessageOptions = { limit?: number; beforeOrAt?: Date };

export const listRecentMessages = async (
  sessionId: string,
  options: RecentMessageOptions = {},
  exec: QueryExecutor = pool,
): Promise<ConversationTurn[]> => {
  const limit = options.limit ?? 20;
  if (options.beforeOrAt) {
    const { rows } = await exec.query<ConversationTurn>(
      `SELECT role, content
         FROM report_chat_messages
        WHERE session_id = $1
          AND created_at <= $2
        ORDER BY created_at DESC
        LIMIT $3`,
      [sessionId, options.beforeOrAt, limit],
    );
    return rows;
  }
  const { rows } = await exec.query<ConversationTurn>(
    `SELECT role, content
       FROM report_chat_messages
      WHERE session_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [sessionId, limit],
  );
  return rows;
};

export const insertUserMessage = async (
  id: string,
  sessionId: string,
  content: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `INSERT INTO report_chat_messages (id, session_id, role, content, created_at)
     VALUES ($1, $2, 'user', $3, CURRENT_TIMESTAMP)`,
    [id, sessionId, content],
  );
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
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `INSERT INTO report_chat_messages (id, session_id, role, content, thought_content, created_at)
     VALUES ($1, $2, 'assistant', $3, $4, COALESCE($5::timestamptz, CURRENT_TIMESTAMP))`,
    [input.id, input.sessionId, input.content, input.thoughtContent, input.createdAt ?? null],
  );
};

export const findUserMessage = async (
  messageId: string,
  sessionId: string,
  exec: QueryExecutor = pool,
): Promise<ChatMessageRef | null> => {
  const { rows } = await exec.query<ChatMessageRef>(
    `SELECT id, created_at as "createdAt"
       FROM report_chat_messages
      WHERE id = $1 AND session_id = $2 AND role = 'user'
      LIMIT 1`,
    [messageId, sessionId],
  );
  return rows[0] ?? null;
};

export const findFirstAssistantAfter = async (
  sessionId: string,
  afterDate: Date,
  exec: QueryExecutor = pool,
): Promise<ChatMessageRef | null> => {
  const { rows } = await exec.query<ChatMessageRef>(
    `SELECT id, created_at as "createdAt"
       FROM report_chat_messages
      WHERE session_id = $1 AND role = 'assistant'
        AND created_at > $2
      ORDER BY created_at ASC
      LIMIT 1`,
    [sessionId, afterDate],
  );
  return rows[0] ?? null;
};

export const deleteMessage = async (id: string, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(`DELETE FROM report_chat_messages WHERE id = $1`, [id]);
};

export const updateMessageContent = async (
  id: string,
  content: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`UPDATE report_chat_messages SET content = $1 WHERE id = $2`, [content, id]);
};

export const getFirstUserMessageContent = async (
  sessionId: string,
  exec: QueryExecutor = pool,
): Promise<string> => {
  const { rows } = await exec.query<{ content: string }>(
    `SELECT COALESCE(content, '') as content
       FROM report_chat_messages
      WHERE session_id = $1 AND role = 'user'
      ORDER BY created_at ASC
      LIMIT 1`,
    [sessionId],
  );
  return rows[0]?.content ?? '';
};
