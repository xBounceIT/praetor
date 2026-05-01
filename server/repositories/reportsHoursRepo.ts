import pool, { type QueryExecutor } from '../db/index.ts';
import { toDbNumber as toNumber, toDbText as toText } from '../utils/parse.ts';
import { TIME_ENTRIES_TASKS_JOIN } from './tasksRepo.ts';

type ProjectRow = {
  id: string;
  name: string | null;
  client_id: string | null;
  client_name: string | null;
  description: string | null;
  is_disabled: boolean | null;
};

type TaskRow = {
  id: string;
  name: string | null;
  project_id: string | null;
  project_name: string | null;
  is_disabled: boolean | null;
  is_recurring: boolean | null;
  recurrence_pattern: string | null;
};

export type TimesheetsSectionOptions = {
  fromDate: string;
  toDate: string;
  allowedTimesheetUserIds: string[] | null;
  topLimit: number;
};

export type TimesheetsSection = {
  totals: { hours: number; entryCount: number; cost: number; avgEntryHours: number };
  byMonth: Array<{ label: string; hours: number; entryCount: number; cost: number }>;
  byLocation: Array<{ location: string; hours: number; entryCount: number }>;
  topHoursByUser: Array<{ label: string; value: number; entryCount: number }>;
  topHoursByClient: Array<{ label: string; value: number; entryCount: number }>;
  topHoursByProject: Array<{ label: string; value: number; entryCount: number }>;
  topHoursByTask: Array<{ label: string; value: number; entryCount: number }>;
};

export const getTimesheetsSection = async (
  opts: TimesheetsSectionOptions,
  exec: QueryExecutor = pool,
): Promise<TimesheetsSection> => {
  const { fromDate, toDate, allowedTimesheetUserIds, topLimit } = opts;
  const baseWhere = allowedTimesheetUserIds
    ? {
        clause: 'WHERE te.date >= $1 AND te.date <= $2 AND te.user_id = ANY($3)',
        params: [fromDate, toDate, allowedTimesheetUserIds] as unknown[],
      }
    : {
        clause: 'WHERE te.date >= $1 AND te.date <= $2',
        params: [fromDate, toDate] as unknown[],
      };

  const [totals, topUsers, topClients, topProjects, topTasks, byMonth, byLocation] =
    await Promise.all([
      exec.query<{ hours: string; entry_count: string; total_cost: string }>(
        `SELECT
          COALESCE(SUM(te.duration), 0) as hours,
          COUNT(*) as entry_count,
          COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) as total_cost
         FROM time_entries te
         ${baseWhere.clause}`,
        baseWhere.params,
      ),
      exec.query<{ label: string; value: string; entry_count: string }>(
        `SELECT
          u.name as label,
          COALESCE(SUM(te.duration), 0) as value,
          COUNT(*) as entry_count
         FROM time_entries te
         JOIN users u ON u.id = te.user_id
         ${baseWhere.clause}
        GROUP BY u.name
        ORDER BY value DESC
        LIMIT ${topLimit}`,
        baseWhere.params,
      ),
      exec.query<{ label: string; value: string; entry_count: string }>(
        `SELECT
          te.client_name as label,
          COALESCE(SUM(te.duration), 0) as value,
          COUNT(*) as entry_count
         FROM time_entries te
         ${baseWhere.clause}
        GROUP BY te.client_name
        ORDER BY value DESC
        LIMIT ${topLimit}`,
        baseWhere.params,
      ),
      exec.query<{ label: string; value: string; entry_count: string }>(
        `SELECT
          te.project_name as label,
          COALESCE(SUM(te.duration), 0) as value,
          COUNT(*) as entry_count
         FROM time_entries te
         ${baseWhere.clause}
        GROUP BY te.project_name
        ORDER BY value DESC
        LIMIT ${topLimit}`,
        baseWhere.params,
      ),
      exec.query<{ label: string; value: string; entry_count: string }>(
        `SELECT
          te.task as label,
          COALESCE(SUM(te.duration), 0) as value,
          COUNT(*) as entry_count
         FROM time_entries te
         ${baseWhere.clause}
        GROUP BY te.task
        ORDER BY value DESC
        LIMIT ${topLimit}`,
        baseWhere.params,
      ),
      exec.query<{
        label: string;
        hours: string;
        entry_count: string;
        total_cost: string;
      }>(
        `SELECT
          TO_CHAR(DATE_TRUNC('month', te.date), 'YYYY-MM') as label,
          COALESCE(SUM(te.duration), 0) as hours,
          COUNT(*) as entry_count,
          COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) as total_cost
         FROM time_entries te
         ${baseWhere.clause}
        GROUP BY DATE_TRUNC('month', te.date)
        ORDER BY label ASC`,
        baseWhere.params,
      ),
      exec.query<{ location: string; hours: string; entry_count: string }>(
        `SELECT
          COALESCE(NULLIF(te.location, ''), 'unknown') as location,
          COALESCE(SUM(te.duration), 0) as hours,
          COUNT(*) as entry_count
         FROM time_entries te
         ${baseWhere.clause}
        GROUP BY COALESCE(NULLIF(te.location, ''), 'unknown')
        ORDER BY hours DESC`,
        baseWhere.params,
      ),
    ]);

  const totalHours = toNumber(totals.rows[0]?.hours);
  const totalEntries = toNumber(totals.rows[0]?.entry_count);

  const mapTopRow = (r: { label: string; value: string; entry_count: string }) => ({
    label: toText(r.label),
    value: toNumber(r.value),
    entryCount: toNumber(r.entry_count),
  });

  return {
    totals: {
      hours: totalHours,
      entryCount: totalEntries,
      cost: toNumber(totals.rows[0]?.total_cost),
      avgEntryHours: totalEntries > 0 ? totalHours / totalEntries : 0,
    },
    byMonth: byMonth.rows.map((r) => ({
      label: toText(r.label),
      hours: toNumber(r.hours),
      entryCount: toNumber(r.entry_count),
      cost: toNumber(r.total_cost),
    })),
    byLocation: byLocation.rows.map((r) => ({
      location: toText(r.location),
      hours: toNumber(r.hours),
      entryCount: toNumber(r.entry_count),
    })),
    topHoursByUser: topUsers.rows.map(mapTopRow),
    topHoursByClient: topClients.rows.map(mapTopRow),
    topHoursByProject: topProjects.rows.map(mapTopRow),
    topHoursByTask: topTasks.rows.map(mapTopRow),
  };
};

