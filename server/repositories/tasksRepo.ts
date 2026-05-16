import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type DbExecutor, db, executeRows, runAtomically } from '../db/drizzle.ts';
import { tasks, userTasks } from '../db/schema/tasks.ts';
import { timeEntries } from '../db/schema/timeEntries.ts';
import {
  type BillingFrequency,
  DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE,
  normalizeBillingFrequency,
  type StoredBillingType,
} from '../utils/billing.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { getForeignKeyViolation } from '../utils/db-errors.ts';
import { ForeignKeyError } from '../utils/http-errors.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';

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
  monthlyEffort: number | undefined;
  revenue: number | undefined;
  notes: string | undefined;
  isDisabled: boolean;
  createdAt: number;
  billingType: StoredBillingType;
  billingFrequency: BillingFrequency;
};

const mapRow = (row: typeof tasks.$inferSelect): Task => ({
  id: row.id,
  name: row.name,
  projectId: row.projectId,
  description: row.description,
  isRecurring: row.isRecurring ?? false,
  recurrencePattern: row.recurrencePattern,
  recurrenceStart:
    normalizeNullableDateOnly(row.recurrenceStart, 'task.recurrenceStart') ?? undefined,
  recurrenceEnd: normalizeNullableDateOnly(row.recurrenceEnd, 'task.recurrenceEnd') ?? undefined,
  recurrenceDuration: parseDbNumber(row.recurrenceDuration, 0),
  expectedEffort: parseDbNumber(row.expectedEffort, undefined),
  monthlyEffort: parseDbNumber(row.monthlyEffort, undefined),
  revenue: parseDbNumber(row.revenue, undefined),
  notes: row.notes ?? undefined,
  isDisabled: row.isDisabled ?? false,
  createdAt: row.createdAt?.getTime() ?? 0,
  billingType: row.billingType ?? DEFAULT_BILLING_TYPE,
  billingFrequency: row.billingFrequency ?? DEFAULT_BILLING_FREQUENCY,
});

export const listAll = async (exec: DbExecutor = db): Promise<Task[]> => {
  const rows = await exec.select().from(tasks).orderBy(tasks.name);
  return rows.map(mapRow);
};

const taskSelectFields = {
  id: tasks.id,
  name: tasks.name,
  projectId: tasks.projectId,
  description: tasks.description,
  isRecurring: tasks.isRecurring,
  recurrencePattern: tasks.recurrencePattern,
  recurrenceStart: tasks.recurrenceStart,
  recurrenceEnd: tasks.recurrenceEnd,
  recurrenceDuration: tasks.recurrenceDuration,
  expectedEffort: tasks.expectedEffort,
  monthlyEffort: tasks.monthlyEffort,
  revenue: tasks.revenue,
  notes: tasks.notes,
  isDisabled: tasks.isDisabled,
  createdAt: tasks.createdAt,
  billingType: tasks.billingType,
  billingFrequency: tasks.billingFrequency,
} as const;

export const listRecurringForUser = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<Task[]> => {
  const rows = await exec
    .select(taskSelectFields)
    .from(tasks)
    .innerJoin(userTasks, eq(userTasks.taskId, tasks.id))
    .where(
      and(eq(userTasks.userId, userId), eq(tasks.isRecurring, true), eq(tasks.isDisabled, false)),
    )
    .orderBy(tasks.name);
  return rows.map(mapRow);
};

export const listForUser = async (userId: string, exec: DbExecutor = db): Promise<Task[]> => {
  const rows = await exec
    .select(taskSelectFields)
    .from(tasks)
    .innerJoin(userTasks, eq(userTasks.taskId, tasks.id))
    .where(eq(userTasks.userId, userId))
    .orderBy(tasks.name);
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
  monthlyEffort: number;
  revenue: number;
  notes: string | null;
  isDisabled: boolean;
  billingType: StoredBillingType;
  billingFrequency: BillingFrequency;
};

export const create = async (task: NewTask, exec: DbExecutor = db): Promise<Task> => {
  try {
    const rows = await exec
      .insert(tasks)
      .values({
        id: task.id,
        name: task.name,
        projectId: task.projectId,
        description: task.description,
        isRecurring: task.isRecurring,
        recurrencePattern: task.recurrencePattern,
        recurrenceStart: task.recurrenceStart,
        recurrenceDuration: numericForDb(task.recurrenceDuration),
        expectedEffort: numericForDb(task.expectedEffort),
        monthlyEffort: numericForDb(task.monthlyEffort),
        revenue: numericForDb(task.revenue),
        notes: task.notes,
        isDisabled: task.isDisabled,
        billingType: task.billingType,
        billingFrequency: normalizeBillingFrequency(task.billingType, task.billingFrequency),
      })
      .returning();
    return mapRow(rows[0]);
  } catch (err) {
    if (getForeignKeyViolation(err)) throw new ForeignKeyError('Project');
    throw err;
  }
};

