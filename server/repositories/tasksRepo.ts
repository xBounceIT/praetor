import pool, { type QueryExecutor } from '../db/index.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { isForeignKeyViolation } from '../utils/db-errors.ts';
import { ForeignKeyError } from '../utils/http-errors.ts';
import { parseDbNumber } from '../utils/parse.ts';

export type Task = {
  id: string;
  name: string;
  projectId: string;
  description: string | null;
  isRecurring: boolean;
  recurrencePattern: string | null;
  recurrenceStart: string | undefined;
  recurrenceEnd: string | undefined;
  recurrenceDuration: number;
  expectedEffort: number | undefined;
  revenue: number | undefined;
  notes: string | undefined;
  isDisabled: boolean;
};

type TaskRaw = {
  id: string;
  name: string;
  project_id: string;
  description: string | null;
  is_recurring: boolean;
  recurrence_pattern: string | null;
  recurrence_start: string | Date | null;
  recurrence_end: string | Date | null;
  recurrence_duration: string | number | null;
  expected_effort: string | number | null;
  revenue: string | number | null;
  notes: string | null;
  is_disabled: boolean;
};

const TASK_COLUMNS = `id, name, project_id, description, is_recurring,
  recurrence_pattern, recurrence_start, recurrence_end, recurrence_duration,
  expected_effort, revenue, notes, is_disabled`;

const mapRow = (row: TaskRaw): Task => ({
  id: row.id,
  name: row.name,
  projectId: row.project_id,
  description: row.description,
  isRecurring: row.is_recurring,
  recurrencePattern: row.recurrence_pattern,
  recurrenceStart:
    normalizeNullableDateOnly(row.recurrence_start, 'task.recurrenceStart') ?? undefined,
  recurrenceEnd: normalizeNullableDateOnly(row.recurrence_end, 'task.recurrenceEnd') ?? undefined,
  recurrenceDuration: parseDbNumber(row.recurrence_duration, 0),
  expectedEffort: parseDbNumber(row.expected_effort, undefined),
  revenue: parseDbNumber(row.revenue, undefined),
  notes: row.notes ?? undefined,
  isDisabled: row.is_disabled,
});

export const listAll = async (exec: QueryExecutor = pool): Promise<Task[]> => {
  const { rows } = await exec.query<TaskRaw>(`SELECT ${TASK_COLUMNS} FROM tasks ORDER BY name`);
  return rows.map(mapRow);
};

export const listForUser = async (userId: string, exec: QueryExecutor = pool): Promise<Task[]> => {
  const { rows } = await exec.query<TaskRaw>(
    `SELECT t.id, t.name, t.project_id, t.description, t.is_recurring,
            t.recurrence_pattern, t.recurrence_start, t.recurrence_end, t.recurrence_duration,
            t.expected_effort, t.revenue, t.notes, t.is_disabled
       FROM tasks t
       INNER JOIN user_tasks ut ON t.id = ut.task_id
      WHERE ut.user_id = $1
      ORDER BY t.name`,
    [userId],
  );
  return rows.map(mapRow);
};

export type NewTask = {
  id: string;
  name: string;
  projectId: string;
  description: string | null;
  isRecurring: boolean;
  recurrencePattern: string | null;
  recurrenceStart: string | null;
  recurrenceDuration: number;
  expectedEffort: number;
  revenue: number;
  notes: string | null;
  isDisabled: boolean;
};

