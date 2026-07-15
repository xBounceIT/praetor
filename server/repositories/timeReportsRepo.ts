import { type SQL, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { parseDbNumber } from '../utils/parse.ts';

export type TimeReportField = 'user' | 'client' | 'project' | 'task' | 'duration' | 'note' | 'cost';
export type TimeReportGroup = 'date' | 'user' | 'client' | 'project' | 'task';

export type TimeReportTaskFilter = {
  projectId: string;
  taskId: string | null;
  name: string;
};

export type TimeReportDefinition = {
  fromDate: string;
  toDate: string;
  clientId: string | null;
  projectIds: string[];
  task: TimeReportTaskFilter | null;
  noteContains: string;
  fields: TimeReportField[];
  groupBy: TimeReportGroup[];
  totalsOnly: boolean;
};

export type TimeReportEntry = {
  id: string;
  userId: string;
  userName: string;
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
  cost: number;
  isPlaceholder: boolean;
  location: string;
  createdAt: number;
  version: number;
};

export type TimeReportOptions = {
  users: Array<{ id: string; name: string }>;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; clientId: string }>;
  tasks: Array<{
    key: string;
    projectId: string;
    taskId: string | null;
    name: string;
  }>;
};

export type TimeReportSubtotal = {
  groupLevel: number;
  groupValues: string[];
  label: string;
  duration: number;
  cost: number;
};

type RawEntry = {
  id: string;
  user_id: string;
  user_name: string;
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
  version: string | number | null;
};

const mapEntry = (row: RawEntry): TimeReportEntry => {
  const date = normalizeNullableDateOnly(row.date, 'timeReport.date');
  if (!date) throw new TypeError('Invalid date value for timeReport.date');
  const duration = parseDbNumber(row.duration, 0);
  const hourlyCost = parseDbNumber(row.hourly_cost, 0);
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
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
    cost: Math.round(duration * hourlyCost * 100) / 100,
    isPlaceholder: !!row.is_placeholder,
    location: row.location || 'remote',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    version: Number(row.version ?? 1),
  };
};

export const listAllNonAdminUserIds = async (exec: DbExecutor = db): Promise<string[]> => {
  const rows = await executeRows<{ id: string }>(
    exec,
    sql`SELECT u.id
          FROM users u
         WHERE COALESCE(u.role, '') <> 'admin'
         ORDER BY u.id`,
  );
  return rows.map((row) => row.id);
};

export const filterNonAdminUserIds = async (
  userIds: string[],
  exec: DbExecutor = db,
): Promise<string[]> => {
  if (userIds.length === 0) return [];
  const rows = await executeRows<{ id: string }>(
    exec,
    sql`SELECT u.id
          FROM users u
         WHERE u.id = ANY(${sql.param(userIds)}::text[])
           AND COALESCE(u.role, '') <> 'admin'
         ORDER BY u.id`,
  );
  return rows.map((row) => row.id);
};