const lockBillingTypeById = async (
  id: string,
  exec: DbExecutor,
): Promise<StoredBillingType | null> => {
  const rows = await exec
    .select({ billingType: tasks.billingType })
    .from(tasks)
    .where(eq(tasks.id, id))
    .for('update');
  return rows[0]?.billingType ?? null;
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
  monthlyEffort?: number | null;
  revenue?: number | null;
  notes?: string | null;
  billingType?: StoredBillingType | null;
  billingFrequency?: BillingFrequency | null;
};

export const update = async (
  id: string,
  patch: TaskUpdate,
  exec: DbExecutor = db,
): Promise<Task | null> => {
  // Explicit null clears the column; undefined (key absent) leaves it unchanged. Don't
  // collapse to `value != null` - that loses the clear-to-null semantic.
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.isRecurring !== undefined) set.isRecurring = patch.isRecurring;
  if (patch.recurrencePattern !== undefined) set.recurrencePattern = patch.recurrencePattern;
  if (patch.recurrenceStart !== undefined) set.recurrenceStart = patch.recurrenceStart;
  if (patch.recurrenceEnd !== undefined) set.recurrenceEnd = patch.recurrenceEnd;
  if (patch.recurrenceDuration !== undefined)
    set.recurrenceDuration = numericForDb(patch.recurrenceDuration);
  if (patch.isDisabled !== undefined) set.isDisabled = patch.isDisabled;
  if (patch.expectedEffort !== undefined) set.expectedEffort = numericForDb(patch.expectedEffort);
  if (patch.monthlyEffort !== undefined) set.monthlyEffort = numericForDb(patch.monthlyEffort);
  if (patch.revenue !== undefined) set.revenue = numericForDb(patch.revenue);
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.billingType !== undefined) {
    const nextBillingType = patch.billingType ?? DEFAULT_BILLING_TYPE;
    set.billingType = nextBillingType;
    set.billingFrequency = normalizeBillingFrequency(nextBillingType, patch.billingFrequency);
  } else if (patch.billingFrequency !== undefined) {
    // Lock billing_type while we normalize against it: a concurrent UPDATE of billing_type
    // between the SELECT and our UPDATE would otherwise leave billing_frequency mismatched.
    return runAtomically(exec, async (tx) => {
      const billingType = await lockBillingTypeById(id, tx);
      set.billingFrequency = normalizeBillingFrequency(
        billingType ?? DEFAULT_BILLING_TYPE,
        patch.billingFrequency,
      );
      const rows = await tx.update(tasks).set(set).where(eq(tasks.id, id)).returning();
      return rows[0] ? mapRow(rows[0]) : null;
    });
  }

  if (Object.keys(set).length === 0) {
    // No fields to update. Routes rely on this branch to return the current row when called
    // with an empty patch - `db.update(tasks).set({})` would emit invalid SQL.
    const rows = await exec.select().from(tasks).where(eq(tasks.id, id));
    return rows[0] ? mapRow(rows[0]) : null;
  }

  const rows = await exec.update(tasks).set(set).where(eq(tasks.id, id)).returning();
  return rows[0] ? mapRow(rows[0]) : null;
};

export const deleteById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ name: string; projectId: string } | null> => {
  const rows = await exec
    .delete(tasks)
    .where(eq(tasks.id, id))
    .returning({ name: tasks.name, projectId: tasks.projectId });
  if (!rows[0]) return null;
  return { name: rows[0].name, projectId: rows[0].projectId };
};

export const findAssignedUserIds = async (
  taskId: string,
  exec: DbExecutor = db,
): Promise<string[]> => {
  const rows = await exec
    .select({ userId: userTasks.userId })
    .from(userTasks)
    .where(eq(userTasks.taskId, taskId));
  return rows.map((r) => r.userId);
};