export type ProjectsSectionOptions = {
  viewerId: string;
  fromDate: string;
  toDate: string;
  canViewAllProjects: boolean;
  canViewTimesheets: boolean;
  canViewAllTimesheets: boolean;
  allowedTimesheetUserIds: string[] | null;
  itemsLimit: number;
  topLimit: number;
};

export type ProjectInfo = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  description: string;
  isDisabled: boolean;
};

export type ProjectsSection = {
  count: number;
  activeCount: number;
  disabledCount: number;
  items: ProjectInfo[];
  topByHours: Array<{ label: string; value: number; cost: number }>;
  topByCost: Array<{ label: string; value: number; hours: number }>;
};

export const getProjectsSection = async (
  opts: ProjectsSectionOptions,
  exec: QueryExecutor = pool,
): Promise<ProjectsSection> => {
  const {
    viewerId,
    fromDate,
    toDate,
    canViewAllProjects,
    canViewTimesheets,
    canViewAllTimesheets,
    allowedTimesheetUserIds,
    itemsLimit,
    topLimit,
  } = opts;

  const summaryQuery = canViewAllProjects
    ? exec.query<{ count: string; disabled_count: string }>(
        `SELECT
            COUNT(*) as count,
            SUM(CASE WHEN is_disabled THEN 1 ELSE 0 END) as disabled_count
           FROM projects`,
      )
    : exec.query<{ count: string; disabled_count: string }>(
        `SELECT
            COUNT(*) as count,
            SUM(CASE WHEN p.is_disabled THEN 1 ELSE 0 END) as disabled_count
           FROM projects p
           JOIN user_projects up ON up.project_id = p.id
          WHERE up.user_id = $1`,
        [viewerId],
      );

  const itemsQuery = canViewAllProjects
    ? exec.query<ProjectRow>(
        `SELECT
            p.id,
            p.name,
            p.client_id,
            c.name as client_name,
            p.description,
            p.is_disabled
           FROM projects p
           JOIN clients c ON c.id = p.client_id
          ORDER BY p.name ASC
          LIMIT $1`,
        [itemsLimit],
      )
    : exec.query<ProjectRow>(
        `SELECT
            p.id,
            p.name,
            p.client_id,
            c.name as client_name,
            p.description,
            p.is_disabled
           FROM projects p
           JOIN clients c ON c.id = p.client_id
           JOIN user_projects up ON up.project_id = p.id
          WHERE up.user_id = $1
          ORDER BY p.name ASC
          LIMIT $2`,
        [viewerId, itemsLimit],
      );

  const projectHoursQuery = canViewTimesheets
    ? canViewAllProjects
      ? canViewAllTimesheets
        ? exec.query<{ label: string; hours: string; cost: string }>(
            `SELECT
                te.project_name as label,
                COALESCE(SUM(te.duration), 0) as hours,
                COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) as cost
               FROM time_entries te
              WHERE te.date >= $1 AND te.date <= $2
              GROUP BY te.project_name`,
            [fromDate, toDate],
          )
        : exec.query<{ label: string; hours: string; cost: string }>(
            `SELECT
                te.project_name as label,
                COALESCE(SUM(te.duration), 0) as hours,
                COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) as cost
               FROM time_entries te
              WHERE te.date >= $1
                AND te.date <= $2
                AND te.user_id = ANY($3)
              GROUP BY te.project_name`,
            [fromDate, toDate, allowedTimesheetUserIds || []],
          )
      : canViewAllTimesheets
        ? exec.query<{ label: string; hours: string; cost: string }>(
            `SELECT
                te.project_name as label,
                COALESCE(SUM(te.duration), 0) as hours,
                COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) as cost
               FROM time_entries te
               JOIN user_projects up ON up.project_id = te.project_id
              WHERE te.date >= $1
                AND te.date <= $2
                AND up.user_id = $3
              GROUP BY te.project_name`,
            [fromDate, toDate, viewerId],
          )
        : exec.query<{ label: string; hours: string; cost: string }>(
            `SELECT
                te.project_name as label,
                COALESCE(SUM(te.duration), 0) as hours,
                COALESCE(SUM(te.duration * COALESCE(te.hourly_cost, 0)), 0) as cost
               FROM time_entries te
               JOIN user_projects up ON up.project_id = te.project_id
              WHERE te.date >= $1
                AND te.date <= $2
                AND te.user_id = ANY($3)
                AND up.user_id = $4
              GROUP BY te.project_name`,
            [fromDate, toDate, allowedTimesheetUserIds || [], viewerId],
          )
    : null;

  const [summaryRes, itemsRes, hoursRes] = await Promise.all([
    summaryQuery,
    itemsQuery,
    projectHoursQuery,
  ]);

  const projectStats = hoursRes
    ? hoursRes.rows.map((r) => ({
        label: toText(r.label),
        hours: toNumber(r.hours),
        cost: toNumber(r.cost),
      }))
    : [];
  const topByHours = [...projectStats]
    .sort((a, b) => b.hours - a.hours)
    .slice(0, topLimit)
    .map(({ label, hours, cost }) => ({ label, value: hours, cost }));
  const topByCost = [...projectStats]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, topLimit)
    .map(({ label, hours, cost }) => ({ label, value: cost, hours }));

  const projectCount = toNumber(summaryRes.rows[0]?.count);
  const disabledCount = toNumber(summaryRes.rows[0]?.disabled_count);
  return {
    count: projectCount,
    activeCount: Math.max(projectCount - disabledCount, 0),
    disabledCount,
    items: itemsRes.rows.map((r) => ({
      id: toText(r.id),
      name: toText(r.name),
      clientId: toText(r.client_id),
      clientName: toText(r.client_name),
      description: toText(r.description),
      isDisabled: Boolean(r.is_disabled),
    })),
    topByHours,
    topByCost,
  };
};

