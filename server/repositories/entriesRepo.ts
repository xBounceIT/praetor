import { and, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { timeEntries } from '../db/schema/timeEntries.ts';
import { computeEntryCost } from '../utils/billing.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';
import { managedUserIdsSubquerySql } from './workUnitsRepo.ts';

export type TimeEntry = {
  id: string;
  userId: string;
  date: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  task: string;
  taskId: string | null;
  notes: string | null;
  duration: number;
  hourlyCost: number;
  // `cost` is computed on read as `duration * hourlyCost` (rounded to currency precision)
  // so retroactive `hourly_cost` changes never rewrite historical entry costs - the per-row
  // `hourly_cost` we already store on insert is the "as of the day the entry was logged"
  // rate that we want to preserve here.
  cost: number;
  isPlaceholder: boolean;
  location: string;
  createdAt: number;
  version: number;
};

// Snake-case row shape returned by raw-SQL `executeRows` paths. Carries the extra
// `created_at_text` column that the cursor pagination needs (see `ENTRY_COLUMNS_SQL`).
// `created_at` is nullable in the schema (DEFAULT but no NOT NULL); `created_at::text`
// is null too when the source column is.
type TimeEntryRow = {
  id: string;
  user_id: string;
  date: string | Date;
  client_id: string;
  client_name: string;
  project_id: string;
  project_name: string;
  task: string;
  task_id: string | null;
  notes: string | null;
  duration: string | number | null;
  hourly_cost: string | number | null;
  is_placeholder: boolean | null;
  location: string | null;
  created_at: string | Date | null;
  version: number | string | null;
  // Microsecond-precision text rep of created_at - pg returns TIMESTAMP as a JS Date (ms-only),
  // which would lose precision in the cursor and skip rows at page boundaries. Using ::text keeps
  // the full Postgres precision for cursor round-trips.
  created_at_text: string | null;
};

const ENTRY_COLUMNS_SQL = sql`id, user_id, date, client_id, client_name, project_id,
  project_name, task, task_id, notes, duration, hourly_cost, is_placeholder, location, created_at,
  version, created_at::text AS created_at_text`;

const mapRawRow = (row: TimeEntryRow): TimeEntry => {
  const date = normalizeNullableDateOnly(row.date, 'entry.date');
  if (!date) throw new TypeError('Invalid date value for entry.date');
  const duration = parseDbNumber(row.duration, 0);
  const hourlyCost = parseDbNumber(row.hourly_cost, 0);
  return {
    id: row.id,
    userId: row.user_id,
    date,
    clientId: row.client_id,
    clientName: row.client_name,
    projectId: row.project_id,
    projectName: row.project_name,
    task: row.task,
    taskId: row.task_id,
    notes: row.notes,
    duration,
    hourlyCost,
    cost: computeEntryCost(duration, hourlyCost),
    isPlaceholder: !!row.is_placeholder,
    location: row.location || 'remote',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    version: Number(row.version ?? 1),
  };
};

// Builder paths receive Drizzle's inferred camelCase row. Coercion is otherwise the
// same as `mapRawRow`. Two mappers (rather than one) avoid synthesizing a missing
// `created_at_text` for builder paths that never read it.
const mapBuilderRow = (row: typeof timeEntries.$inferSelect): TimeEntry => {
  const date = normalizeNullableDateOnly(row.date, 'entry.date');
  if (!date) throw new TypeError('Invalid date value for entry.date');
  const duration = parseDbNumber(row.duration, 0);
  const hourlyCost = parseDbNumber(row.hourlyCost, 0);
  return {
    id: row.id,
    userId: row.userId,
    date,
    clientId: row.clientId,
    clientName: row.clientName,
    projectId: row.projectId,
    projectName: row.projectName,
    task: row.task,
    taskId: row.taskId,
    notes: row.notes,
    duration,
    hourlyCost,
    cost: computeEntryCost(duration, hourlyCost),
    isPlaceholder: !!row.isPlaceholder,
    location: row.location || 'remote',
    createdAt: row.createdAt?.getTime() ?? 0,
    version: row.version ?? 1,
  };
};

// `createdAt` is an opaque µs-precision Postgres TIMESTAMP text (e.g. "2026-04-30 12:00:00.123456")
// rather than ms - the JS Date round-trip would truncate to ms and skip rows whose actual
// timestamp falls between the truncated ms and the µs value when paginating.
export type EntriesCursor = { createdAt: string; id: string };

export type ListEntriesOptions = {
  /** Default 200, hard-capped at 500. */
  limit?: number;
  /** Exclusive - return rows strictly older than this position. */
  cursor?: EntriesCursor;
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const resolveLimit = (limit?: number): number => {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
};

const cursorClause = (cursor: EntriesCursor | undefined): SQL | null =>
  cursor ? sql`(created_at, id) < (${cursor.createdAt}::timestamp, ${cursor.id})` : null;

export type ListEntriesResult = {
  entries: TimeEntry[];
  nextCursor: EntriesCursor | null;
};

const buildResult = (rows: TimeEntryRow[], limit: number): ListEntriesResult => {
  const entries = rows.map(mapRawRow);
  const lastRow = rows[rows.length - 1];
  // `created_at` is nullable in the schema, so `created_at::text` can also be null on rows
  // inserted before the DEFAULT was added. Skip the cursor in that case so we don't emit a
  // malformed `{createdAt: null, id}` payload (`EntriesCursor.createdAt: string`).
  const nextCursor =
    entries.length === limit && lastRow && lastRow.created_at_text
      ? { createdAt: lastRow.created_at_text, id: lastRow.id }
      : null;
  return { entries, nextCursor };
};

const joinAnd = (clauses: Array<SQL | null>): SQL | null => {
  const filtered = clauses.filter((c): c is SQL => c !== null);
  if (filtered.length === 0) return null;
  return sql.join(filtered, sql` AND `);
};

export const listAll = async (
  options: ListEntriesOptions = {},
  exec: DbExecutor = db,
): Promise<ListEntriesResult> => {
  const limit = resolveLimit(options.limit);
  const where = cursorClause(options.cursor);
  const rows = await executeRows<TimeEntryRow>(
    exec,
    sql`SELECT ${ENTRY_COLUMNS_SQL} FROM time_entries${where ? sql` WHERE ${where}` : sql``} ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
  );
  return buildResult(rows, limit);
};

export const listForUser = async (
  userId: string,
  options: ListEntriesOptions = {},
  exec: DbExecutor = db,
): Promise<ListEntriesResult> => {
  const limit = resolveLimit(options.limit);
  const where = joinAnd([sql`user_id = ${userId}`, cursorClause(options.cursor)]);
  const rows = await executeRows<TimeEntryRow>(
    exec,
    sql`SELECT ${ENTRY_COLUMNS_SQL} FROM time_entries WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
  );
  return buildResult(rows, limit);
};

export const listForManagerView = async (
  managerId: string,
  options: ListEntriesOptions = {},
  exec: DbExecutor = db,
): Promise<ListEntriesResult> => {
  const limit = resolveLimit(options.limit);
  const managerScope = sql`(user_id = ${managerId} OR user_id IN (${managedUserIdsSubquerySql(managerId)}))`;
  const where = joinAnd([managerScope, cursorClause(options.cursor)]);
  const rows = await executeRows<TimeEntryRow>(
    exec,
    sql`SELECT ${ENTRY_COLUMNS_SQL} FROM time_entries WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
  );
  return buildResult(rows, limit);
};

export const encodeCursor = (cursor: EntriesCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export const decodeCursor = (raw: string): EntriesCursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as EntriesCursor).createdAt === 'string' &&
      typeof (parsed as EntriesCursor).id === 'string'
    ) {
      return parsed as EntriesCursor;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Returns the set of `${date}|${projectId}|${task}` keys for entries owned by `userId`
 * whose date falls in [fromDate, toDate] inclusive. Used by the recurring-entry generator
 * to skip days that already have a matching entry (idempotent runs).
 */
export const findExistingRecurringKeys = async (
  userId: string,
  fromDate: string,
  toDate: string,
  exec: DbExecutor = db,
): Promise<Set<string>> => {
  const rows = await exec
    .select({
      date: timeEntries.date,
      projectId: timeEntries.projectId,
      task: timeEntries.task,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        gte(timeEntries.date, fromDate),
        lte(timeEntries.date, toDate),
      ),
    );
  return new Set(rows.map((row) => `${row.date}|${row.projectId}|${row.task}`));
};

export const findOwner = async (id: string, exec: DbExecutor = db): Promise<string | null> => {
  const rows = await exec
    .select({ userId: timeEntries.userId })
    .from(timeEntries)
    .where(eq(timeEntries.id, id));
  return rows[0]?.userId ?? null;
};

export type EntryContext = {
  userId: string;
  date: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  task: string;
  taskId: string | null;
};

export const findContext = async (
  id: string,
  exec: DbExecutor = db,
): Promise<EntryContext | null> => {
  const rows = await exec
    .select({
      userId: timeEntries.userId,
      date: timeEntries.date,
      clientId: timeEntries.clientId,
      clientName: timeEntries.clientName,
      projectId: timeEntries.projectId,
      projectName: timeEntries.projectName,
      task: timeEntries.task,
      taskId: timeEntries.taskId,
    })
    .from(timeEntries)
    .where(eq(timeEntries.id, id));
  const row = rows[0];
  if (!row) return null;
  const date = normalizeNullableDateOnly(row.date, 'entry.date');
  if (!date) throw new TypeError('Invalid date value for entry.date');
  return { ...row, date };
};

export type NewEntry = {
  id: string;
  userId: string;
  date: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  task: string;
  taskId: string | null;
  notes: string | null;
  duration: number;
  hourlyCost: number;
  isPlaceholder: boolean;
  location: string;
};

export const create = async (entry: NewEntry, exec: DbExecutor = db): Promise<TimeEntry> => {
  const [row] = await exec
    .insert(timeEntries)
    .values({
      id: entry.id,
      userId: entry.userId,
      date: entry.date,
      clientId: entry.clientId,
      clientName: entry.clientName,
      projectId: entry.projectId,
      projectName: entry.projectName,
      task: entry.task,
      taskId: entry.taskId,
      notes: entry.notes,
      duration: numericForDb(entry.duration),
      hourlyCost: numericForDb(entry.hourlyCost),
      isPlaceholder: entry.isPlaceholder,
      location: entry.location,
    })
    .returning();
  return mapBuilderRow(row);
};

// Postgres caps bind parameters at 65,535 per statement. With 14 columns per row a single
// INSERT can safely carry ~4,600 rows; we chunk at 1,000 for a comfortable margin and to
// keep individual statements bounded in size.
const CREATE_MANY_CHUNK_SIZE = 1000;

/**
 * Bulk insert variant used by the recurring-entry generator. Returns the inserted rows in
 * the same order they were supplied. Empty input is a no-op.
 */
export const createMany = async (
  entries: NewEntry[],
  exec: DbExecutor = db,
): Promise<TimeEntry[]> => {
  if (entries.length === 0) return [];
  const result: TimeEntry[] = [];
  for (let i = 0; i < entries.length; i += CREATE_MANY_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CREATE_MANY_CHUNK_SIZE);
    const rows = await exec
      .insert(timeEntries)
      .values(
        chunk.map((entry) => ({
          id: entry.id,
          userId: entry.userId,
          date: entry.date,
          clientId: entry.clientId,
          clientName: entry.clientName,
          projectId: entry.projectId,
          projectName: entry.projectName,
          task: entry.task,
          taskId: entry.taskId,
          notes: entry.notes,
          duration: numericForDb(entry.duration),
          hourlyCost: numericForDb(entry.hourlyCost),
          isPlaceholder: entry.isPlaceholder,
          location: entry.location,
        })),
      )
      .returning();
    for (const row of rows) result.push(mapBuilderRow(row));
  }
  return result;
};

export type EntryUpdate = {
  version: number;
  date?: string;
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  task?: string;
  duration?: number;
  /** `null` clears the column (the schema allows NULL); `undefined` leaves it untouched. */
  notes?: string | null;
  isPlaceholder?: boolean;
  location?: string;
  /**
   * `null` clears the column (orphan a legacy entry), `string` writes the resolved task FK,
   * `undefined` leaves it untouched.
   */
  taskId?: string | null;
};

export const update = async (
  id: string,
  patch: EntryUpdate,
  exec: DbExecutor = db,
): Promise<TimeEntry | null> => {
  const setValues: Partial<typeof timeEntries.$inferInsert> = {};
  if (patch.date !== undefined) setValues.date = patch.date;
  if (patch.clientId !== undefined) setValues.clientId = patch.clientId;
  if (patch.clientName !== undefined) setValues.clientName = patch.clientName;
  if (patch.projectId !== undefined) setValues.projectId = patch.projectId;
  if (patch.projectName !== undefined) setValues.projectName = patch.projectName;
  if (patch.task !== undefined) setValues.task = patch.task;
  if (patch.duration !== undefined) setValues.duration = numericForDb(patch.duration);
  if (patch.notes !== undefined) setValues.notes = patch.notes;
  if (patch.isPlaceholder !== undefined) setValues.isPlaceholder = patch.isPlaceholder;
  if (patch.location !== undefined) setValues.location = patch.location;
  if (patch.taskId !== undefined) setValues.taskId = patch.taskId;

  if (Object.keys(setValues).length === 0) {
    const [row] = await exec
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.version, patch.version)));
    return row ? mapBuilderRow(row) : null;
  }

  const [row] = await exec
    .update(timeEntries)
    .set({ ...setValues, version: sql`${timeEntries.version} + 1` })
    .where(and(eq(timeEntries.id, id), eq(timeEntries.version, patch.version)))
    .returning();
  return row ? mapBuilderRow(row) : null;
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<void> => {
  await exec.delete(timeEntries).where(eq(timeEntries.id, id));
};

export type BulkDeleteFilters = {
  projectId: string;
  task: string;
  /** When set, restrict to the user's own entries plus their managed users'. */
  restrictToManagerScopeOf?: string;
  /** When set, only delete entries on or after this date (YYYY-MM-DD). */
  fromDate?: string;
  placeholderOnly?: boolean;
};

export const bulkDelete = async (
  filters: BulkDeleteFilters,
  exec: DbExecutor = db,
): Promise<number> => {
  const conditions: SQL[] = [
    eq(timeEntries.projectId, filters.projectId),
    eq(timeEntries.task, filters.task),
  ];
  if (filters.restrictToManagerScopeOf) {
    const managerId = filters.restrictToManagerScopeOf;
    conditions.push(
      sql`(user_id = ${managerId} OR user_id IN (${managedUserIdsSubquerySql(managerId)}))`,
    );
  }
  if (filters.fromDate) {
    conditions.push(gte(timeEntries.date, filters.fromDate));
  }
  if (filters.placeholderOnly === true) {
    conditions.push(eq(timeEntries.isPlaceholder, true));
  }
  const result = await exec.delete(timeEntries).where(and(...conditions));
  return result.rowCount ?? 0;
};