export const create = async (task: NewTask, exec: QueryExecutor = pool): Promise<void> => {
  try {
    await exec.query(
      `INSERT INTO tasks (id, name, project_id, description, is_recurring, recurrence_pattern, recurrence_start, recurrence_duration, expected_effort, revenue, notes, is_disabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        task.id,
        task.name,
        task.projectId,
        task.description,
        task.isRecurring,
        task.recurrencePattern,
        task.recurrenceStart,
        task.recurrenceDuration,
        task.expectedEffort,
        task.revenue,
        task.notes,
        task.isDisabled,
      ],
    );
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new ForeignKeyError('Project');
    throw err;
  }
};

export type TaskUpdate = {
  name?: string | null;
  description?: string | null;
  isRecurring?: boolean | null;
  recurrencePattern?: string | null;
  recurrenceStart?: string | null;
  recurrenceEnd?: string | null;
  recurrenceDuration?: number | null;
  isDisabled?: boolean;
  expectedEffort?: number | null;
  revenue?: number | null;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: TaskUpdate,
  exec: QueryExecutor = pool,
): Promise<Task | null> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  const fields: Array<[string, unknown]> = [
    ['name', patch.name],
    ['description', patch.description],
    ['is_recurring', patch.isRecurring],
    ['recurrence_pattern', patch.recurrencePattern],
    ['recurrence_start', patch.recurrenceStart],
    ['recurrence_end', patch.recurrenceEnd],
    ['recurrence_duration', patch.recurrenceDuration],
    ['is_disabled', patch.isDisabled],
    ['expected_effort', patch.expectedEffort],
    ['revenue', patch.revenue],
    ['notes', patch.notes],
  ];
  for (const [col, value] of fields) {
    if (value !== undefined) {
      sets.push(`${col} = $${idx++}`);
      params.push(value);
    }
  }

  if (sets.length === 0) {
    const { rows } = await exec.query<TaskRaw>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1`, [
      id,
    ]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  params.push(id);
  const { rows } = await exec.query<TaskRaw>(
    `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${TASK_COLUMNS}`,
    params,
  );
  return rows[0] ? mapRow(rows[0]) : null;
};

export const deleteById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ name: string; projectId: string } | null> => {
  const { rows } = await exec.query<{ name: string; project_id: string }>(
    `DELETE FROM tasks WHERE id = $1 RETURNING name, project_id`,
    [id],
  );
  if (!rows[0]) return null;
  return { name: rows[0].name, projectId: rows[0].project_id };
};

export const findAssignedUserIds = async (
  taskId: string,
  exec: QueryExecutor = pool,
): Promise<string[]> => {
  const { rows } = await exec.query<{ user_id: string }>(
    `SELECT user_id FROM user_tasks WHERE task_id = $1`,
    [taskId],
  );
  return rows.map((r) => r.user_id);
};

export const findNameAndProjectId = async (
  taskId: string,
  exec: QueryExecutor = pool,
): Promise<{ name: string; projectId: string } | null> => {
  const { rows } = await exec.query<{ name: string; project_id: string }>(
    `SELECT name, project_id FROM tasks WHERE id = $1`,
    [taskId],
  );
  if (!rows[0]) return null;
  return { name: rows[0].name, projectId: rows[0].project_id };
};

export const clearUserAssignments = async (
  taskId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`DELETE FROM user_tasks WHERE task_id = $1`, [taskId]);
};

export const addUserAssignments = async (
  taskId: string,
  userIds: string[],
  exec: QueryExecutor = pool,
): Promise<void> => {
  if (userIds.length === 0) return;
  await exec.query(
    `INSERT INTO user_tasks (task_id, user_id)
     SELECT $1, unnest($2::text[])
     ON CONFLICT DO NOTHING`,
    [taskId, userIds],
  );
};

// Joins time_entries -> tasks via task_id when present, falling back to (project_id, name) for
// rows where task_id is null (legacy entries, or entries created before the matching task
// existed). Use as part of a larger query: caller adds te. alias and WHERE clauses.
export const TIME_ENTRIES_TASKS_JOIN = `JOIN tasks t
    ON t.id = te.task_id
    OR (te.task_id IS NULL AND t.project_id = te.project_id AND t.name = te.task)`;

// Best-effort lookup of a task by (project, name). Duplicate task names within a project resolve
// to the lowest task id; callers store the result so subsequent aggregations remain deterministic
// per entry. Returns null when no matching task exists.
export const findIdByProjectAndName = async (
  projectId: string,
  name: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM tasks WHERE project_id = $1 AND name = $2 ORDER BY id LIMIT 1`,
    [projectId, name],
  );
  return rows[0]?.id ?? null;
};

export const sumHoursByProjects = async (
  projectIds: string[],
  userId: string | undefined,
  exec: QueryExecutor = pool,
): Promise<Array<{ projectId: string; task: string; total: number }>> => {
  const sql = userId
    ? `SELECT te.project_id, te.task, COALESCE(SUM(te.duration), 0)::float AS total
         FROM time_entries te
         ${TIME_ENTRIES_TASKS_JOIN}
         JOIN user_tasks ut ON ut.task_id = t.id
        WHERE te.project_id = ANY($1) AND ut.user_id = $2
        GROUP BY te.project_id, te.task`
    : `SELECT project_id, task, COALESCE(SUM(duration), 0)::float AS total
         FROM time_entries
        WHERE project_id = ANY($1)
        GROUP BY project_id, task`;
  const params = userId ? [projectIds, userId] : [projectIds];
  const { rows } = await exec.query<{ project_id: string; task: string; total: number }>(
    sql,
    params,
  );
  return rows.map((r) => ({ projectId: r.project_id, task: r.task, total: Number(r.total) }));
};