export const listOptions = async (
  allowedUserIds: string[],
  exec: DbExecutor = db,
): Promise<TimeReportOptions> => {
  if (allowedUserIds.length === 0) {
    return { users: [], clients: [], projects: [], tasks: [] };
  }
  const ids = sql.param(allowedUserIds);
  const [users, clients, projects, tasks] = await Promise.all([
    executeRows<{ id: string; name: string }>(
      exec,
      sql`SELECT u.id, u.name
            FROM users u
           WHERE u.id = ANY(${ids}::text[])
             AND COALESCE(u.role, '') <> 'admin'
           ORDER BY lower(u.name), u.id`,
    ),
    executeRows<{ id: string; name: string }>(
      exec,
      sql`SELECT DISTINCT ON (te.client_id)
                  te.client_id AS id, te.client_name AS name
            FROM time_entries te
           WHERE te.user_id = ANY(${ids}::text[])
           ORDER BY te.client_id, te.date DESC, te.created_at DESC NULLS LAST`,
    ),
    executeRows<{ id: string; name: string; clientId: string }>(
      exec,
      sql`SELECT DISTINCT ON (te.project_id)
                  te.project_id AS id,
                  te.project_name AS name,
                  te.client_id AS "clientId"
            FROM time_entries te
           WHERE te.user_id = ANY(${ids}::text[])
           ORDER BY te.project_id, te.date DESC, te.created_at DESC NULLS LAST`,
    ),
    executeRows<{ projectId: string; taskId: string | null; name: string }>(
      exec,
      sql`SELECT DISTINCT ON (
                  te.project_id,
                  COALESCE(te.task_id, 'legacy:' || lower(te.task))
                ) te.project_id AS "projectId",
                  te.task_id AS "taskId",
                  te.task AS name
            FROM time_entries te
           WHERE te.user_id = ANY(${ids}::text[])
           ORDER BY te.project_id,
                    COALESCE(te.task_id, 'legacy:' || lower(te.task)),
                    te.date DESC,
                    te.created_at DESC NULLS LAST`,
    ),
  ]);
  return {
    users,
    clients: clients.sort((a, b) => a.name.localeCompare(b.name)),
    projects: projects.sort((a, b) => a.name.localeCompare(b.name)),
    tasks: tasks.map((task) => ({
      ...task,
      key: task.taskId ?? `legacy:${task.projectId}:${task.name.toLowerCase()}`,
    })),
  };
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const buildWhere = (definition: TimeReportDefinition, userIds: string[]): SQL => {
  const filters: SQL[] = [
    sql`te.user_id = ANY(${sql.param(userIds)}::text[])`,
    sql`te.date >= ${definition.fromDate}`,
    sql`te.date <= ${definition.toDate}`,
  ];
  if (definition.clientId) filters.push(sql`te.client_id = ${definition.clientId}`);
  if (definition.projectIds.length > 0) {
    filters.push(sql`te.project_id = ANY(${sql.param(definition.projectIds)}::text[])`);
  }
  if (definition.task) {
    const task = definition.task;
    if (task.taskId) {
      filters.push(
        sql`(
          te.task_id = ${task.taskId}
          OR (
            te.task_id IS NULL
            AND te.project_id = ${task.projectId}
            AND lower(te.task) = lower(${task.name})
          )
        )`,
      );
    } else {
      filters.push(
        sql`te.task_id IS NULL
            AND te.project_id = ${task.projectId}
            AND lower(te.task) = lower(${task.name})`,
      );
    }
  }
  if (definition.noteContains.trim()) {
    const needle = `%${escapeLike(definition.noteContains.trim())}%`;
    filters.push(sql`COALESCE(te.notes, '') ILIKE ${needle} ESCAPE '\\'`);
  }
  return sql.join(filters, sql` AND `);
};

const queryEntries = async (
  definition: TimeReportDefinition,
  userIds: string[],
  limit: number,
  offset: number,
  exec: DbExecutor = db,
): Promise<TimeReportEntry[]> => {
  const where = buildWhere(definition, userIds);
  const rows = await executeRows<RawEntry>(
    exec,
    sql`SELECT te.id,
               te.user_id,
               u.name AS user_name,
               te.date,
               te.client_id,
               te.client_name,
               te.project_id,
               te.project_name,
               te.task,
               te.task_id,
               te.notes,
               te.duration,
               te.hourly_cost,
               te.is_placeholder,
               te.location,
               te.created_at,
               te.version
          FROM time_entries te
          JOIN users u ON u.id = te.user_id
         WHERE ${where}
         ORDER BY te.date, lower(u.name), lower(te.client_name),
                  lower(te.project_name), lower(te.task), te.id
         LIMIT ${limit}
        OFFSET ${offset}`,
  );
  return rows.map(mapEntry);
};

export const listEntries = (
  definition: TimeReportDefinition,
  userIds: string[],
  limit: number,
  exec: DbExecutor = db,
): Promise<TimeReportEntry[]> => queryEntries(definition, userIds, limit, 0, exec);

export const listEntriesPage = (
  definition: TimeReportDefinition,
  userIds: string[],
  limit: number,
  offset: number,
  exec: DbExecutor = db,
): Promise<TimeReportEntry[]> => queryEntries(definition, userIds, limit, offset, exec);

const groupExpression = (group: TimeReportGroup): SQL => {
  switch (group) {
    case 'date':
      return sql`te.date`;
    case 'user':
      return sql`u.name`;
    case 'client':
      return sql`te.client_name`;
    case 'project':
      return sql`te.project_name`;
    case 'task':
      return sql`te.task`;
  }
};

export const listSubtotals = async (
  definition: TimeReportDefinition,
  userIds: string[],
  limit: number,
  exec: DbExecutor = db,
): Promise<TimeReportSubtotal[]> => {
  if (definition.groupBy.length === 0) return [];
  const where = buildWhere(definition, userIds);
  const expressions = definition.groupBy.map(groupExpression);
  const groupSets = expressions.map(
    (_, index) => sql`(${sql.join(expressions.slice(0, index + 1), sql`, `)})`,
  );
  const valueColumns = expressions.map(
    (expression, index) => sql`${expression}::text AS ${sql.identifier(`group_value_${index}`)}`,
  );
  const groupingColumns = expressions.map(
    (expression, index) =>
      sql`GROUPING(${expression})::int AS ${sql.identifier(`grouped_${index}`)}`,
  );
  const orderColumns = expressions.map((expression) => sql`lower(${expression}::text) NULLS LAST`);
  const rows = await executeRows<
    Record<string, unknown> & { duration: string | number | null; cost: string | number | null }
  >(
    exec,
    sql`SELECT ${sql.join([...valueColumns, ...groupingColumns], sql`, `)},
               COALESCE(SUM(te.duration), 0) AS duration,
               COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) AS cost
          FROM time_entries te
          JOIN users u ON u.id = te.user_id
         WHERE ${where}
         GROUP BY GROUPING SETS (${sql.join(groupSets, sql`, `)})
         ORDER BY ${sql.join(orderColumns, sql`, `)}
         LIMIT ${limit}`,
  );
  return rows.map((row) => {
    let groupLevel = 0;
    for (let index = 0; index < expressions.length; index += 1) {
      if (Number(row[`grouped_${index}`]) === 0) groupLevel = index;
    }
    const groupValues = Array.from({ length: groupLevel + 1 }, (_, index) =>
      String(row[`group_value_${index}`] ?? ''),
    );
    return {
      groupLevel,
      groupValues,
      label: groupValues[groupLevel],
      duration: parseDbNumber(row.duration, 0),
      cost: Math.round(parseDbNumber(row.cost, 0) * 100) / 100,
    };
  });
};

export const getTotals = async (
  definition: TimeReportDefinition,
  userIds: string[],
  exec: DbExecutor = db,
): Promise<{ count: number; duration: number; cost: number }> => {
  const where = buildWhere(definition, userIds);
  const rows = await executeRows<{
    count: string | number;
    duration: string | number | null;
    cost: string | number | null;
  }>(
    exec,
    sql`SELECT COUNT(*)::int AS count,
               COALESCE(SUM(te.duration), 0) AS duration,
               COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) AS cost
          FROM time_entries te
         WHERE ${where}`,
  );
  const row = rows[0];
  return {
    count: Number(row?.count ?? 0),
    duration: parseDbNumber(row?.duration, 0),
    cost: Math.round(parseDbNumber(row?.cost, 0) * 100) / 100,
  };
};