export const findNameAndProjectId = async (
  taskId: string,
  exec: DbExecutor = db,
): Promise<{ name: string; projectId: string } | null> => {
  const rows = await exec
    .select({ name: tasks.name, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  return rows[0] ?? null;
};

export const clearUserAssignments = async (
  taskId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.delete(userTasks).where(eq(userTasks.taskId, taskId));
};

export const addUserAssignments = async (
  taskId: string,
  userIds: string[],
  exec: DbExecutor = db,
): Promise<void> => {
  if (userIds.length === 0) return;
  await exec
    .insert(userTasks)
    .values(userIds.map((userId) => ({ taskId, userId })))
    .onConflictDoNothing();
};

// Aliased table references shared by the time-entries → tasks join and its callers.
// Both the JOIN expression and the surrounding query MUST use these same aliases ("te"/"t")
// - once a table is aliased, Postgres rejects column refs that name the unaliased table.
//
// Caller is expected to write the FROM/JOIN keywords + table-with-alias as raw SQL
// (`FROM time_entries te`); Drizzle's `${aliasedTable}` in raw templates renders only the
// alias (`"te"`), not `"time_entries" "te"`, so it can't be used directly in FROM. Column
// references via `timeEntriesTe.X` / `tasksT.X` correctly compile to `"te"."x"` / `"t"."x"`
// - that's the part the aliases buy us.
//
// `timeEntriesTe` is module-private - the JOIN chunk and `sumHoursByProjects` are the only
// callers and they all live in this file. `tasksT` is exported because external consumers
// (e.g. `reportsHoursRepo.getTasksSection`) need to reference `t` columns in their own
// surrounding SELECT/JOIN/WHERE clauses (e.g. `JOIN user_tasks ut ON ut.task_id = ${tasksT.id}`).
const timeEntriesTe = alias(timeEntries, 'te');
export const tasksT = alias(tasks, 't');

// Joins time_entries -> tasks via task_id when present, falling back to (project_id, name) for
// rows where task_id is null (legacy entries, or entries created before the matching task
// existed). Use as part of a larger query: the caller's FROM clause must declare the `te` and
// `t` aliases (typically `FROM time_entries te` plus this JOIN).
//
// LATERAL join with `LIMIT 1` ensures exactly one task row per time entry. The previous
// `JOIN tasks t ON (FK) OR (name fallback)` multiplied rows whenever a project contained
// duplicate task names: every legacy entry with `task_id IS NULL` matched all duplicates,
// inflating SUMs/COUNTs in downstream aggregations.
//
// Resolution rule (matches `findIdByProjectAndName`): prefer the FK match when present,
// otherwise pick the lowest task id among `(project_id, name)` siblings - the
// `ORDER BY (id = task_id) DESC NULLS LAST, id ASC` clause sorts the FK match first
// (boolean true > false), then by id for the fallback case.
export const timeEntriesTasksJoin = sql`JOIN LATERAL (
      SELECT t_inner.*
        FROM tasks t_inner
       WHERE t_inner.id = ${timeEntriesTe.taskId}
          OR (${timeEntriesTe.taskId} IS NULL
              AND t_inner.project_id = ${timeEntriesTe.projectId}
              AND t_inner.name = ${timeEntriesTe.task})
       ORDER BY (t_inner.id = ${timeEntriesTe.taskId}) DESC NULLS LAST, t_inner.id ASC
       LIMIT 1
    ) t ON TRUE`;

// Best-effort lookup of a task by (project, name). Duplicate task names within a project resolve
// to the lowest task id; callers store the result so subsequent aggregations remain deterministic
// per entry. Returns null when no matching task exists.
export const findIdByProjectAndName = async (
  projectId: string,
  name: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.name, name)))
    .orderBy(tasks.id)
    .limit(1);
  return rows[0]?.id ?? null;
};

// When `userId` is undefined this aggregates ALL time entries for the given projects with
// no user filter — it is a deliberate "show everything" mode, not the absence of a filter.
// Callers must authorize that broader scope before invoking. Do not pass `undefined` simply
// because no user is at hand.
export const sumHoursByProjects = async (
  projectIds: string[],
  userId: string | undefined,
  exec: DbExecutor = db,
): Promise<Array<{ projectId: string; task: string; total: number }>> => {
  if (projectIds.length === 0) return [];
  const query = userId
    ? sql`SELECT ${timeEntriesTe.projectId} AS "projectId", ${timeEntriesTe.task}, COALESCE(SUM(${timeEntriesTe.duration}), 0)::float AS total
            FROM time_entries te
            ${timeEntriesTasksJoin}
            JOIN user_tasks ut ON ut.task_id = ${tasksT.id}
           WHERE ${inArray(timeEntriesTe.projectId, projectIds)} AND ut.user_id = ${userId}
           GROUP BY ${timeEntriesTe.projectId}, ${timeEntriesTe.task}`
    : sql`SELECT project_id AS "projectId", task, COALESCE(SUM(duration), 0)::float AS total
            FROM time_entries
           WHERE ${inArray(timeEntries.projectId, projectIds)}
           GROUP BY project_id, task`;
  const rows = await executeRows<{ projectId: string; task: string; total: number }>(exec, query);
  return rows.map((r) => ({ projectId: r.projectId, task: r.task, total: Number(r.total) }));
};