export type TasksSectionOptions = {
  viewerId: string;
  fromDate: string;
  toDate: string;
  canViewAllTasks: boolean;
  canViewTimesheets: boolean;
  canViewAllTimesheets: boolean;
  allowedTimesheetUserIds: string[] | null;
  itemsLimit: number;
  topLimit: number;
};

export type TaskInfo = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  isDisabled: boolean;
  isRecurring: boolean;
  recurrencePattern: string;
};

export type TasksSection = {
  count: number;
  activeCount: number;
  disabledCount: number;
  recurringCount: number;
  items: TaskInfo[];
  topByHours: Array<{ label: string; value: number; entryCount: number }>;
};

export const getTasksSection = async (
  opts: TasksSectionOptions,
  exec: QueryExecutor = pool,
): Promise<TasksSection> => {
  const {
    viewerId,
    fromDate,
    toDate,
    canViewAllTasks,
    canViewTimesheets,
    canViewAllTimesheets,
    allowedTimesheetUserIds,
    itemsLimit,
    topLimit,
  } = opts;

  const summaryQuery = canViewAllTasks
    ? exec.query<{ count: string; disabled_count: string; recurring_count: string }>(
        `SELECT
            COUNT(*) as count,
            SUM(CASE WHEN is_disabled THEN 1 ELSE 0 END) as disabled_count,
            SUM(CASE WHEN is_recurring THEN 1 ELSE 0 END) as recurring_count
           FROM tasks`,
      )
    : exec.query<{ count: string; disabled_count: string; recurring_count: string }>(
        `SELECT
            COUNT(*) as count,
            SUM(CASE WHEN t.is_disabled THEN 1 ELSE 0 END) as disabled_count,
            SUM(CASE WHEN t.is_recurring THEN 1 ELSE 0 END) as recurring_count
           FROM tasks t
           JOIN user_tasks ut ON ut.task_id = t.id
          WHERE ut.user_id = $1`,
        [viewerId],
      );

  const itemsQuery = canViewAllTasks
    ? exec.query<TaskRow>(
        `SELECT
            t.id,
            t.name,
            t.project_id,
            p.name as project_name,
            t.is_disabled,
            t.is_recurring,
            t.recurrence_pattern
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
          ORDER BY t.name ASC
          LIMIT $1`,
        [itemsLimit],
      )
    : exec.query<TaskRow>(
        `SELECT
            t.id,
            t.name,
            t.project_id,
            p.name as project_name,
            t.is_disabled,
            t.is_recurring,
            t.recurrence_pattern
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
           JOIN user_tasks ut ON ut.task_id = t.id
          WHERE ut.user_id = $1
          ORDER BY t.name ASC
          LIMIT $2`,
        [viewerId, itemsLimit],
      );

  const taskHoursQuery = canViewTimesheets
    ? canViewAllTasks
      ? canViewAllTimesheets
        ? exec.query<{ label: string; hours: string; entry_count: string }>(
            `SELECT te.task as label, COALESCE(SUM(te.duration), 0) as hours, COUNT(*) as entry_count
               FROM time_entries te
              WHERE te.date >= $1 AND te.date <= $2
              GROUP BY te.task
              ORDER BY hours DESC
              LIMIT ${topLimit}`,
            [fromDate, toDate],
          )
        : exec.query<{ label: string; hours: string; entry_count: string }>(
            `SELECT te.task as label, COALESCE(SUM(te.duration), 0) as hours, COUNT(*) as entry_count
               FROM time_entries te
              WHERE te.date >= $1
                AND te.date <= $2
                AND te.user_id = ANY($3)
              GROUP BY te.task
              ORDER BY hours DESC
              LIMIT ${topLimit}`,
            [fromDate, toDate, allowedTimesheetUserIds || []],
          )
      : canViewAllTimesheets
        ? exec.query<{ label: string; hours: string; entry_count: string }>(
            `SELECT te.task as label, COALESCE(SUM(te.duration), 0) as hours, COUNT(*) as entry_count
               FROM time_entries te
               ${TIME_ENTRIES_TASKS_JOIN}
               JOIN user_tasks ut ON ut.task_id = t.id
              WHERE te.date >= $1
                AND te.date <= $2
                AND ut.user_id = $3
              GROUP BY te.task
              ORDER BY hours DESC
              LIMIT ${topLimit}`,
            [fromDate, toDate, viewerId],
          )
        : exec.query<{ label: string; hours: string; entry_count: string }>(
            `SELECT te.task as label, COALESCE(SUM(te.duration), 0) as hours, COUNT(*) as entry_count
               FROM time_entries te
               ${TIME_ENTRIES_TASKS_JOIN}
               JOIN user_tasks ut ON ut.task_id = t.id
              WHERE te.date >= $1
                AND te.date <= $2
                AND te.user_id = ANY($3)
                AND ut.user_id = $4
              GROUP BY te.task
              ORDER BY hours DESC
              LIMIT ${topLimit}`,
            [fromDate, toDate, allowedTimesheetUserIds || [], viewerId],
          )
    : null;

  const [summaryRes, itemsRes, taskHoursRes] = await Promise.all([
    summaryQuery,
    itemsQuery,
    taskHoursQuery,
  ]);

  const topByHours = taskHoursRes
    ? taskHoursRes.rows.map((r) => ({
        label: toText(r.label),
        value: toNumber(r.hours),
        entryCount: toNumber(r.entry_count),
      }))
    : [];

  const taskCount = toNumber(summaryRes.rows[0]?.count);
  const disabledCount = toNumber(summaryRes.rows[0]?.disabled_count);
  return {
    count: taskCount,
    activeCount: Math.max(taskCount - disabledCount, 0),
    disabledCount,
    recurringCount: toNumber(summaryRes.rows[0]?.recurring_count),
    items: itemsRes.rows.map((r) => ({
      id: toText(r.id),
      name: toText(r.name),
      projectId: toText(r.project_id),
      projectName: toText(r.project_name),
      isDisabled: Boolean(r.is_disabled),
      isRecurring: Boolean(r.is_recurring),
      recurrencePattern: toText(r.recurrence_pattern),
    })),
    topByHours,
  };
};
