import pool, { type QueryExecutor } from '../db/index.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { parseDbNumber } from '../utils/parse.ts';
import { managedUserIdsSubquery } from './workUnitsRepo.ts';

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
  isPlaceholder: boolean;
  location: string;
  createdAt: number;
};

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
  created_at: string | Date;
};

const ENTRY_COLUMNS = `id, user_id, date, client_id, client_name, project_id,
  project_name, task, task_id, notes, duration, hourly_cost, is_placeholder, location, created_at`;

const mapRow = (row: TimeEntryRow): TimeEntry => {
  const date = normalizeNullableDateOnly(row.date, 'entry.date');
  if (!date) throw new TypeError('Invalid date value for entry.date');
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
    duration: parseDbNumber(row.duration, 0),
    hourlyCost: parseDbNumber(row.hourly_cost, 0),
    isPlaceholder: !!row.is_placeholder,
    location: row.location || 'remote',
    createdAt: new Date(row.created_at).getTime(),
  };
};

export type EntriesCursor = { createdAt: number; id: string };

export type ListEntriesOptions = {
  /** Default 200, hard-capped at 500. */
  limit?: number;
  /** Exclusive — return rows strictly older than this position. */
  cursor?: EntriesCursor;
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const resolveLimit = (limit?: number): number => {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
};

const buildCursorClause = (cursor: EntriesCursor | undefined, startIdx: number) => {
  if (!cursor) return { sql: '', params: [], nextIdx: startIdx };
  const sql = `(created_at, id) < (to_timestamp($${startIdx} / 1000.0), $${startIdx + 1})`;
  return { sql, params: [cursor.createdAt, cursor.id], nextIdx: startIdx + 2 };
};

export type ListEntriesResult = {
  entries: TimeEntry[];
  nextCursor: EntriesCursor | null;
};

const buildResult = (rows: TimeEntryRow[], limit: number): ListEntriesResult => {
  const entries = rows.map(mapRow);
  const nextCursor =
    entries.length === limit
      ? { createdAt: entries[entries.length - 1].createdAt, id: entries[entries.length - 1].id }
      : null;
  return { entries, nextCursor };
};

export const listAll = async (
  options: ListEntriesOptions = {},
  exec: QueryExecutor = pool,
): Promise<ListEntriesResult> => {
  const limit = resolveLimit(options.limit);
  const cursor = buildCursorClause(options.cursor, 1);
  const where = cursor.sql ? `WHERE ${cursor.sql}` : '';
  const { rows } = await exec.query<TimeEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM time_entries ${where} ORDER BY created_at DESC, id DESC LIMIT $${cursor.nextIdx}`,
    [...cursor.params, limit],
  );
  return buildResult(rows, limit);
};

export const listForUser = async (
  userId: string,
  options: ListEntriesOptions = {},
  exec: QueryExecutor = pool,
): Promise<ListEntriesResult> => {
  const limit = resolveLimit(options.limit);
  const cursor = buildCursorClause(options.cursor, 2);
  const cursorClause = cursor.sql ? ` AND ${cursor.sql}` : '';
  const { rows } = await exec.query<TimeEntryRow>(
    `SELECT ${ENTRY_COLUMNS}
       FROM time_entries
      WHERE user_id = $1${cursorClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${cursor.nextIdx}`,
    [userId, ...cursor.params, limit],
  );
  return buildResult(rows, limit);
};

export const listForManagerView = async (
  managerId: string,
  options: ListEntriesOptions = {},
  exec: QueryExecutor = pool,
): Promise<ListEntriesResult> => {
  const limit = resolveLimit(options.limit);
  const cursor = buildCursorClause(options.cursor, 2);
  const cursorClause = cursor.sql ? ` AND ${cursor.sql}` : '';
  const { rows } = await exec.query<TimeEntryRow>(
    `SELECT ${ENTRY_COLUMNS}
       FROM time_entries
      WHERE (user_id = $1 OR user_id IN (${managedUserIdsSubquery(1)}))${cursorClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${cursor.nextIdx}`,
    [managerId, ...cursor.params, limit],
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
      typeof (parsed as EntriesCursor).createdAt === 'number' &&
      typeof (parsed as EntriesCursor).id === 'string'
    ) {
      return parsed as EntriesCursor;
    }
    return null;
  } catch {
    return null;
  }
};

export const findOwner = async (id: string, exec: QueryExecutor = pool): Promise<string | null> => {
  const { rows } = await exec.query<{ user_id: string }>(
    `SELECT user_id FROM time_entries WHERE id = $1`,
    [id],
  );
  return rows[0]?.user_id ?? null;
};

export type EntryContext = {
  userId: string;
  projectId: string;
  task: string;
  taskId: string | null;
};

export const findContext = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<EntryContext | null> => {
  const { rows } = await exec.query<{
    user_id: string;
    project_id: string;
    task: string;
    task_id: string | null;
  }>(`SELECT user_id, project_id, task, task_id FROM time_entries WHERE id = $1`, [id]);
  if (!rows[0]) return null;
  return {
    userId: rows[0].user_id,
    projectId: rows[0].project_id,
    task: rows[0].task,
    taskId: rows[0].task_id,
  };
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

export const create = async (entry: NewEntry, exec: QueryExecutor = pool): Promise<TimeEntry> => {
  const { rows } = await exec.query<TimeEntryRow>(
    `INSERT INTO time_entries (id, user_id, date, client_id, client_name, project_id, project_name, task, task_id, notes, duration, hourly_cost, is_placeholder, location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING ${ENTRY_COLUMNS}`,
    [
      entry.id,
      entry.userId,
      entry.date,
      entry.clientId,
      entry.clientName,
      entry.projectId,
      entry.projectName,
      entry.task,
      entry.taskId,
      entry.notes,
      entry.duration,
      entry.hourlyCost,
      entry.isPlaceholder,
      entry.location,
    ],
  );
  return mapRow(rows[0]);
};

export type EntryUpdate = {
  duration?: number;
  /** `null` clears the column (the schema allows NULL); `undefined` leaves it untouched. */
  notes?: string | null;
  isPlaceholder?: boolean;
  location?: string;
  /** Backfill-only: pass the resolved task FK on legacy rows. `undefined` leaves it untouched. */
  taskId?: string;
};

export const update = async (
  id: string,
  patch: EntryUpdate,
  exec: QueryExecutor = pool,
): Promise<TimeEntry | null> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  const fields: Array<[string, unknown]> = [
    ['duration', patch.duration],
    ['notes', patch.notes],
    ['is_placeholder', patch.isPlaceholder],
    ['location', patch.location],
    ['task_id', patch.taskId],
  ];
  for (const [col, value] of fields) {
    if (value !== undefined) {
      sets.push(`${col} = $${idx++}`);
      params.push(value);
    }
  }

  if (sets.length === 0) {
    const { rows } = await exec.query<TimeEntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM time_entries WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  params.push(id);
  const { rows } = await exec.query<TimeEntryRow>(
    `UPDATE time_entries SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${ENTRY_COLUMNS}`,
    params,
  );
  return rows[0] ? mapRow(rows[0]) : null;
};

export const deleteById = async (id: string, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(`DELETE FROM time_entries WHERE id = $1`, [id]);
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
  exec: QueryExecutor = pool,
): Promise<number> => {
  let sql = 'DELETE FROM time_entries WHERE project_id = $1 AND task = $2';
  const params: unknown[] = [filters.projectId, filters.task];
  let idx = 3;

  if (filters.restrictToManagerScopeOf) {
    sql += ` AND (user_id = $${idx} OR user_id IN (${managedUserIdsSubquery(idx)}))`;
    params.push(filters.restrictToManagerScopeOf);
    idx++;
  }

  if (filters.fromDate) {
    sql += ` AND date >= $${idx++}`;
    params.push(filters.fromDate);
  }

  if (filters.placeholderOnly === true) {
    sql += ' AND is_placeholder = true';
  }

  const result = await exec.query(sql, params);
  return result.rowCount ?? 0;
};
